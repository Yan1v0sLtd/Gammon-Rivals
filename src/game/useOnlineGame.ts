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
  readonly canRoll: boolean;
  readonly canEndTurn: boolean;
  readonly gameWinner: Player | null;
  readonly matchFinished: boolean;
  readonly cubeValue: CubeValue;
  readonly cubeOwner: Player | null;
  readonly cubeOffer: Player | null;
  readonly canOfferDouble: boolean;
  readonly betweenGames: boolean;
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
}

export function useOnlineGame(matchId: string | undefined): OnlineGameState & OnlineGameActions {
  const { user } = useAuth();
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [currentGame, setCurrentGame] = useState<GameRow | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
      setMatch(m);
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
        setMoves(movesRes.data ?? []);
        setCurrentGame(gameRes.data);
      } else {
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
    void refresh();

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
  const gameWinner = useMemo(
    () => (betweenGames ? (currentGame?.winner as Player | null) : engineWinner(derived.board)),
    [betweenGames, currentGame?.winner, derived.board]
  );

  // Cube state from match
  const cubeValue = (match?.cube_value ?? 1) as CubeValue;
  const cubeOwner = (match?.cube_owner ?? null) as Player | null;
  const cubeOffer = (match?.cube_offer ?? null) as Player | null;

  // Dice exposed to UI
  const roll: DiceRoll | null = currentTurn
    ? ([currentTurn.dice[0], currentTurn.dice[1]] as DiceRoll)
    : null;
  const remaining = (currentTurn?.remaining ?? []) as readonly Die[];

  const legal = useMemo(() => {
    if (!currentTurn || !isLocalTurn || gameWinner) return [] as readonly Move[];
    if (currentTurn.remaining.length === 0) return [];
    return legalMoves(derived.board, currentTurn.remaining as readonly Die[]);
  }, [currentTurn, isLocalTurn, derived.board, gameWinner]);

  const legalOrigins = useMemo(() => {
    const set = new Set<Position>();
    for (const m of legal) set.add(m.from);
    return Array.from(set);
  }, [legal]);

  const validDestinations = useMemo(() => {
    if (selectedFrom === null) return [] as Position[];
    return legal.filter((m) => m.from === selectedFrom).map((m) => m.to);
  }, [legal, selectedFrom]);

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
    !!match &&
    !!match.opponent_id &&
    currentTurn === null &&
    cubeOffer === null &&
    isLocalTurn &&
    cubeValue < 64 &&
    (cubeOwner === null || cubeOwner === localColor);

  // ---- actions ----
  const rollDice = useCallback(async () => {
    if (!matchId) return;
    if (!canRoll) return;
    setError(null);
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

      // Keep current_game_id pointing at the just-finished game so both
      // clients can show a "game over" banner. The edge function on the
      // next roll detects this and lazy-creates the next game.
      matchUpdate = {
        current_turn: null,
        white_score: newWhite,
        black_score: newBlack,
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
  }, [matchId, match, currentTurn, isLocalTurn, canEndTurn, moves.length, derived.board, cubeValue, cubeOwner, refresh]);

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

    const { error: upErr } = await supabase
      .from('matches')
      .update({
        cube_offer: null,
        white_score: newWhite,
        black_score: newBlack,
        winner: matchOver ? winnerOfDrop : null,
        finished_at: matchOver ? new Date().toISOString() : null,
      })
      .eq('id', matchId);
    if (upErr) setError(upErr.message);
    void refresh();
  }, [matchId, match, cubeOffer, localColor, cubeValue, cubeOwner, refresh]);

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
    canRoll,
    canEndTurn,
    gameWinner,
    matchFinished,
    cubeValue,
    cubeOwner,
    cubeOffer,
    canOfferDouble,
    betweenGames,
    rollDice,
    selectFrom,
    cancelSelection,
    selectTo,
    endTurn,
    offerDouble,
    acceptDouble,
    dropDouble,
  };
}
