import type { BoardState, Die, Move } from '../../engine/src/types';
import { pickMove } from './picker';
import type { AILevel } from './types';

interface Pending {
  resolve(moves: readonly Move[]): void;
  reject(err: Error): void;
  // The request inputs are captured so that if the worker dies *after* a
  // request is in flight, we can still answer it synchronously on the main
  // thread instead of leaving the promise (and the AI's turn) hanging forever.
  state: BoardState;
  remaining: readonly Die[];
  level: AILevel;
}

let worker: Worker | null = null;
let workerInitFailed = false;
const pending = new Map<number, Pending>();
let nextRequestId = 1;

/** Run the picker on the main thread. Last-resort answer when the worker is
 *  unavailable — returns [] (AI plays no move / ends its turn) if even the
 *  synchronous picker throws, so a picker bug can never deadlock the board. */
function pickOnMainThread(p: { state: BoardState; remaining: readonly Die[]; level: AILevel }): readonly Move[] {
  try {
    return pickMove(p.state, [...p.remaining], p.level).moves;
  } catch (err) {
    console.error('[ai] main-thread picker failed; AI will skip its move', err);
    return [];
  }
}

/**
 * Permanently disable the worker for this session and answer every in-flight
 * request synchronously. Called when the worker emits `error` / `messageerror`
 * — a module worker that fails to load surfaces here with NO useful detail
 * (message/filename/error all undefined). Before this existed, such a failure
 * left every pending promise unsettled, so the AI hung in "thinking" forever
 * and the board deadlocked (it's the AI's turn, the human can't act).
 */
function failOverToMainThread(reason: string): void {
  if (!workerInitFailed) {
    console.warn(`[ai] worker unavailable (${reason}); falling back to main-thread picker`);
  }
  workerInitFailed = true;
  if (worker) {
    try {
      worker.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
  }
  for (const p of pending.values()) {
    p.resolve(pickOnMainThread(p));
  }
  pending.clear();
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (workerInitFailed) return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data.requestId !== 'number') return;
      const handler = pending.get(data.requestId);
      if (!handler) return;
      pending.delete(data.requestId);
      if (data.type === 'result') {
        handler.resolve(data.moves);
      } else {
        // The worker caught an exception inside pickMove. Retry the same
        // input on the main thread rather than rejecting — a single failed
        // evaluation should not stall (or end) the AI's turn.
        handler.resolve(pickOnMainThread(handler));
      }
    });
    // Load/parse failure or a structured-clone messageerror. Neither carries
    // actionable detail; the only safe response is to stop using the worker
    // and serve outstanding + future requests on the main thread.
    worker.addEventListener('error', (e) => failOverToMainThread(e.message || 'error'));
    worker.addEventListener('messageerror', () => failOverToMainThread('messageerror'));
    return worker;
  } catch {
    workerInitFailed = true;
    return null;
  }
}

/**
 * Ask the AI to pick a turn's worth of moves. Runs in a Web Worker by
 * default; falls back to synchronous main-thread execution if the worker
 * can't be instantiated OR errors at runtime. This function never rejects:
 * the caller always receives a (possibly empty) move list, so the AI's turn
 * can always progress.
 */
export function pickMoveAsync(
  state: BoardState,
  remaining: readonly Die[],
  level: AILevel
): Promise<readonly Move[]> {
  const w = ensureWorker();
  if (!w) {
    return Promise.resolve(pickOnMainThread({ state, remaining, level }));
  }
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;
    pending.set(requestId, { resolve, reject, state, remaining, level });
    w.postMessage({
      type: 'pick',
      requestId,
      state,
      remaining: [...remaining],
      level,
    });
  });
}
