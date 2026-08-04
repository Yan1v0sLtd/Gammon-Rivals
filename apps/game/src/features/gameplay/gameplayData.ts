import type {AILevel} from "../../../../../packages/ai/src/types"
import type {GameResult} from "../../../../../packages/engine/src/match"
import type {Move} from "../../../../../packages/engine/src/types"
import {supabase} from "../../lib/supabase"

export type MatchMode = "hotseat" | `ai-${AILevel}` | "online"

export function modeFromAi(ai: {level: AILevel} | null): MatchMode {
  return ai ? (`ai-${ai.level}` as const) : "hotseat"
}

export type CreateMatchArgs = {
  ownerId: string,
  mode: MatchMode,
  target: number,
}

export async function createMatch(args: CreateMatchArgs): Promise<string> {
  const {
    data,
    error,
  } = await supabase
    .from("matches")
    .insert({
      owner_id: args.ownerId,
      mode: args.mode,
      target: args.target,
    })
    .select("id")
    .single()
  if (error) throw error
  return data.id
}

export type FinishMatchArgs = {
  matchId: string,
  whiteScore: number,
  blackScore: number,
  winner: "white" | "black",
  crawfordGameNumber: number | null,
}

/**
 * Legacy plain UPDATE — kept for online matches in /play/:id where the
 * owner-side bookkeeping is different and rewards aren't yet wired.
 * Difficulty-room matches go through finishMatchRpc() below instead so
 * the server can validate ownership + grant XP/coins atomically.
 */
export async function finishMatch(args: FinishMatchArgs): Promise<void> {
  const {error} = await supabase
    .from("matches")
    .update({
      white_score: args.whiteScore,
      black_score: args.blackScore,
      winner: args.winner,
      crawford_game_number: args.crawfordGameNumber,
      finished_at: new Date().toISOString(),
    })
    .eq("id", args.matchId)
  if (error) throw error
}

/**
 * Response from the finish_match RPC. xp_awarded / coins_awarded are 0
 * when the match wasn't a difficulty-room match or the caller didn't
 * win — the UI uses these to decide whether to show a reward popup at
 * end-of-match.
 */
export type FinishMatchRewardResult = {
  matchId: string,
  ownerWon: boolean,
  /** True when the match had both human owner and opponent. */
  isPvp: boolean,
  xpAwarded: number,
  xpMultiplier: number,
  coinsAwarded: number,
  /** Post-update PvP ELO ratings for both sides. Null for AI rows. */
  ownerRating: number | null,
  opponentRating: number | null,
  wallet: {coins: number, gems: number},
  profile: {xp: number, level: number},
}

/**
 * Server-side match completion + reward grant. Called instead of the
 * legacy plain UPDATE when we want the rewards (and the audit trail)
 * to be honest. Idempotent on the server: a second call against an
 * already-finished match raises `match_already_finished` rather than
 * double-paying.
 */
export async function finishMatchRpc(args: FinishMatchArgs & {
  /** Set true when finalising a forfeit-on-timeout for the owner.
   *  Zero payout for them; ELO still moves. */
  ownerAbandoned?: boolean, opponentAbandoned?: boolean,
}): Promise<FinishMatchRewardResult> {
  const {
    data,
    error,
  } = await supabase.rpc("finish_match", {
    p_match_id: args.matchId,
    p_white_score: args.whiteScore,
    p_black_score: args.blackScore,
    p_winner: args.winner,
    p_crawford_game_number: args.crawfordGameNumber,
    p_owner_abandoned: args.ownerAbandoned ?? false,
    p_opponent_abandoned: args.opponentAbandoned ?? false,
  })
  if (error) throw error
  const payload = data as {
    match_id: string,
    owner_won: boolean,
    is_pvp: boolean,
    xp_awarded: number,
    xp_multiplier: number,
    coins_awarded: number,
    owner_rating: number | null,
    opponent_rating: number | null,
    wallet: {coins: number, gems: number},
    profile: {xp: number, level: number},
  }
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
  }
}

export type SaveGameArgs = {
  matchId: string,
  gameNumber: number,
  result: GameResult,
  cubeOwner: "white" | "black" | null,
  wasCrawford: boolean,
  moves: readonly {
    player: "white" | "black",
    dice: readonly number[],
    subMoves: readonly Move[],
    /** Player's think-time on this turn, in ms. Null for AI turns and
     *  edge cases — we'd rather omit than fabricate. */
    elapsedMs?: number | null,
  }[],
}

/** Insert a finished game and all its turns in two round-trips. */
export async function saveGame(args: SaveGameArgs): Promise<void> {
  const {
    data: gameRow,
    error: gameErr,
  } = await supabase
    .from("games")
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
    .select("id")
    .single()
  if (gameErr) throw gameErr

  if (args.moves.length === 0) return

  const rows = args.moves.map((move, ply) => ({
    game_id: gameRow.id,
    ply,
    player: move.player,
    dice: [...move.dice],
    sub_moves: move.subMoves.map((subMove) => ({
      from: subMove.from,
      to: subMove.to,
      die: subMove.die,
      hit: subMove.hit,
    })),
    elapsed_ms: move.elapsedMs ?? null,
  }))

  const {error: movesErr} = await supabase.from("moves").insert(rows)
  if (movesErr) throw movesErr
}
