import { supabase } from '../../lib/supabase';
import type { MatchMode } from '../../lib/persistence';

/**
 * Result of a tier matchmaking poll. The server is the source of truth
 * for status — either matched (with a match_id ready to navigate into)
 * or still queued. The client polls every ~500ms; after ~4 seconds of
 * "queued" results the client falls back to enterRoomAiFallback().
 */
export interface FindMatchResult {
  status: 'matched' | 'queued';
  /** Set when status='matched'. */
  matchId?: string;
  /** Set when status='matched'. The PvP opponent's profile id + rating. */
  opponentId?: string;
  opponentRating?: number;
  /** Caller's own pvp_rating snapshot — useful for the "looking for
   *  opponents around X" overlay copy. */
  rating: number;
  turnSeconds?: number;
  target?: number;
  /** Post-debit wallet (only present on matched). */
  wallet?: { coins: number; gems: number };
}

/**
 * Polls the PvP matchmaker for the given tier. The RPC enqueues the
 * caller (idempotent), tries to find a partner within +/- 200 ELO,
 * and on a successful pair atomically debits both entry fees +
 * creates the matches row. Until that happens the caller stays in the
 * queue and the RPC returns status='queued' — call again after a short
 * delay. Raises: not_authenticated, room_not_found, room_disabled,
 * pvp_not_allowed_in_tier, insufficient_coins.
 *
 * ─── MATCHMAKING IS THEME-BLIND BY DESIGN ─────────────────────────
 * The only matching dimensions are tableConfigId (difficulty tier)
 * and rating band. Board themes are PER-CLIENT cosmetics — each
 * player chooses their own from the lobby carousel and sees their
 * own theme during the match. The matches table doesn't store a
 * board id; each client reads its theme from its own URL's
 * `?board=…` query param (see PlayOnline / HotSeat). Two players
 * with completely different theme inventories CAN and SHOULD match.
 *
 * Do not add `boardId` / `themeId` parameters to this signature.
 * If a future feature legitimately needs the board choice on the
 * server (e.g. validating ownership), pass it via a separate RPC
 * and don't gate matchmaking on it.
 * ─────────────────────────────────────────────────────────────────
 */
export async function findMatchInTier(args: {
  tableConfigId: string;
  ratingBand?: number;
}): Promise<FindMatchResult> {
  const { data, error } = await supabase.rpc('find_match_in_tier', {
    p_table_config_id: args.tableConfigId,
    p_rating_band: args.ratingBand ?? 200,
  });
  if (error) throw error;
  const payload = data as {
    status: 'matched' | 'queued';
    match_id?: string;
    opponent_id?: string;
    opponent_rating?: number;
    rating: number;
    turn_seconds?: number;
    target?: number;
    wallet?: { coins: number; gems: number };
  };
  return {
    status: payload.status,
    matchId: payload.match_id,
    opponentId: payload.opponent_id,
    opponentRating: payload.opponent_rating,
    rating: payload.rating,
    turnSeconds: payload.turn_seconds,
    target: payload.target,
    wallet: payload.wallet,
  };
}

/**
 * Cancel matchmaking — removes the caller from the queue. Idempotent;
 * a no-op if they aren't queued.
 */
export async function cancelMatchmakingRpc(): Promise<void> {
  await supabase.rpc('cancel_matchmaking');
}

/**
 * AI fallback path called after the matchmaking timeout. Picks AI
 * strength from caller's pvp_rating with cfg.ai_level as the floor,
 * debits the entry fee, creates the match. Same payload shape as the
 * old enter_room result.
 *
 * Same theme-blindness contract as findMatchInTier above — only
 * the tier is passed; the AI doesn't care about the player's chosen
 * board theme, and the matches row never stores a board id.
 */
export interface EnterRoomResult {
  matchId: string;
  turnSeconds: number;
  mode: MatchMode;
  target: number;
  aiLevel: 'easy' | 'medium' | 'hard';
  /** True when the tier routes AI through the server bot (mode='online' + is_bot). */
  isBot: boolean;
  botLevel: 'easy' | 'medium' | 'hard' | null;
  streakLen: number;
  wallet: { coins: number; gems: number };
}

export async function enterRoomAiFallback(args: {
  tableConfigId: string;
}): Promise<EnterRoomResult> {
  const { data, error } = await supabase.rpc('enter_room_ai_fallback', {
    p_table_config_id: args.tableConfigId,
  });
  if (error) throw error;
  const payload = data as {
    match_id: string;
    turn_seconds: number;
    mode: MatchMode;
    target: number;
    ai_level: 'easy' | 'medium' | 'hard';
    is_bot?: boolean;
    bot_level?: 'easy' | 'medium' | 'hard' | null;
    streak_len: number;
    wallet: { coins: number; gems: number };
  };
  return {
    matchId: payload.match_id,
    turnSeconds: payload.turn_seconds,
    mode: payload.mode,
    target: payload.target,
    aiLevel: payload.ai_level,
    isBot: payload.is_bot ?? false,
    botLevel: payload.bot_level ?? null,
    streakLen: payload.streak_len,
    wallet: payload.wallet,
  };
}

/**
 * Best-effort cleanup of orphan difficulty matches the caller owns.
 * Called from the lobby on mount so abandoned tabs don't drag the
 * RTP dashboard sideways. Fires server-side via the
 * abandon_stale_matches RPC; the matches that are still recent
 * (within 60min default) are left alone, so a player who closes
 * the lobby and immediately reopens it doesn't lose an active match.
 *
 * Failures are intentionally swallowed by the caller — this is data
 * hygiene, not a user-facing flow.
 */
export async function abandonStaleMatches(maxAgeMinutes?: number): Promise<number> {
  const { data, error } = await supabase.rpc(
    'abandon_stale_matches',
    maxAgeMinutes === undefined ? {} : { p_max_age_minutes: maxAgeMinutes },
  );
  if (error) throw error;
  const payload = data as { abandoned_count: number };
  return payload?.abandoned_count ?? 0;
}
