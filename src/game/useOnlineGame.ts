import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  endTurn as engineEndTurn,
  initialBoard,
  legalMoves,
  winner as engineWinner,
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
import { useMatchPresence } from '../lib/useMatchPresence';
import type { Database } from '@shared/database';
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
  // Apply all completed turns. Each applyMove can throw if the move
  // row references a from/to that doesn't have the right checker —
  // a poisoned moves row would otherwise propagate the throw up
  // through React's render and the RouteErrorBoundary would catch
  // it. We tighten that here: on a bad move, log diagnostics + reset
  // to initialBoard for THAT turn segment, so the rest of the match
  // can still render. The diagnostics tell us exactly which row
  // and submove poisoned the state next time it happens.
  try {
    for (const moveRow of moves) {
      const subs = (moveRow.sub_moves as unknown as readonly SubMoveJSON[]) ?? [];
      for (const sub of subs) {
        board = applyMove(board, decodeMove(sub));
      }
      board = engineEndTurn(board);
    }
    if (currentTurn && currentTurn.subMoves.length > 0) {
      for (const sub of currentTurn.subMoves) {
        board = applyMove(board, decodeMove(sub));
      }
    }
  } catch (err) {
    console.error('[useOnlineGame] deriveState crashed — board state may be inconsistent', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      movesCount: moves.length,
      lastMoveSub: moves[moves.length - 1]?.sub_moves,
      currentTurn,
    });
    // Surface a recognisable signal so the UI can show "match
    // state recovery" instead of a silently-broken board.
    board = initialBoard();
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

// Grace period after the opponent's presence disappears before we
// trigger a forfeit. Short enough to feel immediate to the remaining
// player; long enough to absorb a brief refresh / network blip.
// 1.5s is well under the typical "user is mid-refresh" window
// (~3-4s on a slow page reload) so a legitimate refresh would still
// forfeit — but tab-close / navigate-away cases produce the "leave"
// event roughly instantly, so the visible delay before the
// match-over overlay is ~1.5s in those cases.
const PRESENCE_FORFEIT_GRACE_MS = 1500;

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

  // Per-match Realtime presence. When the opponent's tab closes /
  // navigates away / drops, the leave event fires within ~1s — much
  // faster than the time-based inactivity threshold which used to
  // be the only forfeit path.
  const { opponentOnline, opponentEverOnline } = useMatchPresence(
    matchId,
    user?.id ?? null,
  );
  const [opponentDisconnectedAt, setOpponentDisconnectedAt] = useState<number | null>(null);
  useEffect(() => {
    if (opponentOnline === true) {
      setOpponentDisconnectedAt(null);
    } else if (opponentOnline === false && opponentEverOnline) {
      // Only the "online then offline" transition counts as a
      // disconnect; the initial "not yet online" state shouldn't
      // trigger a forfeit (opponent may still be loading the page).
      setOpponentDisconnectedAt((prev) => prev ?? Date.now());
    }
  }, [opponentOnline, opponentEverOnline]);

  // Activity timestamps. Declared up here so the action callbacks
  // (rollDice, selectFrom, selectTo, endTurn) can bump
  // lastLocalActivityMs without a use-before-declare issue. The
  // matching effects + derivations live below in the "activity
  // timers" section.
  const mountedAtRef = useRef(Date.now());
  const [lastLocalActivityMs, setLastLocalActivityMs] = useState(() => Date.now());
  const [lastOpponentActivityMs, setLastOpponentActivityMs] = useState(() => Date.now());

  // Optimistic-update / refresh coordination. Declared here for the
  // same use-before-declare reason — refresh() reads these.
  const selectInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    if (fetchInFlight.current) return;
    // Defer while a local optimistic write (selectTo) is mid-flight.
    // A refresh during that window would read pre-write state and
    // clobber our optimistic setMatch. The selectTo's finally block
    // will re-fire this refresh once the DB UPDATE confirms.
    if (selectInFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
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

  // Track the current game id in a ref so the moves realtime
  // listener can filter without re-subscribing every time the game
  // changes. Without this filter, the listener used to fire on
  // EVERY moves INSERT in the entire database — a player in match A
  // would refresh on a move in match B. RLS restricts what they can
  // *read*, but realtime events still fire on any matching row.
  const currentGameIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentGameIdRef.current = currentGame?.id ?? match?.current_game_id ?? null;
  }, [currentGame?.id, match?.current_game_id]);

  useEffect(() => {
    if (!matchId) return;
    // Reset the in-flight guard at mount in case a previous instance
    // tore down mid-fetch and left it stuck at true.
    fetchInFlight.current = false;
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
        { event: 'INSERT', schema: 'public', table: 'moves' },
        (payload) => {
          // Filter client-side: only refresh on inserts into the
          // current game. supabase-js realtime doesn't natively
          // support a dynamic filter, and re-subscribing every time
          // the game id changes (between-games) would drop events.
          const row = payload?.new as { game_id?: string } | undefined;
          const targetGameId = currentGameIdRef.current;
          if (!targetGameId || row?.game_id !== targetGameId) return;
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
  // Shape validation matters here: replace_opponent_with_ai (the
  // auto-forfeit RPC) merges a side-channel _abandonment object into
  // current_turn so finish_match has an audit trail. If finalize then
  // races / fails, we can land in a state where current_turn is
  // `{_abandonment: {...}}` with NO engine fields. The downstream
  // code (deriveState, the roll/remaining memos, the auto-action
  // effect's key computation) all assume the engine shape — they
  // crash on `undefined.length` / `undefined[0]` / `undefined.join`,
  // taking the whole page blank. Validate the shape and treat a
  // metadata-only object as "no turn in progress" instead.
  const currentTurn: CurrentTurnJSON | null = useMemo(() => {
    const ct = match?.current_turn as unknown;
    if (!ct || typeof ct !== 'object') return null;
    const c = ct as Partial<CurrentTurnJSON>;
    if (
      (c.player !== 'white' && c.player !== 'black') ||
      !Array.isArray(c.dice) ||
      c.dice.length < 2 ||
      !Array.isArray(c.remaining) ||
      !Array.isArray(c.subMoves)
    ) {
      return null;
    }
    return c as CurrentTurnJSON;
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

  // ── Server-bot opponent (Phase 2b layer 2) ──────────────────────────────
  // A vs-AI match runs on this same online path (match.is_bot); no human posts
  // the opponent's moves. So when it becomes the bot's turn, poke the ai_move
  // edge function — the server rolls + picks + records the bot's move, which
  // then arrives via the realtime `moves` subscription and animates exactly
  // like a remote opponent. The owner is always white (created that way), so
  // the human opens and the bot never has to move first.
  const botPokeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!match?.is_bot || matchFinished || betweenGames) return;
    const botColor: Player = match.owner_color === 'white' ? 'black' : 'white';
    if (effectiveTurn !== botColor) return;
    // A turn with dice in progress is the human's — the bot commits its roll +
    // move atomically via ai_move and leaves no current_turn behind.
    if (currentTurn) return;
    // Poke at most once per distinct board state so a transient ai_move failure
    // can't spin a tight invoke loop. A reload resets this ref.
    const key = `${match.current_game_id ?? ''}:${moves.length}`;
    if (botPokeKeyRef.current === key) return;
    botPokeKeyRef.current = key;
    void (async () => {
      const { error: aiErr } = await supabase.functions.invoke('ai_move', {
        body: { matchId },
      });
      if (aiErr) console.error('[useOnlineGame] ai_move failed', aiErr);
      void refresh();
    })();
  }, [
    match?.is_bot,
    match?.owner_color,
    match?.current_game_id,
    effectiveTurn,
    currentTurn,
    betweenGames,
    matchFinished,
    moves.length,
    matchId,
    refresh,
  ]);

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
    setLastLocalActivityMs(Date.now());
    try {
      const { data, error: invErr } = await supabase.functions.invoke('roll_dice', {
        body: { matchId },
      });
      if (invErr) {
        // supabase-js wraps non-2xx responses in a FunctionsHttpError
        // whose .message is the generic "Edge Function returned a
        // non-2xx status code". The server's actual reason lives in
        // the response body. Crack it open so we (a) log the real
        // cause for diagnosis and (b) can silence benign races
        // instead of flashing a confusing toast to the user.
        let serverReason: string | null = null;
        let status: number | null = null;
        const ctx = (invErr as { context?: Response }).context;
        if (ctx) {
          status = ctx.status ?? null;
          try {
            const body = await ctx.clone().json();
            if (body && typeof body === 'object' && 'error' in body) {
              serverReason = String((body as { error: unknown }).error);
            }
          } catch {
            // Body wasn't JSON; try plain text as a last resort.
            try {
              const text = await ctx.clone().text();
              if (text) serverReason = text;
            } catch { /* give up */ }
          }
        }
        console.error('[useOnlineGame] roll_dice failed', {
          status,
          serverReason,
          generic: invErr.message,
        });
        const detail = serverReason ?? invErr.message ?? 'roll failed';
        // Benign races we should swallow:
        //   - "turn already in progress": some other path (auto-roll,
        //     a concurrent tab, a stale react double-fire) got the
        //     roll in first. Local state will sync via realtime;
        //     nothing for us to do.
        //   - "match finished": opponent claim or our own resign
        //     landed between our click and the round-trip.
        // Both surface as a flash to the user under the old code,
        // even though the server outcome is what we wanted anyway.
        if (
          detail.includes('turn already in progress') ||
          detail.includes('match finished') ||
          detail.includes('match_already_finished')
        ) {
          void refresh();
          return;
        }
        setError(detail);
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
      // Reset the soft turn timer on selection — selectFrom doesn't
      // write to the DB, so match.updated_at wouldn't otherwise
      // reflect that the player is actively interacting.
      setLastLocalActivityMs(Date.now());
    },
    [isLocalTurn, currentTurn, legalOrigins]
  );

  const cancelSelection = useCallback(() => setSelectedFrom(null), []);

  // selectInFlightRef + pendingRefreshRef are declared up top
  // (alongside the other activity refs) so refresh() can read them.
  // The selectTo callback sets selectInFlightRef during its DB write
  // window so the fallback poll doesn't clobber the optimistic state.
  const selectTo = useCallback(
    async (pos: Position) => {
      if (!matchId || !match || !currentTurn || selectedFrom === null) return;
      if (!isLocalTurn) return;
      const move = legal.find((m) => m.from === selectedFrom && m.to === pos);
      if (!move) return;
      setLastLocalActivityMs(Date.now());

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
      selectInFlightRef.current = true;
      setMatch({ ...match, current_turn: updated as unknown as MatchRow['current_turn'] });
      setSelectedFrom(null);

      try {
        const { error: upErr } = await supabase
          .from('matches')
          .update({ current_turn: updated as unknown as Database['public']['Tables']['matches']['Update']['current_turn'] })
          .eq('id', matchId);
        if (upErr) {
          setError(upErr.message);
          // Fall through to the finally so the in-flight ref clears
          // and the deferred refresh (if any) fires to re-sync.
        }
      } finally {
        selectInFlightRef.current = false;
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          void refresh();
        }
      }
    },
    [matchId, match, currentTurn, selectedFrom, isLocalTurn, legal, refresh]
  );

  // In-flight guard mirroring rollDice. Without it, the soft-turn-
  // timer auto-action effect can call endTurn at the same moment the
  // user manually clicks End Turn, producing two INSERTs for the same
  // (game_id, ply) and a duplicate-key error on the second.
  //
  // Note: we DO NOT check canEndTurn inside this function any more.
  // canEndTurn is a UI affordance ("show the End Turn button only
  // when the player has nothing else to do") — it is NOT a
  // correctness invariant. The soft-turn-timer auto-action calls
  // endTurn even when legal moves remain so the timer running out
  // actually advances the match. The player just loses their
  // unplayed dice — strong incentive to act within the timer.
  const endTurnInFlightRef = useRef(false);
  const endTurn = useCallback(async () => {
    if (!matchId || !match || !currentTurn || !match.current_game_id) return;
    if (!isLocalTurn) return;
    if (endTurnInFlightRef.current) return;
    endTurnInFlightRef.current = true;
    setLastLocalActivityMs(Date.now());
    try {
      // Server-authoritative turn commit (Phase 2b). The client no longer
      // computes or asserts the game outcome — it asks the server to commit
      // the current turn. The finish_turn edge function replays the recorded
      // moves + this turn's submoves through the shared engine, VALIDATES
      // every sub-move, DERIVES the true winner / win type / points / scores /
      // match winner / crawford, and writes them atomically via
      // commit_turn_server. This closes the coin-minting hole where the old
      // path trusted client-computed outcome fields (a client could finish a
      // turn — or match — claiming a fabricated win). The atomicity the old
      // finish_turn RPC provided is preserved inside commit_turn_server.
      const { data, error: invErr } = await supabase.functions.invoke('finish_turn', {
        body: { matchId },
      });
      if (invErr) {
        // supabase-js wraps non-2xx responses in a FunctionsHttpError whose
        // .message is generic; the server's real reason is in the response
        // body. Crack it open to log the cause and to silence benign races.
        let serverReason: string | null = null;
        let status: number | null = null;
        const ctx = (invErr as { context?: Response }).context;
        if (ctx) {
          status = ctx.status ?? null;
          try {
            const body = await ctx.clone().json();
            if (body && typeof body === 'object' && 'error' in body) {
              serverReason = String((body as { error: unknown }).error);
            }
          } catch {
            try {
              const text = await ctx.clone().text();
              if (text) serverReason = text;
            } catch { /* give up */ }
          }
        }
        console.error('[useOnlineGame] finish_turn failed', {
          status,
          serverReason,
          generic: invErr.message,
        });
        const detail = serverReason ?? invErr.message ?? 'end turn failed';
        // Benign races we can silently absorb (the server view advanced past
        // us, or another path already cleared current_turn). A refresh syncs.
        if (
          detail.includes('no_turn_in_progress') ||
          detail.includes('match_already_finished') ||
          detail.includes('not_your_turn')
        ) {
          void refresh();
          return;
        }
        setError(detail);
        return;
      }
      if (data && typeof data === 'object' && 'error' in data) {
        setError(String((data as { error: unknown }).error));
        return;
      }
      void refresh();
    } finally {
      endTurnInFlightRef.current = false;
    }
  }, [matchId, match, currentTurn, isLocalTurn, refresh]);

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

  // ---- activity timers ----
  // Two distinct clocks, tracking two distinct things:
  //
  //   lastLocalActivityMs: when did THE LOCAL PLAYER last do
  //     anything (click a piece, roll, end turn). Drives the soft
  //     per-turn timer / force-end. Reset by selectFrom too, even
  //     though selectFrom doesn't write to the DB — otherwise a
  //     player taking >turn_seconds to click "from -> to" gets
  //     force-ended mid-action, which feels like "my click didn't
  //     work" (the moves table got an empty submoves row before
  //     selectTo's DB write landed).
  //
  //   lastOpponentActivityMs: when did THE OPPONENT last do
  //     anything we can see (a new moves row by their color, or a
  //     change in current_turn while it's their turn). Drives the
  //     inactivity-claim. Critically NOT the same as match.updated_
  //     at — that bumps on OUR own writes too, including auto-roll
  //     / auto-end-turn. If we used match.updated_at, the remaining
  //     player's own automated actions would keep resetting the
  //     claim clock and we'd never auto-win against a quit
  //     opponent.
  //
  // Both have a mount-time floor so a fresh page load doesn't
  // immediately fire on a stale row.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ACTIVITY_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Reset the local clock at the start of each local turn so the
  // player always gets a fresh turn_seconds window.
  useEffect(() => {
    if (isLocalTurn) setLastLocalActivityMs(Date.now());
  }, [isLocalTurn]);

  // Opponent activity signature: a string that changes ONLY when
  // the opponent does something visible. Watches:
  //   - count of moves rows authored by the opposite color
  //   - if current_turn is owned by the opposite color, the dice
  //     roll + submoves length + remaining dice length
  // Local-player actions don't perturb this string.
  const oppositeColor: Player | null =
    localColor === 'white' ? 'black' : localColor === 'black' ? 'white' : null;
  const opponentSignature = useMemo(() => {
    if (!oppositeColor) return 'no-color';
    const oppMoveCount = moves.reduce(
      (n, m) => (m.player === oppositeColor ? n + 1 : n),
      0
    );
    const oppTurnPart =
      currentTurn && currentTurn.player === oppositeColor
        ? `${currentTurn.dice.join('-')}:${currentTurn.subMoves.length}:${currentTurn.remaining.length}`
        : '';
    return `${oppMoveCount}|${oppTurnPart}`;
  }, [moves, currentTurn, oppositeColor]);
  useEffect(() => {
    setLastOpponentActivityMs(Date.now());
  }, [opponentSignature]);

  const localClockBaseMs = Math.max(lastLocalActivityMs, mountedAtRef.current);
  const opponentClockBaseMs = Math.max(lastOpponentActivityMs, mountedAtRef.current);

  const secondsSinceLocalActivity = Math.max(
    0,
    Math.floor((now - localClockBaseMs) / 1000)
  );
  const secondsSinceOpponentActivity = Math.max(
    0,
    Math.floor((now - opponentClockBaseMs) / 1000)
  );

  // Public-facing inactivity number used by the UI countdown.
  // It's specifically about waiting on the opponent, so it tracks
  // opponent activity.
  const secondsSinceActivity = secondsSinceOpponentActivity;

  // Two paths to the forfeit:
  //   1. Time-based inactivity. Conservative fallback — fires when
  //      the opponent's last visible action was more than the
  //      room's inactivity threshold ago. Gated on !isLocalTurn so
  //      we don't auto-forfeit during our own turn.
  //   2. Presence-based disconnect. Fires the moment the opponent's
  //      Realtime channel reports them gone (tab closed, navigated
  //      to /home, network died), plus a small grace period for
  //      accidental refreshes. NO !isLocalTurn check — if they're
  //      gone, they're gone regardless of whose turn the engine
  //      thinks it is.
  const opponentDisconnectedFor =
    opponentDisconnectedAt !== null ? now - opponentDisconnectedAt : 0;
  const canForfeitByDisconnect =
    opponentDisconnectedAt !== null &&
    opponentDisconnectedFor >= PRESENCE_FORFEIT_GRACE_MS;

  const canClaimByInactivity =
    !matchFinished &&
    !!match &&
    !!match.opponent_id &&
    (canForfeitByDisconnect ||
      (!isLocalTurn && now - opponentClockBaseMs >= inactivityForfeitMs));

  // ---- soft per-turn timer ----
  // Driven by lastLocalActivityMs, NOT lastOpponentActivityMs. The
  // player has turn_seconds from their last interaction (or from
  // the start of their turn) to act. Each click resets the window.
  // Force-ends when the window expires AND it's the local turn AND
  // not between-games.
  const turnSecondsLeft =
    turnSecondsTotal === null
      ? null
      : Math.max(0, turnSecondsTotal - secondsSinceLocalActivity);
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

      // The in-progress game row is no longer closed by the client. Online
      // (PvP) games are RLS-locked to server-only writers (Phase 2b slice 4),
      // so this UPDATE would be denied. finish_match closes the dangling game
      // row when it finalizes (slice 5). The match still finalizes + pays via
      // the RPC below — only the (cosmetic) open game row lingers until then.

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
    console.info('[useOnlineGame] auto-forfeit firing', {
      matchId,
      secondsSinceActivity,
      inactivityForfeitMs,
      mode: match.mode,
      localColor,
    });
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
      console.info('[useOnlineGame] auto-forfeit: calling finish_match', {
        winner: localColor,
        opponentIsOwner,
      });
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
      } else {
        console.info('[useOnlineGame] auto-forfeit complete', {
          result,
        });
      }
    })();
  }, [canClaimByInactivity, matchId, localColor, match, user, finalizeMatch, inactivityForfeitMs, secondsSinceActivity]);

  // Soft turn-timer auto-action. When the per-turn timer hits zero on
  // the LOCAL side, force the match forward so an AFK player doesn't
  // stall the game:
  //   - canRoll: auto-roll (player forgot, or is AFK during their
  //     "your turn to roll" window).
  //   - currentTurn set (already rolled): force-end the turn with
  //     whatever submoves the player got in. They lose the value of
  //     unplayed dice — but the match advances. This is the deliberate
  //     trade for hard turn timers: act within turn_seconds or eat
  //     the penalty.
  // We DELIBERATELY skip the canEndTurn check here. canEndTurn only
  // becomes true when dice are spent or no legal moves remain; in the
  // "player has legal moves but isn't playing them" case we still
  // want to force-end.
  const autoActionFiredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (turnSecondsLeft === null) return;
    if (turnSecondsLeft > 0) return;
    if (!isLocalTurn) return;
    if (matchFinished) return;
    if (betweenGames) return;
    // Build a key from IMMUTABLE turn identity. Earlier versions
    // included currentTurn.subMoves.length / remaining.length, but
    // those change every time the player makes a submove — which
    // resets the latch and lets the auto-action fire again on the
    // SAME turn after a manual move lands. The right invariant: one
    // auto-action per (game, dice-roll) tuple, regardless of how
    // many submoves the player ended up making.
    const turnIdentity = currentTurn
      ? `${currentTurn.player}|${currentTurn.dice.join('-')}`
      : 'no-turn';
    const key = [
      match?.id ?? '',
      currentGame?.id ?? 'no-game',
      moves.length, // every endTurn (real or forced) increments this
      turnIdentity,
      canRoll ? 'roll' : currentTurn ? 'force-end' : 'noop',
    ].join('::');
    if (autoActionFiredKeyRef.current === key) return;
    autoActionFiredKeyRef.current = key;
    if (canRoll) {
      void rollDice();
    } else if (currentTurn) {
      // Force-end whatever turn is in progress, even if legal moves
      // remain. The internal endTurn no longer gates on canEndTurn.
      void endTurn();
    }
  }, [
    turnSecondsLeft,
    isLocalTurn,
    matchFinished,
    betweenGames,
    match?.id,
    currentGame?.id,
    moves.length,
    currentTurn,
    canRoll,
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
