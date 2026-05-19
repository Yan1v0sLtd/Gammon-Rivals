import { supabase } from './supabase';
import type { GameResult, Move } from '../engine';
import type { AILevel } from '../ai';
import type { Database } from '../types/database';

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
 * Shape returned by the `enter_room` RPC. The RPC has already debited
 * the entry fee and inserted the matches row, so the caller just needs
 * to navigate the user into the gameplay screen with these values.
 */
export interface EnterRoomResult {
  matchId: string;
  turnSeconds: number;
  mode: MatchMode;
  target: number;
  wallet: { coins: number; gems: number };
}

/**
 * Calls the server-side enter_room RPC. The RPC is what makes the
 * "entry fee deducted on join" semantics atomic: it validates the room,
 * debits coins, and creates the match in a single transaction. On
 * error it raises one of: not_authenticated, room_not_found,
 * room_disabled, unsupported_match_mode, ai_not_allowed, level_too_low,
 * insufficient_coins. We surface the raw error.message so the caller
 * (the DifficultyModal) can pattern-match those codes for friendly
 * toasts.
 */
export async function enterRoom(args: {
  tableConfigId: string;
  matchMode?: MatchMode;
}): Promise<EnterRoomResult> {
  const { data, error } = await supabase.rpc('enter_room', {
    p_table_config_id: args.tableConfigId,
    p_match_mode: args.matchMode ?? 'ai-medium',
  });
  if (error) throw error;
  const payload = data as {
    match_id: string;
    turn_seconds: number;
    mode: MatchMode;
    target: number;
    wallet: { coins: number; gems: number };
  };
  return {
    matchId: payload.match_id,
    turnSeconds: payload.turn_seconds,
    mode: payload.mode,
    target: payload.target,
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
  moves: ReadonlyArray<{ player: 'white' | 'black'; dice: readonly number[]; subMoves: readonly Move[] }>;
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
  }));

  const { error: movesErr } = await supabase.from('moves').insert(rows);
  if (movesErr) throw movesErr;
}

export type MatchRowWithoutInternals = Omit<MatchRow, 'updated_at'>;
