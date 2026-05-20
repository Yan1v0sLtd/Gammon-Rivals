import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  endTurn as engineEndTurn,
  initialBoard,
  legalMoves,
  winner as engineWinner,
  computeBearOffResult,
} from '../engine';
import type {
  BoardState,
  Die,
  DiceRoll,
  Move,
  Player,
  Position,
} from '../engine';
import { BAR, OFF } from '../engine/types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Database } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { DICE_ANIMATION_MS } from '../components/diceTiming';

type MatchRow = Database['public']['Tables']['matches']['Row'];
type MoveRow = Database['public']['Tables']['moves']['Row'];
type GameRow = Database['public']['Tables']['games']['Row'];

export type CubeValue = 1 | 2 | 4 | 8 | 16 | 32 | 64;

interface SubMoveJSON {
  readonly from: number | 'bar';
  readonly to: number | 'off';
  readonly die: number;
  readonly hit: boolean;
}

interface CurrentTurnJSON {
  readonly player: Player;
  readonly dice: readonly [number, number];
  readonly remaining: readonly number[];
  readonly subMoves: readonly SubMoveJSON[];
}

// Polling fallback when Realtime fails (rare). Refresh interval in ms.
const FALLBACK_POLL_MS = 8000;
// Tick the inactivity clock once per second so the UI re-renders.
const ACTIVITY_TICK_MS = 1000;
// Default threshold past which the waiting player can claim victory by
// inactivity. Difficulty-room matches override this via useOnlineGame's
// options arg so the threshold scales with the room's turn timer.
const DEFAULT_inactivityForfeitMs = 5 * 60 * 1000;

export interface UseOnlineGameOptions {
  /**
   * Maximum ms an inactive opponent gets before the local player can
   * claim a forfeit (or, once Task 22 lands, the AI takes over). For
   * difficulty-room matches this should be a small multiple of the
   * room's turn_seconds so the player isn't stuck waiting. Defaults
   * to 5 minutes for legacy non-tier matches.
   */
  readonly inactivityForfeitMs?: number;
  /**
   * Soft per-turn timer in seconds. Drives the visible countdown bar
   * and an auto-roll / auto-end-turn nudge when it hits zero. Distinct
   * from inactivityForfeitMs, which is the hard "you forfeit the
   * whole match" threshold. Difficulty rooms pass their tier's
   * turn_seconds here (15 for Beginner, 30 for Pro, etc.). null = no
   * visible timer (legacy invite matches).
   */
  readonly turnSeconds?: number | null;
}

function decodeMove(s: SubMoveJSON): Move {
  const from: Position = s.from === 'bar' ? BAR : s.from;
  const to: Position = s.to === 'off' ? OFF : s.to;
  return { from, to, die: s.die as Die, hit: s.hit };
}

function encodeFrom(p: Position): number | 'bar' {
  if (p === OFF) throw new Error('cannot move from off');
  if (p === BAR) return 'bar';
  return p;
}

function encodeTo(p: Position): number | 'off' {
  if (p === BAR) throw new Error('cannot move to bar');
  if (p === OFF) return 'off';
  return p;
}

function encodeMove(m: Move): SubMoveJSON {
  return { from: encodeFrom(m.from), to: encodeTo(m.to), die: m.die, hit: m.hit };
}

interface DerivedState {
  board: BoardState;
  currentTurn: CurrentTurnJSON | null;
  whoseTurn: Player; // logical turn (whose turn it is to play, not necessarily local)
}

function deriveState(moves: readonly MoveRow[], currentTurn: CurrentTurnJSON | null): DerivedState {
  let board = initialBoard();
  // Apply all completed turns
  for (const moveRow of moves) {
    const subs = (moveRow.sub_moves as unknown as readonly SubMoveJSON[]) ?? [];
    for (const sub of subs) {
      board = applyMove(board, decodeMove(sub));
    }
    board = engineEndTurn(board);
  }
  // Apply in-progress turn's submoves on top, but don't flip turn yet
  if (currentTurn && currentTurn.subMoves.length > 0) {
    for (const sub of currentTurn.subMoves) {
      board = applyMove(board, decodeMove(sub));
    }
  }
  const whoseTurn: Player = currentTurn
    ? currentTurn.player
    : moves.length === 0
      ? 'white'
      : moves[moves.length - 1]!.player === 'white'
        ? 'black'
        : 'white';
  return { board, currentTurn, whoseTurn };
}

export interface OnlineGameState {
  readonly loading: boolean;
  readonly error: string | null;
  readonly match: MatchRow | null;
  readonly currentGame: GameRow | null;
  readonly board: BoardState;
  readonly turn: Player;
  readonly localColor: Player | null;
  readonly isLocalTurn: boolean;
  readonly roll: DiceRoll | null;
  readonly remaining: readonly Die[];
  readonly selectedFrom: Position | null;
  readonly legalOrigins: readonly Position[];
  readonly validDestinations: readonly Position[];
  readonly opponentPreviewOrigins: readonly Position[];
  readonly opponentPreviewDestinations: readonly Position[];
  readonly canRoll: boolean;
  readonly canEndTurn: boolean;
  readonly gameWinner: Player | null;
  readonly matchFinished: boolean;
  readonly cubeValue: CubeValue;
  readonly cubeOwner: Player | null;
  readonly cubeOffer: Player | null;
  readonly canOfferDouble: boolean;
  readonly betweenGames: boolean;
  readonly inCrawfordGame: boolean;
  readonly secondsSinceActivity: number;
  readonly canClaimByInactivity: boolean;
  /** Soft turn timer ceiling in seconds (null = no visible timer). */
  readonly turnSecondsTotal: number | null;
  /** Soft turn timer remaining in seconds (null when total is null). */
  readonly turnSecondsLeft: number | null;
  /** Soft turn timer progress 0..1 (null when total is null). */
  readonly turnProgress: number | null;
}

export interface OnlineGameActions {
  rollDice(): Promise<void>;
  selectFrom(pos: Position): void;
  cancelSelection(): void;
  selectTo(pos: Position): Promise<void>;
  endTurn(): Promise<void>;
  offerDouble(): Promise<void>;
  acceptDouble(): Promise<void>;
  dropDouble(): Promise<void>;
  resign(): Promise<void>;
  claimByInactivity(): Promise<void>;
}

export function useOnlineGame(
  matchId: string | undefined,
  options: UseOnlineGameOptions = {}
): OnlineGameState & OnlineGameActions {
  const inactivityForfeitMs = options.inactivityForfeitMs ?? DEFAULT_inactivityForfeitMs;
  const turnSecondsTotal = options.turnSeconds ?? null;
  const { user } = useAuth();
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [currentGame, setCurrentGame] = useState<GameRow | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opponentPreviewReadyKey, setOpponentPreviewReadyKey] = useState<string | null>(null);
  const fetchInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const { data: m, error: mErr } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();
      if (mErr) throw mErr;
      // Defer setMatch until AFTER the dependent moves+game fetches
      // resolve, so the React render that picks up the new match row
      // ALSO has the matching moves array. The previous version did
      // setMatch(m) here and then awaited the moves fetch — between
      // those two state writes, there was a render with the NEW match
      // (current_turn cleared after endTurn) and the OLD moves (no
      // new row yet). deriveState saw moves=[] + currentTurn=null and
      // returned initialBoard(), which made BoardCanvas re-animate
      // the checker distribution. Bug only manifested visibly after
      // move 1 — move 2+ briefly showed [all-prior-moves] which
      // happened to look close enough to the real state.
      if (m?.current_game_id) {
        const [movesRes, gameRes] = await Promise.all([
          supabase
            .from('moves')
            .select('*')
            .eq('game_id', m.current_game_id)
            .order('ply', { ascending: true }),
          supabase
            .from('games')
            .select('*')
            .eq('id', m.current_game_id)
            .maybeSingle(),
        ]);
        if (movesRes.error) throw movesRes.error;
        if (gameRes.error) throw gameRes.error;
        // Single React batch: match + moves + game all land together.
        setMatch(m);
        setMoves(movesRes.data ?? []);
        setCurrentGame(gameRes.data);
      } else {
        setMatch(m);
        setMoves([]);
        setCurrentGame(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      fetchInFlight.current = false;
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    queueMicrotask(() => void refresh());

    let channel: RealtimeChannel | null = supabase
      .channel(`match-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        () => {
          void refresh();
        }
      )
      .on(
        'postgres_changes',
        // moves filter requires game_id which we may not have at subscribe time;
        // RLS already restricts inserts to user's own games, so listen broadly
        { event: 'INSERT', schema: 'public', table: 'moves' },
        () => {
          void refresh();
        }
      )
      .subscribe();

    // Low-frequency fallback poll in case the WebSocket drops silently
    const id = window.setInterval(() => {
      void refresh();
    }, FALLBACK_POLL_MS);

    return () => {
      window.clearInterval(id);
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [matchId, refresh]);

  // ---- derive ----
  const currentTurn: CurrentTurnJSON | null = useMemo(() => {
    const ct = match?.current_turn as unknown;
    if (!ct || typeof ct !== 'object') return null;
    return ct as CurrentTurnJSON;
  }, [match?.current_turn]);

  const derived = useMemo(() => deriveState(moves, currentTurn), [moves, currentTurn]);

  const localColor: Player | null = useMemo(() => {
    if (!match || !user) return null;
    if (user.id === match.owner_id) return match.owner_color === 'black' ? 'black' : 'white';
    if (user.id === match.opponent_id)
      return match.owner_color === 'white' ? 'black' : 'white';
    return null;
  }, [match, user]);

  const matchFinished = !!match?.finished_at;
  const gameFinishedInDb = !!currentGame?.finished_at;
  // Between-games = the current game is finished but the match isn't.
  // The board derives empty during this window because the next game hasn't started.
  const betweenGames = gameFinishedInDb && !matchFinished;
  // Between games, white always starts the next game (matches edge function expectation).
  const effectiveTurn: Player = betweenGames ? 'white' : derived.whoseTurn;
  const isLocalTurn = localColor !== null && effectiveTurn === localColor;

  // Crawford game: the first game played after either side first reached target-1.
  // No doubling allowed during the Crawford game (post-Crawford resumes doubling).
  const inCrawfordGame =
    !!match &&
    match.crawford_game_number !== null &&
    !!currentGame &&
    match.crawford_game_number === currentGame.game_number &&
    !gameFinishedInDb;
  const gameWinner = useMemo(
    () => (betweenGames ? (currentGame?.winner as Player | null) : engineWinner(derived.board)),
    [betweenGames, currentGame?.winner, derived.board]
  );

  // Cube state from match
  const cubeValue = (match?.cube_value ?? 1) as CubeValue;
  const cubeOwner = (match?.cube_owner ?? null) as Player | null;
  const cubeOffer = (match?.cube_offer ?? null) as Player | null;

  // Dice exposed to UI. Memoised so the array reference is stable
  // across renders when the dice values haven't actually changed —
  // DiceTray uses this as a useMemo dep, and a fresh-each-render
  // reference re-computes the trajectory + restarts the throw
  // animation every paint (the "dice spin forever and never land"
  // bug). HotSeat's useGame keeps roll in useState so it doesn't
  // hit this; useOnlineGame derives from currentTurn so we need to
  // memoise explicitly.
  const roll = useMemo<DiceRoll | null>(
    () => (currentTurn ? ([currentTurn.dice[0], currentTurn.dice[1]] as DiceRoll) : null),
    // Depend on the primitive dice values, not the parent
    // currentTurn object — a re-derive of currentTurn from match
    // jsonb produces a new object even when the dice didn't change.
    [currentTurn?.dice[0], currentTurn?.dice[1], currentTurn?.player]
  );
  const remaining = useMemo<readonly Die[]>(
    () => (currentTurn?.remaining ?? []) as readonly Die[],
    [currentTurn?.remaining]
  );
  const opponentPreviewKey =
    currentTurn && !isLocalTurn && currentTurn.remaining.length > 0 && !gameWinner
      ? [
          currentTurn.player,
          currentTurn.dice.join('-'),
          currentTurn.remaining.join('-'),
          currentTurn.subMoves.length,
        ].join(':')
      : null;
  const opponentPreviewReady =
    opponentPreviewKey !== null && opponentPreviewReadyKey === opponentPreviewKey;

  useEffect(() => {
    if (!opponentPreviewKey) return;
    const timer = window.setTimeout(
      () => setOpponentPreviewReadyKey(opponentPreviewKey),
      DICE_ANIMATION_MS
    );
    return () => window.clearTimeout(timer);
  }, [opponentPreviewKey]);

  const legal = useMemo(() => {
    if (!currentTurn || !isLocalTurn || gameWinner) return [] as readonly Move[];
    if (currentTurn.remaining.length === 0) return [];
    return legalMoves(derived.board, currentTurn.remaining as readonly Die[]);
  }, [currentTurn, isLocalTurn, derived.board, gameWinner]);

  const opponentLegal = useMemo(() => {
    if (!currentTurn || isLocalTurn || gameWinner || !opponentPreviewReady) {
      return [] as readonly Move[];
    }
    if (currentTurn.remaining.length === 0) return [];
    return legalMoves(derived.board, currentTurn.remaining as readonly Die[]);
  }, [currentTurn, isLocalTurn, derived.board, gameWinner, opponentPreviewReady]);

  const legalOrigins = useMemo(() => {
    const set = new Set<Position>();
    for (const m of legal) set.add(m.from);
    return Array.from(set);
  }, [legal]);

  const validDestinations = useMemo(() => {
    if (selectedFrom === null) return [] as Position[];
    return legal.filter((m) => m.from === selectedFrom).map((m) => m.to);
  }, [legal, selectedFrom]);

  const opponentPreviewOrigins = useMemo(() => {
    const set = new Set<Position>();
    for (const m of opponentLegal) set.add(m.from);
    return Array.from(set);
  }, [opponentLegal]);

  const opponentPreviewDestinations = useMemo(() => {
    const set = new Set<Position>();
    for (const m of opponentLegal) set.add(m.to);
    return Array.from(set);
  }, [opponentLegal]);

  const canRoll =
    !matchFinished &&
    !!match &&
    !!match.opponent_id &&
    currentTurn === null &&
    cubeOffer === null &&
    isLocalTurn;

  const canEndTurn =
    !matchFinished &&
    !betweenGames &&
    !engineWinner(derived.board) &&
    isLocalTurn &&
    currentTurn !== null &&
    (currentTurn.remaining.length === 0 || legal.length === 0);

  const canOfferDouble =
    !matchFinished &&
    !betweenGames &&
    !inCrawfordGame &&
    !!match &&
    !!match.opponent_id &&
    currentTurn === null &&
    cubeOffer === null &&
    isLocalTurn &&
    cubeValue < 64 &&
    (cubeOwner === null || cubeOwner === localColor);

  // ---- actions ----
  // In-flight guard: roll_dice is server-authoritative, and the edge
  // function returns 400 "turn already in progress" the moment the
  // first call lands. A double-click, or the auto-roll effect racing a
  // manual click, used to fire two parallel invocations — the second
  // would surface as a brief "Edge Function returned a non-2xx status
  // code" toast. We gate on a ref instead of in state so the close-
  // together calls in the same render cycle both see the same value.
  const rollInFlightRef = useRef(false);
  const rollDice = useCallback(async () => {
    if (!matchId) return;
    if (!canRoll) return;
    if (rollInFlightRef.current) return;
    rollInFlightRef.current = true;
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke('roll_dice', {
        body: { matchId },
      });
      if (invErr) {
        setError(invErr.message ?? 'roll failed');
        return;
      }
      if (data && typeof data === 'object' && 'error' in data) {
        setError(String((data as { error: unknown }).error));
        return;
      }
      void refresh();
    } finally {
      rollInFlightRef.current = false;
    }
  }, [matchId, canRoll, refresh]);

  const selectFrom = useCallback(
    (pos: Position) => {
      if (!isLocalTurn || !currentTurn) return;
      if (!legalOrigins.includes(pos)) {
        setSelectedFrom(null);
        return;
      }
      setSelectedFrom(pos);
    },
    [isLocalTurn, currentTurn, legalOrigins]
  );

  const cancelSelection = useCallback(() => setSelectedFrom(null), []);

  const selectTo = useCallback(
    async (pos: Position) => {
      if (!matchId || !match || !currentTurn || selectedFrom === null) return;
      if (!isLocalTurn) return;
      const move = legal.find((m) => m.from === selectedFrom && m.to === pos);
      if (!move) return;

      // Compute new turn state
      const newSubMoves = [...currentTurn.subMoves, encodeMove(move)];
      const idx = currentTurn.remaining.indexOf(move.die);
      const newRemaining =
        idx >= 0
          ? [...currentTurn.remaining.slice(0, idx), ...currentTurn.remaining.slice(idx + 1)]
          : [...currentTurn.remaining];

      const updated: CurrentTurnJSON = {
        ...currentTurn,
        subMoves: newSubMoves,
        remaining: newRemaining,
      };

      // Optimistic local update
      setMatch({ ...match, current_turn: updated as unknown as MatchRow['current_turn'] });
      setSelectedFrom(null);

      const { error: upErr } = await supabase
        .from('matches')
        .update({ current_turn: updated as unknown as Database['public']['Tables']['matches']['Update']['current_turn'] })
        .eq('id', matchId);
      if (upErr) {
        setError(upErr.message);
        void refresh();
      }
    },
    [matchId, match, currentTurn, selectedFrom, isLocalTurn, legal, refresh]
  );

  const endTurn = useCallback(async () => {
    if (!matchId || !match || !currentTurn || !match.current_game_id) return;
    if (!isLocalTurn) return;
    if (!canEndTurn) return;

    // Determine ply (count of existing moves)
    const ply = moves.length;

    // Insert moves row
    const { error: insErr } = await supabase.from('moves').insert({
      game_id: match.current_game_id,
      ply,
      player: currentTurn.player,
      dice: [currentTurn.dice[0], currentTurn.dice[1]],
      sub_moves: currentTurn.subMoves as unknown as Database['public']['Tables']['moves']['Insert']['sub_moves'],
    });
    if (insErr) {
      setError(insErr.message);
      return;
    }

    // Check for game end
    const winnerNow = engineWinner(derived.board);
    let matchUpdate: Database['public']['Tables']['matches']['Update'] = { current_turn: null };

    if (winnerNow) {
      const result = computeBearOffResult(
        {
          target: match.target,
          score: { white: match.white_score, black: match.black_score },
          gameNumber: 1,
          crawfordGameNumber: null,
          cube: { value: cubeValue, owner: cubeOwner },
          cubeOffer: null,
          winner: null,
        },
        derived.board,
        winnerNow
      );

      // Mark game finished
      await supabase
        .from('games')
        .update({
          winner: result.winner,
          win_type: result.winType,
          cube_value: cubeValue,
          cube_owner: cubeOwner,
          points_awarded: result.points,
          finished_at: new Date().toISOString(),
        })
        .eq('id', match.current_game_id);

      const newWhite =
        match.white_score + (result.winner === 'white' ? result.points : 0);
      const newBlack =
        match.black_score + (result.winner === 'black' ? result.points : 0);
      const matchOver = newWhite >= match.target || newBlack >= match.target;

      // Crawford detection: first time a player reaches target-1, the next game is Crawford.
      const oldMax = Math.max(match.white_score, match.black_score);
      const newMax = Math.max(newWhite, newBlack);
      const newCrawford =
        match.crawford_game_number === null && oldMax < match.target - 1 && newMax === match.target - 1
          ? (currentGame?.game_number ?? 0) + 1
          : match.crawford_game_number;

      // Keep current_game_id pointing at the just-finished game so both
      // clients can show a "game over" banner. The edge function on the
      // next roll detects this and lazy-creates the next game.
      matchUpdate = {
        current_turn: null,
        white_score: newWhite,
        black_score: newBlack,
        crawford_game_number: matchOver ? match.crawford_game_number : newCrawford,
        winner: matchOver ? result.winner : null,
        finished_at: matchOver ? new Date().toISOString() : null,
      };
    }

    const { error: upErr } = await supabase
      .from('matches')
      .update(matchUpdate)
      .eq('id', matchId);
    if (upErr) {
      setError(upErr.message);
    }
    void refresh();
  }, [
    matchId,
    match,
    currentTurn,
    isLocalTurn,
    canEndTurn,
    moves.length,
    derived.board,
    cubeValue,
    cubeOwner,
    currentGame?.game_number,
    refresh,
  ]);

  // ---- cube actions ----
  const offerDouble = useCallback(async () => {
    if (!matchId || !canOfferDouble || !localColor) return;
    setError(null);
    const { error: upErr } = await supabase
      .from('matches')
      .update({ cube_offer: localColor })
      .eq('id', matchId);
    if (upErr) setError(upErr.message);
    void refresh();
  }, [matchId, canOfferDouble, localColor, refresh]);

  const acceptDouble = useCallback(async () => {
    if (!matchId || !match || cubeOffer === null) return;
    if (localColor === null || cubeOffer === localColor) return; // only opponent of offerer
    setError(null);
    const newValue = Math.min(cubeValue * 2, 64);
    const { error: upErr } = await supabase
      .from('matches')
      .update({
        cube_value: newValue,
        cube_owner: localColor,
        cube_offer: null,
      })
      .eq('id', matchId);
    if (upErr) setError(upErr.message);
    void refresh();
  }, [matchId, match, cubeOffer, localColor, cubeValue, refresh]);

  const dropDouble = useCallback(async () => {
    if (!matchId || !match || cubeOffer === null) return;
    if (localColor === null || cubeOffer === localColor) return;
    if (!match.current_game_id) return;
    setError(null);

    // Offerer wins pre-double cube value (single).
    const winnerOfDrop: Player = cubeOffer;
    const points = cubeValue;

    await supabase
      .from('games')
      .update({
        winner: winnerOfDrop,
        win_type: 'single',
        cube_value: cubeValue,
        cube_owner: cubeOwner,
        dropped_double: true,
        points_awarded: points,
        finished_at: new Date().toISOString(),
      })
      .eq('id', match.current_game_id);

    const newWhite = match.white_score + (winnerOfDrop === 'white' ? points : 0);
    const newBlack = match.black_score + (winnerOfDrop === 'black' ? points : 0);
    const matchOver = newWhite >= match.target || newBlack >= match.target;

    const oldMax = Math.max(match.white_score, match.black_score);
    const newMax = Math.max(newWhite, newBlack);
    const newCrawford =
      match.crawford_game_number === null && oldMax < match.target - 1 && newMax === match.target - 1
        ? (currentGame?.game_number ?? 0) + 1
        : match.crawford_game_number;

    const { error: upErr } = await supabase
      .from('matches')
      .update({
        cube_offer: null,
        white_score: newWhite,
        black_score: newBlack,
        crawford_game_number: matchOver ? match.crawford_game_number : newCrawford,
        winner: matchOver ? winnerOfDrop : null,
        finished_at: matchOver ? new Date().toISOString() : null,
      })
      .eq('id', matchId);
    if (upErr) setError(upErr.message);
    void refresh();
  }, [matchId, match, cubeOffer, localColor, cubeValue, cubeOwner, currentGame, refresh]);

  // ---- inactivity timer ----
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ACTIVITY_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // The reason we don't use match.updated_at directly: at match
  // creation (or after a player navigates back to a long-running
  // match), match.updated_at may be much older than "now we care".
  // The previous version guarded with !!currentGame + !betweenGames to
  // dodge the false positive, but those guards also locked out the
  // legitimate cases where the opponent quits BEFORE rolling, or
  // DURING the between-games pause. We replace them with a per-mount
  // floor: the inactivity clock starts at max(match.updated_at, when-
  // this-hook-mounted). Effect: a fresh page load gives the opponent
  // at least one full threshold window to act, no matter how stale
  // the row is. Subsequent opponent activity bumps updated_at past
  // mount-time and resets the clock the same way.
  const mountedAtRef = useRef(Date.now());
  const matchUpdatedAtMs = match?.updated_at ? new Date(match.updated_at).getTime() : 0;
  const lastActivityMs = Math.max(matchUpdatedAtMs, mountedAtRef.current);

  const secondsSinceActivity = Math.max(0, Math.floor((now - lastActivityMs) / 1000));
  // canClaimByInactivity decides whether the auto-forfeit / AI takeover
  // path is allowed. Two guards remain after the per-mount floor:
  //   - !isLocalTurn means we're the one waiting on the opponent.
  //     The local player can't auto-claim their own inactivity.
  //   - opponent_id must exist (no claim before someone matched in).
  // We deliberately allow claim during !!currentGame=false (opponent
  // quits before first roll) and betweenGames (opponent quits during
  // inter-game pause) — both used to be unrecoverable.
  const canClaimByInactivity =
    !matchFinished &&
    !!match &&
    !!match.opponent_id &&
    !isLocalTurn &&
    now - lastActivityMs >= inactivityForfeitMs;

  // ---- soft per-turn timer ----
  // The inactivity-forfeit clock above is the HARD ceiling (60s+,
  // ends the match). This is the SOFT ceiling per turn — what the
  // Beginner/Pro/Expert tiers' turn_seconds actually controls. It
  // shares the same lastActivityMs baseline as the hard timer, so
  // each action by either side restarts both clocks together.
  //
  // We don't auto-pick legal moves when the timer expires (too
  // aggressive — would yank the player out of a thinking pause), but
  // we DO auto-roll and auto-end-turn since those are unambiguous
  // "the player has nothing to decide" cases. If the player has
  // legal moves remaining when the soft timer expires, they still
  // have the gap between turnSeconds and inactivityForfeitMs (2x+)
  // to finish before they actually lose the match.
  const turnSecondsLeft =
    turnSecondsTotal === null
      ? null
      : Math.max(0, turnSecondsTotal - secondsSinceActivity);
  const turnProgress =
    turnSecondsTotal === null || turnSecondsTotal === 0
      ? null
      : (turnSecondsLeft ?? 0) / turnSecondsTotal;

  /**
   * Finalises the match via the server-side finish_match RPC. The RPC
   * is the only path that gets PvP rewards (W/L coin awards, XP,
   * pvp_rating update) right; bypassing it via plain UPDATE — which the
   * previous version did — meant online matches paid out nothing. We
   * pass the per-side abandonment flags so the abandoner gets a zero
   * payout while still taking the ELO loss.
   *
   * Returns a discriminated result so callers (notably the auto-convert
   * effect) can react to specific failures — match_already_finished
   * isn't a real error from the caller's perspective, but a network
   * fault is.
   */
  const finalizeMatch = useCallback(
    async (args: {
      winner: Player;
      ownerAbandoned?: boolean;
      opponentAbandoned?: boolean;
    }): Promise<{ ok: true } | { ok: false; alreadyFinished: boolean; message: string }> => {
      if (!matchId || !match) return { ok: false, alreadyFinished: false, message: 'no match' };
      const winnerColor = args.winner;
      const points = Math.max(
        1,
        match.target - (winnerColor === 'white' ? match.white_score : match.black_score)
      );
      const newWhite = match.white_score + (winnerColor === 'white' ? points : 0);
      const newBlack = match.black_score + (winnerColor === 'black' ? points : 0);

      // Close out the in-progress game row so the games table doesn't
      // carry a dangling open game after the match finishes.
      if (match.current_game_id) {
        await supabase
          .from('games')
          .update({
            winner: winnerColor,
            win_type: 'single',
            points_awarded: points,
            finished_at: new Date().toISOString(),
          })
          .eq('id', match.current_game_id);
      }

      const { error: rpcErr } = await supabase.rpc('finish_match', {
        p_match_id: matchId,
        p_white_score: newWhite,
        p_black_score: newBlack,
        p_winner: winnerColor,
        p_crawford_game_number: match.crawford_game_number ?? null,
        p_owner_abandoned: args.ownerAbandoned ?? false,
        p_opponent_abandoned: args.opponentAbandoned ?? false,
      });
      if (rpcErr) {
        const msg = rpcErr.message ?? String(rpcErr);
        const alreadyFinished = msg.includes('match_already_finished');
        if (!alreadyFinished) setError(msg);
        return { ok: false, alreadyFinished, message: msg };
      }
      void refresh();
      return { ok: true };
    },
    [matchId, match, refresh]
  );

  const claimByInactivity = useCallback(async () => {
    if (!matchId || !match || !localColor || !canClaimByInactivity) return;
    setError(null);
    // We're the active side; the opponent is the abandoner. Flip the
    // abandonment flag matching the absent player's role.
    const opponentIsOwner = user?.id === match.opponent_id;
    await finalizeMatch({
      winner: localColor,
      ownerAbandoned: opponentIsOwner,
      opponentAbandoned: !opponentIsOwner,
    });
  }, [matchId, match, localColor, canClaimByInactivity, finalizeMatch, user]);

  /**
   * Auto-trigger when the opponent has been inactive past the
   * inactivity threshold. Two-step flow:
   *
   *   1. Call replace_opponent_with_ai to flip match.mode to ai-{level}
   *      (level picked from caller's pvp_rating server-side). This
   *      stashes abandoner_id in current_turn metadata for audit.
   *   2. Immediately finalise the match with the local player as
   *      winner and opponent marked abandoned. finish_match grants the
   *      PvP win prize + XP, zeroes the abandoner's payout, and applies
   *      the ELO update.
   *
   * Why not fully drive an AI through the remainder of the match: that
   * would require lifting the AI runner into useOnlineGame plus
   * teaching the realtime sync layer to write AI moves for the absent
   * color (roll_dice edge fn included). Substantial refactor. The
   * shorter path here delivers the UX problem the player is hitting
   * (stuck waiting for an opponent who's gone) and pays out the same
   * rewards. The full "continue vs AI" continuation is a follow-up.
   */
  const autoConvertedRef = useRef(false);
  useEffect(() => {
    if (!canClaimByInactivity) return;
    if (!matchId || !localColor || !match || !user) return;
    if (autoConvertedRef.current) return;
    autoConvertedRef.current = true;
    void (async () => {
      // supabase.rpc resolves to { data, error } — Postgres exceptions
      // come back via the `error` field, NOT a thrown promise. The
      // previous try/catch wrapping was effectively a no-op for the
      // common failure modes (opponent_still_active, race_lost,
      // not_a_pvp_match, match_already_finished). We now destructure
      // explicitly and release the latch on the right failure paths so
      // the user isn't permanently stuck waiting after a transient
      // server error.
      const { error: convertErr } = await supabase.rpc('replace_opponent_with_ai', {
        p_match_id: matchId,
        p_min_inactive_seconds: Math.floor(inactivityForfeitMs / 1000),
      });
      if (convertErr) {
        const msg = convertErr.message ?? String(convertErr);
        console.error('[useOnlineGame] replace_opponent_with_ai failed', msg, convertErr);
        // opponent_still_active: server saw activity since our last
        // poll. Release so the next tick can retry once the timer
        // climbs back past the threshold.
        // race_lost: a concurrent caller won. Realtime will sync our
        // view to the new mode; release and re-evaluate.
        // not_a_pvp_match: already converted on a prior cycle.
        // match_already_finished: someone else closed it — done.
        if (msg.includes('opponent_still_active') || msg.includes('race_lost')) {
          autoConvertedRef.current = false;
          return;
        }
        if (msg.includes('match_already_finished') || msg.includes('not_a_pvp_match')) {
          // Fall through to finalize anyway — the conversion already
          // happened (or doesn't apply), but we may still need to
          // close out the match for our side.
        } else {
          setError(msg);
          autoConvertedRef.current = false;
          return;
        }
      }

      // Conversion succeeded (or was already in place); now finalise.
      const opponentIsOwner = user.id === match.opponent_id;
      const result = await finalizeMatch({
        winner: localColor,
        ownerAbandoned: opponentIsOwner,
        opponentAbandoned: !opponentIsOwner,
      });
      if (!result.ok && !result.alreadyFinished) {
        // Real failure (network, RLS, server error). setError was
        // already called inside finalizeMatch. Release the latch so a
        // manual Claim button or the next tick can retry.
        console.error('[useOnlineGame] finalizeMatch failed during auto-forfeit', result.message);
        autoConvertedRef.current = false;
      }
    })();
  }, [canClaimByInactivity, matchId, localColor, match, user, finalizeMatch, inactivityForfeitMs]);

  // Soft turn-timer auto-action. When the per-turn timer hits zero on
  // the LOCAL side, nudge the obvious actions forward so the match
  // doesn't stall on a player who alt-tabbed:
  //   - canRoll: auto-roll (player forgot, or is AFK during their
  //     "your turn to roll" window)
  //   - canEndTurn: auto-end-turn (no dice remaining, or no legal
  //     moves — the only remaining action is to acknowledge the turn
  //     is done)
  // We DON'T auto-pick legal moves when remaining dice could still be
  // played — that'd be too aggressive, and the player still has the
  // gap to inactivityForfeitMs (2x+) before the match actually ends.
  const autoActionFiredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (turnSecondsLeft === null) return;
    if (turnSecondsLeft > 0) return;
    if (!isLocalTurn) return;
    if (matchFinished) return;
    // Build a key from the turn state so we only auto-fire ONCE per
    // turn boundary. Without this, after auto-roll lands and the next
    // render still shows turnSecondsLeft=0 briefly (until the refresh
    // pulls the new dice and bumps lastActivityMs), the effect would
    // re-fire and try to end an already-rolled turn.
    const key = [
      match?.id ?? '',
      currentGame?.id ?? 'no-game',
      currentTurn ? `${currentTurn.player}|${currentTurn.dice.join('-')}|${currentTurn.subMoves.length}` : 'no-turn',
      canRoll ? 'roll' : canEndTurn ? 'end' : 'noop',
    ].join('::');
    if (autoActionFiredKeyRef.current === key) return;
    autoActionFiredKeyRef.current = key;
    if (canRoll) {
      void rollDice();
    } else if (canEndTurn) {
      void endTurn();
    }
  }, [
    turnSecondsLeft,
    isLocalTurn,
    matchFinished,
    match?.id,
    currentGame?.id,
    currentTurn,
    canRoll,
    canEndTurn,
    rollDice,
    endTurn,
  ]);

  // Resign: end the match immediately, opponent wins remainder.
  const resign = useCallback(async () => {
    if (!matchId || !match || !localColor || matchFinished) return;
    setError(null);
    const winnerColor: Player = localColor === 'white' ? 'black' : 'white';
    // The local player is resigning (intentional abandonment). Mark
    // them as the abandoner so they get zero payout + ELO penalty.
    const localIsOwner = user?.id === match.owner_id;
    await finalizeMatch({
      winner: winnerColor,
      ownerAbandoned: localIsOwner,
      opponentAbandoned: !localIsOwner,
    });
  }, [matchId, match, localColor, matchFinished, finalizeMatch, user]);

  return {
    loading,
    error,
    match,
    currentGame,
    board: derived.board,
    turn: effectiveTurn,
    localColor,
    isLocalTurn,
    roll,
    remaining,
    selectedFrom,
    legalOrigins,
    validDestinations,
    opponentPreviewOrigins,
    opponentPreviewDestinations,
    canRoll,
    canEndTurn,
    gameWinner,
    matchFinished,
    cubeValue,
    cubeOwner,
    cubeOffer,
    canOfferDouble,
    betweenGames,
    inCrawfordGame,
    secondsSinceActivity,
    canClaimByInactivity,
    turnSecondsTotal,
    turnSecondsLeft,
    turnProgress,
    rollDice,
    selectFrom,
    cancelSelection,
    selectTo,
    endTurn,
    offerDouble,
    acceptDouble,
    dropDouble,
    resign,
    claimByInactivity,
  };
}
