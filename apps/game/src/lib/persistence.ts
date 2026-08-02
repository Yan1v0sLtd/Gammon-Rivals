import { supabase } from './supabase';
import type { GameResult } from '../../../../packages/engine/src/match';
import type { Move } from '../../../../packages/engine/src/types';
import type { AILevel } from '../../../../packages/ai/src/types';
import type { Database } from '../../../../packages/shared/src/database';

type MatchRow = Database['public']['Tables']['matches']['Row'];

export type MatchMode = 'hotseat' | `ai-${AILevel}` | 'online';

export function modeFromAi(ai: { level: AILevel } | null): MatchMode {
  return ai ? (`ai-${ai.level}` as const) : 'hotseat';
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
function generateInviteCode(len = 8): string {
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => INVITE_ALPHABET[n % INVITE_ALPHABET.length]).join('');
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateOnlineMatchArgs {
  ownerId: string;
  target: number;
  ownerColor?: 'white' | 'black';
  isPublic?: boolean;
}

export interface CreatedOnlineMatch {
  matchId: string;
  inviteCode: string;
}

export async function createOnlineMatch(args: CreateOnlineMatchArgs): Promise<CreatedOnlineMatch> {
  const expiresAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const { data, error } = await supabase
      .from('matches')
      .insert({
        owner_id: args.ownerId,
        mode: 'online',
        target: args.target,
        owner_color: args.ownerColor ?? 'white',
        invite_code: code,
        invite_expires_at: expiresAt,
        is_public: args.isPublic ?? false,
      })
      .select('id')
      .single();
    if (!error) return { matchId: data.id, inviteCode: code };
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not generate a unique invite code');
}

export async function joinMatchByInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_match_by_invite', { invite: code });
  if (error) throw error;
  if (!data) throw new Error('Invalid or expired invite');
  return data as string;
}

export async function joinPublicMatch(matchId: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_public_match', { target_match_id: matchId });
  if (error) throw error;
  if (!data) throw new Error('Could not join match');
  return data as string;
}

export async function matchmake(target: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('matchmake', { p_target: target });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function cancelMatchmaking(): Promise<void> {
  const { error } = await supabase.rpc('cancel_matchmaking', {});
  if (error) throw error;
}

export interface PublicMatchSummary {
  id: string;
  owner_id: string;
  target: number;
  started_at: string;
  is_active: boolean; // true once opponent_id is set (game in progress)
  ownerName: string;
  ownerRating: number;
}

/**
 * Fetch the current public lobby. Returns waiting (open) and active (in-progress)
 * public matches; finished matches are excluded.
 */
export async function listPublicMatches(): Promise<PublicMatchSummary[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, owner_id, opponent_id, target, started_at, owner_color, finished_at, is_public, profiles:owner_id (display_name, rating)'
    )
    .eq('is_public', true)
    .eq('mode', 'online')
    .is('finished_at', null)
    .order('started_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const prof = (row as unknown as { profiles: { display_name: string; rating: number } | null }).profiles;
    return {
      id: row.id,
      owner_id: row.owner_id,
      target: row.target,
      started_at: row.started_at,
      is_active: row.opponent_id !== null,
      ownerName: prof?.display_name ?? '—',
      ownerRating: prof?.rating ?? 1500,
    };
  });
}

export async function getMatchById(id: string): Promise<MatchRow | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function cancelMatch(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({ finished_at: new Date().toISOString(), winner: null })
    .eq('id', matchId);
  if (error) throw error;
}

/**
 * Permanently delete the signed-in user's account and all their data via the
 * self-scoped delete_my_account RPC (server-side cascade through profiles to
 * every player_ and user_ table). Irreversible. The caller should sign out after.
 * delete_my_account isn't in the generated Database types yet, so the rpc call
 * goes through a narrow cast.
 */
export async function deleteMyAccount(): Promise<void> {
  const rpc = supabase.rpc as unknown as (
    fn: 'delete_my_account'
  ) => PromiseLike<{ error: { message?: string } | null }>;
  const { error } = await rpc('delete_my_account');
  if (error) throw new Error(error.message ?? 'Account deletion failed');
}

export interface CreateMatchArgs {
  ownerId: string;
  mode: MatchMode;
  target: number;
}

export async function createMatch(args: CreateMatchArgs): Promise<string> {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      owner_id: args.ownerId,
      mode: args.mode,
      target: args.target,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

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

export interface FinishMatchArgs {
  matchId: string;
  whiteScore: number;
  blackScore: number;
  winner: 'white' | 'black';
  crawfordGameNumber: number | null;
}

/**
 * Legacy plain UPDATE — kept for online matches in /play/:id where the
 * owner-side bookkeeping is different and rewards aren't yet wired.
 * Difficulty-room matches go through finishMatchRpc() below instead so
 * the server can validate ownership + grant XP/coins atomically.
 */
export async function finishMatch(args: FinishMatchArgs): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({
      white_score: args.whiteScore,
      black_score: args.blackScore,
      winner: args.winner,
      crawford_game_number: args.crawfordGameNumber,
      finished_at: new Date().toISOString(),
    })
    .eq('id', args.matchId);
  if (error) throw error;
}

/**
 * Response from the finish_match RPC. xp_awarded / coins_awarded are 0
 * when the match wasn't a difficulty-room match or the caller didn't
 * win — the UI uses these to decide whether to show a reward popup at
 * end-of-match.
 */
export interface FinishMatchRewardResult {
  matchId: string;
  ownerWon: boolean;
  /** True when the match had both human owner and opponent. */
  isPvp: boolean;
  xpAwarded: number;
  xpMultiplier: number;
  coinsAwarded: number;
  /** Post-update PvP ELO ratings for both sides. Null for AI rows. */
  ownerRating: number | null;
  opponentRating: number | null;
  wallet: { coins: number; gems: number };
  profile: { xp: number; level: number };
}

/**
 * Server-side match completion + reward grant. Called instead of the
 * legacy plain UPDATE when we want the rewards (and the audit trail)
 * to be honest. Idempotent on the server: a second call against an
 * already-finished match raises `match_already_finished` rather than
 * double-paying.
 */
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

export async function finishMatchRpc(args: FinishMatchArgs & {
  /** Set true when finalising a forfeit-on-timeout for the owner.
   *  Zero payout for them; ELO still moves. */
  ownerAbandoned?: boolean;
  opponentAbandoned?: boolean;
}): Promise<FinishMatchRewardResult> {
  const { data, error } = await supabase.rpc('finish_match', {
    p_match_id: args.matchId,
    p_white_score: args.whiteScore,
    p_black_score: args.blackScore,
    p_winner: args.winner,
    p_crawford_game_number: args.crawfordGameNumber,
    p_owner_abandoned: args.ownerAbandoned ?? false,
    p_opponent_abandoned: args.opponentAbandoned ?? false,
  });
  if (error) throw error;
  const payload = data as {
    match_id: string;
    owner_won: boolean;
    is_pvp: boolean;
    xp_awarded: number;
    xp_multiplier: number;
    coins_awarded: number;
    owner_rating: number | null;
    opponent_rating: number | null;
    wallet: { coins: number; gems: number };
    profile: { xp: number; level: number };
  };
  return {
    matchId: payload.match_id,
    ownerWon: payload.owner_won,
    isPvp: payload.is_pvp,
    xpAwarded: payload.xp_awarded,
    xpMultiplier: payload.xp_multiplier,
    coinsAwarded: payload.coins_awarded,
    ownerRating: payload.owner_rating,
    opponentRating: payload.opponent_rating,
    wallet: payload.wallet,
    profile: payload.profile,
  };
}

export async function updateMatchScore(
  matchId: string,
  whiteScore: number,
  blackScore: number,
  crawfordGameNumber: number | null
): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({
      white_score: whiteScore,
      black_score: blackScore,
      crawford_game_number: crawfordGameNumber,
    })
    .eq('id', matchId);
  if (error) throw error;
}

export interface SaveGameArgs {
  matchId: string;
  gameNumber: number;
  result: GameResult;
  cubeOwner: 'white' | 'black' | null;
  wasCrawford: boolean;
  moves: ReadonlyArray<{
    player: 'white' | 'black';
    dice: readonly number[];
    subMoves: readonly Move[];
    /** Player's think-time on this turn, in ms. Null for AI turns and
     *  edge cases — we'd rather omit than fabricate. */
    elapsedMs?: number | null;
  }>;
}

/** Insert a finished game and all its turns in two round-trips. */
export async function saveGame(args: SaveGameArgs): Promise<void> {
  const { data: gameRow, error: gameErr } = await supabase
    .from('games')
    .insert({
      match_id: args.matchId,
      game_number: args.gameNumber,
      winner: args.result.winner,
      win_type: args.result.winType,
      cube_value: args.result.cubeValue,
      cube_owner: args.cubeOwner,
      dropped_double: args.result.droppedDouble,
      points_awarded: args.result.points,
      was_crawford: args.wasCrawford,
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (gameErr) throw gameErr;

  if (args.moves.length === 0) return;

  const rows = args.moves.map((m, i) => ({
    game_id: gameRow.id,
    ply: i,
    player: m.player,
    dice: [...m.dice],
    sub_moves: m.subMoves.map((mv) => ({
      from: mv.from,
      to: mv.to,
      die: mv.die,
      hit: mv.hit,
    })),
    elapsed_ms: m.elapsedMs ?? null,
  }));

  const { error: movesErr } = await supabase.from('moves').insert(rows);
  if (movesErr) throw movesErr;
}

export type MatchRowWithoutInternals = Omit<MatchRow, 'updated_at'>;
