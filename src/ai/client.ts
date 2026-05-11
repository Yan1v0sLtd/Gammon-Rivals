import type { BoardState, Die, Move } from '../engine';
import { pickMove } from './picker';
import type { AILevel } from './types';

interface Pending {
  resolve(moves: readonly Move[]): void;
  reject(err: Error): void;
}

let worker: Worker | null = null;
let workerInitFailed = false;
const pending = new Map<number, Pending>();
let nextRequestId = 1;

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
      } else if (data.type === 'error') {
        handler.reject(new Error(data.error ?? 'AI worker error'));
      }
    });
    worker.addEventListener('error', (e) => {
      console.warn('AI worker error', e.message);
    });
    return worker;
  } catch {
    workerInitFailed = true;
    return null;
  }
}

/**
 * Ask the AI to pick a turn's worth of moves. Runs in a Web Worker by
 * default; falls back to synchronous main-thread execution if the worker
 * can't be instantiated (e.g. in a test environment without bundler support).
 */
export function pickMoveAsync(
  state: BoardState,
  remaining: readonly Die[],
  level: AILevel
): Promise<readonly Move[]> {
  const w = ensureWorker();
  if (!w) {
    const result = pickMove(state, [...remaining], level);
    return Promise.resolve(result.moves);
  }
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;
    pending.set(requestId, { resolve, reject });
    w.postMessage({
      type: 'pick',
      requestId,
      state,
      remaining: [...remaining],
      level,
    });
  });
}
