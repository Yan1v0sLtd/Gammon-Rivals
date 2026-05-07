import { supabase } from './supabase';
import type { Database } from '../types/database';

export type MatchRow = Database['public']['Tables']['matches']['Row'];
export type GameRow = Database['public']['Tables']['games']['Row'];
export type MoveRow = Database['public']['Tables']['moves']['Row'];

export interface MatchSummary extends MatchRow {
  game_count: number;
}

export async function listMatchesForOwner(
  ownerId: string,
  limit = 50
): Promise<MatchSummary[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('*, games(count)')
    .eq('owner_id', ownerId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const games = (row as unknown as { games: { count: number }[] }).games;
    const game_count = Array.isArray(games) && games.length > 0 ? games[0]!.count : 0;
    const { games: _ignored, ...rest } = row as MatchRow & { games?: unknown };
    return { ...(rest as MatchRow), game_count };
  });
}

export interface OwnerStats {
  totalFinished: number;
  aiWins: number;
  aiLosses: number;
  hotseatPlayed: number;
  ongoing: number;
}

export async function getOwnerStats(ownerId: string): Promise<OwnerStats> {
  const { data, error } = await supabase
    .from('matches')
    .select('mode, winner, finished_at')
    .eq('owner_id', ownerId);
  if (error) throw error;

  const stats: OwnerStats = {
    totalFinished: 0,
    aiWins: 0,
    aiLosses: 0,
    hotseatPlayed: 0,
    ongoing: 0,
  };
  for (const m of data ?? []) {
    if (!m.finished_at) {
      stats.ongoing += 1;
      continue;
    }
    stats.totalFinished += 1;
    if (m.mode === 'hotseat') {
      stats.hotseatPlayed += 1;
      continue;
    }
    if (m.mode.startsWith('ai-')) {
      // Owner is always white in AI matches (current setup)
      if (m.winner === 'white') stats.aiWins += 1;
      else if (m.winner === 'black') stats.aiLosses += 1;
    }
  }
  return stats;
}

export interface GameWithMoves {
  match: MatchRow;
  game: GameRow;
  moves: MoveRow[];
}

export async function getGameWithMoves(gameId: string): Promise<GameWithMoves> {
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  if (gameErr) throw gameErr;

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('*')
    .eq('id', game.match_id)
    .single();
  if (matchErr) throw matchErr;

  const { data: moves, error: movesErr } = await supabase
    .from('moves')
    .select('*')
    .eq('game_id', gameId)
    .order('ply', { ascending: true });
  if (movesErr) throw movesErr;

  return { match, game, moves: moves ?? [] };
}

export async function listGamesForMatch(matchId: string): Promise<GameRow[]> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('match_id', matchId)
    .order('game_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
