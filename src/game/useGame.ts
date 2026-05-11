import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyGameResult,
  applyMove,
  canOfferDouble,
  computeBearOffResult,
  computeDropResult,
  endTurn as engineEndTurn,
  expandDice,
  initialBoard,
  legalMoves,
  newMatch as newMatchState,
  offerDouble as engineOfferDouble,
  acceptDouble as engineAcceptDouble,
  roll as rollDie,
  winner as engineWinner,
} from '../engine';
import type {
  BoardState,
  Die,
  DiceRoll,
  GameResult,
  MatchState,
  Move,
  Player,
  Position,
} from '../engine';
import { pickMoveAsync } from '../ai/client';
import type { AILevel } from '../ai';
import { DICE_ANIMATION_MS } from '../components/diceTiming';

const DEFAULT_TARGET = 7;

const AI_ROLL_DELAY = 500;
const AI_PER_MOVE_DELAY = 900;
const AI_END_TURN_DELAY = 400;
const AI_CUBE_DECISION_DELAY = 800;
// Wait at least this long after rolling before applying any move so the
// dice physics + center tween can finish.
const AI_DICE_SETTLE_MS = DICE_ANIMATION_MS;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface AIConfig {
  readonly player: Player;
  readonly level: AILevel;
}

export interface TurnRecord {
  readonly player: Player;
  readonly dice: DiceRoll;
  readonly subMoves: readonly Move[];
}

export interface UseGameOptions {
  readonly initialTarget?: number;
  readonly ai?: AIConfig | null;
}

export interface MatchGameState {
  readonly match: MatchState;
  readonly board: BoardState;
  readonly roll: DiceRoll | null;
  readonly remaining: readonly Die[];
  readonly selectedFrom: Position | null;
  readonly history: readonly Move[];
  readonly legalOrigins: readonly Position[];
  readonly validDestinations: readonly Position[];
  readonly opponentPreviewOrigins: readonly Position[];
  readonly opponentPreviewDestinations: readonly Position[];
  readonly canEndTurn: boolean;
  readonly canOfferDouble: boolean;
  readonly canUndo: boolean;
  readonly pendingOffer: Player | null;
  readonly lastGameResult: GameResult | null;
  readonly matchOver: boolean;
  readonly inCrawfordGame: boolean;
  readonly isAITurn: boolean;
  readonly isAIThinking: boolean;
  readonly turnLog: readonly TurnRecord[];
}

export interface MatchGameActions {
  rollDice(): void;
  selectFrom(pos: Position): void;
  cancelSelection(): void;
  selectTo(pos: Position): void;
  /** Revert the most recent move played in the current turn. Disabled
   *  on AI turns and once the turn is ended (no longer "the most
   *  recent move" in a meaningful sense). */
  undoLastMove(): void;
  endTurn(): void;
  offerDouble(): void;
  acceptDouble(): void;
  dropDouble(): void;
  nextGame(): void;
  newMatch(target?: number, ai?: AIConfig | null): void;
}

/**
 * Snapshot captured immediately before a checker move is applied. Holds
 * exactly what's needed to roll back ONE move — board state, the dice
 * still available, the move history, and the per-turn log. We keep the
 * most recent snapshot only; chaining multiple undos isn't supported by
 * design.
 */
interface MoveSnapshot {
  readonly board: BoardState;
  readonly remaining: readonly Die[];
  readonly history: readonly Move[];
  readonly turnLog: readonly TurnRecord[];
}

export function useGame(opts: UseGameOptions = {}): MatchGameState & MatchGameActions {
  const initialTarget = opts.initialTarget ?? DEFAULT_TARGET;
  const [match, setMatch] = useState<MatchState>(() => newMatchState(initialTarget));
  const [board, setBoard] = useState<BoardState>(initialBoard);
  const [diceRoll, setDiceRoll] = useState<DiceRoll | null>(null);
  const [remaining, setRemaining] = useState<readonly Die[]>([]);
  const [selectedFrom, setSelectedFrom] = useState<Position | null>(null);
  const [history, setHistory] = useState<readonly Move[]>([]);
  const [lastGameResult, setLastGameResult] = useState<GameResult | null>(null);
  const [ai, setAi] = useState<AIConfig | null>(opts.ai ?? null);
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [aiPreviewReady, setAiPreviewReady] = useState(false);
  const [turnLog, setTurnLog] = useState<readonly TurnRecord[]>([]);
  // Snapshot of the state immediately BEFORE the most recent player move.
  // Set in selectTo, cleared on roll/endTurn/new game/AI move. Lets us
  // implement single-step undo without rebuilding the board from history.
  const [undoSnapshot, setUndoSnapshot] = useState<MoveSnapshot | null>(null);

  const startTurnRecord = useCallback((player: Player, dice: DiceRoll) => {
    setTurnLog((curr) => [...curr, { player, dice, subMoves: [] }]);
  }, []);

  const appendMoveToTurn = useCallback((move: Move) => {
    setTurnLog((curr) => {
      if (curr.length === 0) return curr;
      const last = curr[curr.length - 1]!;
      return [...curr.slice(0, -1), { ...last, subMoves: [...last.subMoves, move] }];
    });
  }, []);

  const matchOver = match.winner !== null;
  const gameFrozen = lastGameResult !== null || matchOver;
  const inCrawfordGame =
    match.crawfordGameNumber !== null && match.crawfordGameNumber === match.gameNumber;
  const isAITurn = ai !== null && board.turn === ai.player && !gameFrozen;

  const legal = useMemo(
    () => (remaining.length > 0 && !gameFrozen ? legalMoves(board, remaining) : []),
    [board, remaining, gameFrozen]
  );

  const legalOrigins = useMemo(() => {
    const set = new Set<Position>();
    for (const m of legal) set.add(m.from);
    return Array.from(set);
  }, [legal]);

  const validDestinations = useMemo(() => {
    if (selectedFrom === null) return [] as Position[];
    return legal.filter((m) => m.from === selectedFrom).map((m) => m.to);
  }, [legal, selectedFrom]);

  const opponentPreviewOrigins = useMemo(
    () => (isAITurn && aiPreviewReady ? legalOrigins : []),
    [aiPreviewReady, isAITurn, legalOrigins]
  );

  const opponentPreviewDestinations = useMemo(() => {
    if (!isAITurn || !aiPreviewReady) return [] as Position[];
    const set = new Set<Position>();
    for (const m of legal) set.add(m.to);
    return Array.from(set);
  }, [aiPreviewReady, isAITurn, legal]);

  const canEndTurn =
    diceRoll !== null && !gameFrozen && (remaining.length === 0 || legal.length === 0);

  const canOfferDoubleNow =
    diceRoll === null &&
    !gameFrozen &&
    !isAITurn &&
    match.cubeOffer === null &&
    canOfferDouble(match, board.turn);

  const rollDice = useCallback(() => {
    if (diceRoll !== null || gameFrozen || match.cubeOffer !== null) return;
    const r = rollDie();
    setDiceRoll(r);
    setRemaining(expandDice(r));
    setSelectedFrom(null);
    setHistory([]);
    setUndoSnapshot(null);
    setAiPreviewReady(false);
    startTurnRecord(board.turn, r);
  }, [diceRoll, gameFrozen, match.cubeOffer, board.turn, startTurnRecord]);

  const selectFrom = useCallback(
    (pos: Position) => {
      if (!legalOrigins.includes(pos)) {
        setSelectedFrom(null);
        return;
      }
      setSelectedFrom(pos);
    },
    [legalOrigins]
  );

  const cancelSelection = useCallback(() => setSelectedFrom(null), []);

  const selectTo = useCallback(
    (pos: Position) => {
      if (selectedFrom === null) return;
      const move = legal.find((m) => m.from === selectedFrom && m.to === pos);
      if (!move) return;

      const next = applyMove(board, move);
      const dieIdx = remaining.indexOf(move.die);
      const nextRemaining =
        dieIdx >= 0
          ? [...remaining.slice(0, dieIdx), ...remaining.slice(dieIdx + 1)]
          : [...remaining];

      // Snapshot the current state BEFORE we commit the move so the user
      // can undo it. We only keep the most recent move's snapshot.
      setUndoSnapshot({ board, remaining, history, turnLog });

      setBoard(next);
      setRemaining(nextRemaining);
      setHistory([...history, move]);
      setSelectedFrom(null);
      appendMoveToTurn(move);

      const w = engineWinner(next);
      if (w) {
        const result = computeBearOffResult(match, next, w);
        setMatch(applyGameResult(match, result));
        setLastGameResult(result);
        // Game ended — undo would be confusing once the result modal is up.
        setUndoSnapshot(null);
      }
    },
    [selectedFrom, legal, board, remaining, history, turnLog, match, appendMoveToTurn]
  );

  const undoLastMove = useCallback(() => {
    if (!undoSnapshot) return;
    if (gameFrozen) return;
    if (isAITurn) return;
    setBoard(undoSnapshot.board);
    setRemaining(undoSnapshot.remaining);
    setHistory(undoSnapshot.history);
    setTurnLog(undoSnapshot.turnLog);
    setSelectedFrom(null);
    setUndoSnapshot(null);
  }, [undoSnapshot, gameFrozen, isAITurn]);

  const endTurn = useCallback(() => {
    if (!canEndTurn) return;
    setBoard(engineEndTurn(board));
    setDiceRoll(null);
    setRemaining([]);
    setSelectedFrom(null);
    setHistory([]);
    setUndoSnapshot(null);
    setAiPreviewReady(false);
  }, [canEndTurn, board]);

  const offerDouble = useCallback(() => {
    if (!canOfferDoubleNow) return;
    setMatch(engineOfferDouble(match, board.turn));
  }, [canOfferDoubleNow, match, board.turn]);

  const acceptDouble = useCallback(() => {
    if (match.cubeOffer === null) return;
    setMatch(engineAcceptDouble(match));
  }, [match]);

  const dropDouble = useCallback(() => {
    if (match.cubeOffer === null) return;
    const result = computeDropResult(match);
    setMatch(applyGameResult(match, result));
    setLastGameResult(result);
  }, [match]);

  const nextGame = useCallback(() => {
    if (lastGameResult === null) return;
    if (matchOver) return;
    setBoard(initialBoard());
    setDiceRoll(null);
    setRemaining([]);
    setSelectedFrom(null);
    setHistory([]);
    setLastGameResult(null);
    setTurnLog([]);
    setUndoSnapshot(null);
    setAiPreviewReady(false);
  }, [lastGameResult, matchOver]);

  const newMatch = useCallback(
    (target: number = match.target, nextAi: AIConfig | null = ai) => {
      setMatch(newMatchState(target));
      setBoard(initialBoard());
      setDiceRoll(null);
      setRemaining([]);
      setSelectedFrom(null);
      setHistory([]);
      setLastGameResult(null);
      setAi(nextAi);
      setTurnLog([]);
      setUndoSnapshot(null);
      setAiPreviewReady(false);
    },
    [match.target, ai]
  );

  // -------------------- AI orchestration --------------------
  const aiActiveRef = useRef(false);
  const stateRef = useRef({ match, board, remaining });
  useEffect(() => {
    stateRef.current = { match, board, remaining };
  }, [match, board, remaining]);

  // Apply a planned sequence of moves with delays for visual feedback.
  // Maintains local copies of state to avoid stale-closure issues.
  const playAISequence = useCallback(
    async (initialMoves: readonly Move[]) => {
      let curBoard = stateRef.current.board;
      let curRemaining = [...stateRef.current.remaining];
      const movesPlayed: Move[] = [];
      // appendMoveToTurn captured by closure; deps below
      void appendMoveToTurn;

      for (const move of initialMoves) {
        await sleep(AI_PER_MOVE_DELAY);
        setAiPreviewReady(false);
        curBoard = applyMove(curBoard, move);
        const idx = curRemaining.indexOf(move.die);
        if (idx >= 0) {
          curRemaining = [
            ...curRemaining.slice(0, idx),
            ...curRemaining.slice(idx + 1),
          ];
        }
        movesPlayed.push(move);
        setBoard(curBoard);
        setRemaining(curRemaining);
        setHistory((h) => [...h, move]);
        appendMoveToTurn(move);

        const w = engineWinner(curBoard);
        if (w) {
          const m = stateRef.current.match;
          const result = computeBearOffResult(m, curBoard, w);
          setMatch(applyGameResult(m, result));
          setLastGameResult(result);
          return;
        }
      }

      await sleep(AI_END_TURN_DELAY);
      setBoard(engineEndTurn(curBoard));
      setDiceRoll(null);
      setRemaining([]);
      setHistory([]);
    },
    [appendMoveToTurn]
  );

  // Drive AI behaviour: roll → plan → play, and answer cube offers.
  useEffect(() => {
    if (!ai) return;
    if (gameFrozen) return;
    if (aiActiveRef.current) return;

    // Cube offer pending against AI: respond.
    if (match.cubeOffer !== null && match.cubeOffer !== ai.player) {
      aiActiveRef.current = true;
      queueMicrotask(() => setIsAIThinking(true));
      (async () => {
        await sleep(AI_CUBE_DECISION_DELAY);
        // v1: AI always accepts. Cube AI is a future improvement.
        setMatch((m) => (m.cubeOffer !== null ? engineAcceptDouble(m) : m));
        aiActiveRef.current = false;
        setIsAIThinking(false);
      })();
      return;
    }

    if (board.turn !== ai.player) return;

    // Roll if not rolled
    if (diceRoll === null) {
      aiActiveRef.current = true;
      const aiPlayer = ai.player;
      (async () => {
        await sleep(AI_ROLL_DELAY);
        const r = rollDie();
        setDiceRoll(r);
        setRemaining(expandDice(r));
        setSelectedFrom(null);
        setHistory([]);
        setUndoSnapshot(null);
        setAiPreviewReady(false);
        startTurnRecord(aiPlayer, r);
        aiActiveRef.current = false;
      })();
      return;
    }

    // Plan + play (only when no moves played yet this turn).
    // pickMoveAsync runs in parallel with the dice-settle wait so the AI's
    // thinking time doesn't add on top of the dice animation.
    if (history.length === 0 && remaining.length > 0) {
      aiActiveRef.current = true;
      queueMicrotask(() => setIsAIThinking(true));
      (async () => {
        const planPromise = pickMoveAsync(board, remaining, ai.level);
        await sleep(AI_DICE_SETTLE_MS);
        setAiPreviewReady(true);
        const plan = await planPromise;
        setIsAIThinking(false);
        if (plan.length === 0) {
          await sleep(AI_END_TURN_DELAY);
          setAiPreviewReady(false);
          setBoard((b) => engineEndTurn(b));
          setDiceRoll(null);
          setRemaining([]);
          setHistory([]);
        } else {
          await playAISequence(plan);
        }
        aiActiveRef.current = false;
      })();
    }
  }, [
    ai,
    board,
    diceRoll,
    remaining,
    history.length,
    gameFrozen,
    match.cubeOffer,
    playAISequence,
    startTurnRecord,
  ]);

  const canUndo = undoSnapshot !== null && !gameFrozen && !isAITurn;

  return {
    match,
    board,
    roll: diceRoll,
    remaining,
    selectedFrom,
    history,
    legalOrigins,
    validDestinations,
    opponentPreviewOrigins,
    opponentPreviewDestinations,
    canEndTurn,
    canOfferDouble: canOfferDoubleNow,
    canUndo,
    pendingOffer: match.cubeOffer,
    lastGameResult,
    matchOver,
    inCrawfordGame,
    isAITurn,
    isAIThinking,
    turnLog,
    rollDice,
    selectFrom,
    cancelSelection,
    selectTo,
    undoLastMove,
    endTurn,
    offerDouble,
    acceptDouble,
    dropDouble,
    nextGame,
    newMatch,
  };
}
