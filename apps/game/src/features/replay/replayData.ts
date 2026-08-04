import type {Database} from "../../../../../packages/shared/src/database"
import {supabase} from "../../lib/supabase"

type MatchRow = Database["public"]["Tables"]["matches"]["Row"]
type GameRow = Database["public"]["Tables"]["games"]["Row"]
export type MoveRow = Database["public"]["Tables"]["moves"]["Row"]

export type GameWithMoves = {
  match: MatchRow,
  game: GameRow,
  moves: MoveRow[],
}

export async function getGameWithMoves(gameId: string): Promise<GameWithMoves> {
  const {
    data: game,
    error: gameErr,
  } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single()
  if (gameErr) throw gameErr

  const {
    data: match,
    error: matchErr,
  } = await supabase
    .from("matches")
    .select("*")
    .eq("id", game.match_id)
    .single()
  if (matchErr) throw matchErr

  const {
    data: moves,
    error: movesErr,
  } = await supabase
    .from("moves")
    .select("*")
    .eq("game_id", gameId)
    .order("ply", {ascending: true})
  if (movesErr) throw movesErr

  return {
    match,
    game,
    moves: moves ?? [],
  }
}
