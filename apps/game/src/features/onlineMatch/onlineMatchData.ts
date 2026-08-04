import type {Player} from "../../../../../packages/engine/src/types"
import type {Database} from "../../../../../packages/shared/src/database"
import {supabase} from "../../lib/supabase"

import {edgeFunctionErrorDetail} from "./onlineMatchErrors"

export type MatchRow = Database["public"]["Tables"]["matches"]["Row"]
export type MoveRow = Database["public"]["Tables"]["moves"]["Row"]
export type GameRow = Database["public"]["Tables"]["games"]["Row"]

export type ActiveMatchSnapshot = {
  readonly match: MatchRow | null,
  readonly moves: readonly MoveRow[],
  readonly currentGame: GameRow | null,
}

/**
 * One snapshot, never three queries: a caller holding the new match row with
 * the old moves array derives a board missing the last turn, which re-animates
 * the whole checker distribution.
 */
export async function fetchActiveMatch(matchId: string): Promise<ActiveMatchSnapshot> {
  const {
    data: m,
    error: mErr,
  } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle()
  if (mErr) throw mErr
  if (!m?.current_game_id) {
    return {
      match: m ?? null,
      moves: [],
      currentGame: null,
    }
  }
  const [movesRes, gameRes] = await Promise.all([supabase
    .from("moves")
    .select("*")
    .eq("game_id", m.current_game_id)
    .order("ply", {ascending: true}), supabase
    .from("games")
    .select("*")
    .eq("id", m.current_game_id)
    .maybeSingle()])
  if (movesRes.error) throw movesRes.error
  if (gameRes.error) throw gameRes.error
  return {
    match: m,
    moves: movesRes.data ?? [],
    currentGame: gameRes.data,
  }
}

/** Server-authoritative dice. The client never rolls for an online match. */
export async function invokeRollDice(matchId: string): Promise<void> {
  const {
    data,
    error,
  } = await supabase.functions.invoke("roll_dice", {body: {matchId}})
  if (error) throw new Error(await edgeFunctionErrorDetail("roll_dice", error))
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as {error: unknown}).error))
  }
}

// Server-rolled and recorded atomically, arriving via Realtime like a remote
// opponent's move — which is why the client never rolls for the bot.
export async function invokeAiMove(matchId: string): Promise<void> {
  const {
    data,
    error,
  } = await supabase.functions.invoke("ai_move", {body: {matchId}})
  if (error) throw new Error(await edgeFunctionErrorDetail("ai_move", error))
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as {error: unknown}).error))
  }
}

/**
 * Server-authoritative turn commit. The client does not compute or assert the
 * game outcome — finish_turn replays the recorded moves plus this turn's
 * submoves through the shared engine, VALIDATES every sub-move, DERIVES the
 * winner / win type / points / scores / match winner / crawford, and writes
 * them atomically via commit_turn_server. This closes the coin-minting hole
 * where the old path trusted client-computed outcome fields (a client could
 * finish a turn — or match — claiming a fabricated win); the atomicity the old
 * finish_turn RPC provided is preserved inside commit_turn_server.
 */
export async function invokeFinishTurn(matchId: string): Promise<void> {
  const {
    data,
    error,
  } = await supabase.functions.invoke("finish_turn", {body: {matchId}})
  if (error) throw new Error(await edgeFunctionErrorDetail("finish_turn", error))
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as {error: unknown}).error))
  }
}

export async function updateCurrentTurn(matchId: string, currentTurn: MatchRow["current_turn"]): Promise<void> {
  const {error} = await supabase
    .from("matches")
    .update({
      current_turn: currentTurn,
    })
    .eq("id", matchId)
  if (error) throw error
}

export async function offerDouble(matchId: string, offeredBy: Player): Promise<void> {
  const {error} = await supabase
    .from("matches")
    .update({cube_offer: offeredBy})
    .eq("id", matchId)
  if (error) throw error
}

export type AcceptDoubleArgs = {
  readonly matchId: string,
  readonly cubeValue: number,
  readonly cubeOwner: Player,
}

export async function acceptDouble(args: AcceptDoubleArgs): Promise<void> {
  const {error} = await supabase
    .from("matches")
    .update({
      cube_value: args.cubeValue,
      cube_owner: args.cubeOwner,
      cube_offer: null,
    })
    .eq("id", args.matchId)
  if (error) throw error
}

export type DropDoubleArgs = {
  readonly matchId: string,
  readonly gameId: string,
  /** The offerer, who wins the pre-double cube value (a single). */
  readonly winner: Player,
  readonly cubeValue: number,
  readonly cubeOwner: Player | null,
  readonly whiteScore: number,
  readonly blackScore: number,
  readonly target: number,
  readonly crawfordGameNumber: number | null,
  readonly currentGameNumber: number,
}

export async function dropDouble(args: DropDoubleArgs): Promise<void> {
  const winnerOfDrop = args.winner
  const points = args.cubeValue

  // Deliberately unchecked: online game rows are RLS-locked to server-side
  // writers, so a denied update here must not abort the match-score write
  // below, which is what actually resolves the drop.
  await supabase
    .from("games")
    .update({
      winner: winnerOfDrop,
      win_type: "single",
      cube_value: args.cubeValue,
      cube_owner: args.cubeOwner,
      dropped_double: true,
      points_awarded: points,
      finished_at: new Date().toISOString(),
    })
    .eq("id", args.gameId)

  const newWhite = args.whiteScore + (winnerOfDrop === "white" ? points : 0)
  const newBlack = args.blackScore + (winnerOfDrop === "black" ? points : 0)
  const matchOver = newWhite >= args.target || newBlack >= args.target

  const oldMax = Math.max(args.whiteScore, args.blackScore)
  const newMax = Math.max(newWhite, newBlack)
  const newCrawford = args.crawfordGameNumber === null && oldMax < args.target - 1 && newMax === args.target - 1 ? args.currentGameNumber + 1 : args.crawfordGameNumber

  const {error} = await supabase
    .from("matches")
    .update({
      cube_offer: null,
      white_score: newWhite,
      black_score: newBlack,
      crawford_game_number: matchOver ? args.crawfordGameNumber : newCrawford,
      winner: matchOver ? winnerOfDrop : null,
      finished_at: matchOver ? new Date().toISOString() : null,
    })
    .eq("id", args.matchId)
  if (error) throw error
}

export type ConvertOpponentToAiArgs = {
  readonly matchId: string,
  readonly minInactiveSeconds: number,
}

/**
 * The RPC reports failure through the error field's message rather than
 * throwing, which is why classifyConversionError exists.
 */
export async function convertOpponentToAi(args: ConvertOpponentToAiArgs): Promise<void> {
  const {error} = await supabase.rpc("replace_opponent_with_ai", {
    p_match_id: args.matchId,
    p_min_inactive_seconds: args.minInactiveSeconds,
  })
  if (error) throw error
}

// One definition of "the winner takes every outstanding point", shared by the
// claim/resign wrapper and the auto-forfeit chain.
export function buildFinalizeScores(match: Pick<MatchRow, "target" | "white_score" | "black_score">, winner: Player): {
  whiteScore: number, blackScore: number,
} {
  const points = Math.max(1, match.target - (winner === "white" ? match.white_score : match.black_score))
  return {
    whiteScore: match.white_score + (winner === "white" ? points : 0),
    blackScore: match.black_score + (winner === "black" ? points : 0),
  }
}

/** Owner cancels an unstarted match from the waiting room. */
export async function cancelMatchForOwner(matchId: string): Promise<void> {
  const {error} = await supabase
    .from("matches")
    .update({finished_at: new Date().toISOString()})
    .eq("id", matchId)
  if (error) throw error
}

export type FinalizeMatchArgs = {
  readonly matchId: string,
  readonly whiteScore: number,
  readonly blackScore: number,
  readonly winner: Player,
  readonly crawfordGameNumber: number | null,
  readonly ownerAbandoned: boolean,
  readonly opponentAbandoned: boolean,
}

/**
 * The finish_match RPC is the only path that gets PvP rewards (W/L coin
 * awards, XP, pvp_rating update) right; a plain UPDATE means the match pays out
 * nothing. The per-side abandonment flags give the abandoner a zero payout
 * while still taking the ELO loss.
 *
 * The in-progress game row is not closed here: online games are RLS-locked to
 * server-only writers, so that UPDATE would be denied. finish_match closes the
 * dangling row when it finalizes.
 */
export async function finalizeMatch(args: FinalizeMatchArgs): Promise<void> {
  const {error} = await supabase.rpc("finish_match", {
    p_match_id: args.matchId,
    p_white_score: args.whiteScore,
    p_black_score: args.blackScore,
    p_winner: args.winner,
    p_crawford_game_number: args.crawfordGameNumber,
    p_owner_abandoned: args.ownerAbandoned,
    p_opponent_abandoned: args.opponentAbandoned,
  })
  if (error) throw error
}
