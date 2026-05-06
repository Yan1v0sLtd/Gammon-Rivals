import { supabase } from './supabase';
import type { GameResult, Move } from '../engine';
import type { AILevel } from '../ai';
import type { Database } from '../types/database';

type MatchRow = Database['public']['Tables']['matches']['Row'];

export type MatchMode = 'hotseat' | `ai-${AILevel}`;

export function modeFromAi(ai: { level: AILevel } | null): MatchMode {
  return ai ? (`ai-${ai.level}` as const) : 'hotseat';
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
