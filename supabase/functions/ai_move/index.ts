// Phase 2b layer 2 — server-authored AI turn.
//
// Given an AI match (mode like 'ai-%') where it is the bot's turn, the SERVER:
//   1. replays the game's recorded moves to reconstruct the board,
//   2. confirms it is actually the bot's turn,
//   3. rolls the bot's dice server-side (crypto RNG),
//   4. picks the bot's move sequence via the shared AI mirror (_shared/ai),
//   5. derives the outcome (winner / win type / points / scores), and
//   6. commits it atomically via the service-role commit_ai_turn RPC.
//
// The bot's dice and moves are never client-supplied — this is what makes a
// vs-AI match server-authoritative (and what lets finish/payout trust it).
//
// STATUS: server capability only. NOT yet wired into the live AI match flow
// (HotSeat plays the AI client-side today). The integration — routing the AI
// match through roll_dice + commit_turn_server (human turns) + this fn (bot
// turns) + the derived payout — is the next slice. Dormant until then.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  applyGameResult,
  applyMove,
  computeBearOffResult,
  endTurn,
  expandDice,
  initialBoard,
  winner,
  type BoardState,
  type CubeValue,
  type Die,
  type MatchState,
  type Move,
  type Player,
  type Position,
  type WinType,
} from '../_shared/engine/index.ts';
import { pickMove, type AILevel } from '../_shared/ai/index.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface SubMoveJSON {
  from: Position;
  to: Position;
  die: number;
  hit?: boolean;
}

function decodeSub(s: SubMoveJSON): Move {
  return { from: s.from, to: s.to, die: s.die as Die, hit: !!s.hit };
}

function removeDie(dice: readonly Die[], die: Die): Die[] {
  const idx = dice.indexOf(die);
  if (idx < 0) return [...dice];
  return [...dice.slice(0, idx), ...dice.slice(idx + 1)];
}

function aiLevelFromMode(mode: string): AILevel {
  const level = mode.replace(/^ai-/, '');
  return level === 'easy' || level === 'medium' || level === 'hard' ? level : 'medium';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server misconfigured' }, 500);

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const callerId = userData.user.id;

    const body = await req.json().catch(() => null);
    const matchId = body && typeof body.matchId === 'string' ? body.matchId : null;
    if (!matchId) return json({ error: 'matchId required' }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: match, error: mErr } = await sb
      .from('matches')
      .select(
        'id, owner_id, owner_color, target, white_score, black_score, ' +
          'crawford_game_number, current_game_id, cube_value, cube_owner, finished_at, mode',
      )
      .eq('id', matchId)
      .single();
    if (mErr || !match) return json({ error: 'match_not_found' }, 404);

    if (typeof match.mode !== 'string' || !match.mode.startsWith('ai-')) {
      return json({ error: 'not_ai_match' }, 400);
    }
    // Only the human owner can drive their AI opponent's turn.
    if (callerId !== match.owner_id) return json({ error: 'not_match_participant' }, 403);
    if (match.finished_at != null) return json({ error: 'match_already_finished' }, 409);
    if (match.current_game_id == null) return json({ error: 'no_current_game' }, 409);

    const ownerColor: Player = match.owner_color === 'black' ? 'black' : 'white';
    const botColor: Player = ownerColor === 'white' ? 'black' : 'white';
    const aiLevel = aiLevelFromMode(match.mode);

    const { data: game, error: gErr } = await sb
      .from('games')
      .select('id, game_number')
      .eq('id', match.current_game_id)
      .single();
    if (gErr || !game) return json({ error: 'game_not_found' }, 404);

    const { data: priorMoves, error: pmErr } = await sb
      .from('moves')
      .select('ply, player, dice, sub_moves')
      .eq('game_id', match.current_game_id)
      .order('ply', { ascending: true });
    if (pmErr) return json({ error: 'moves_read_failed: ' + pmErr.message }, 500);

    // Replay recorded moves → board before this turn.
    let board: BoardState = initialBoard();
    for (const mv of priorMoves ?? []) {
      let remaining: Die[] = expandDice([mv.dice[0] as Die, mv.dice[1] as Die]);
      for (const s of (mv.sub_moves ?? []) as SubMoveJSON[]) {
        try {
          board = applyMove(board, decodeSub(s));
        } catch (e) {
          return json(
            { error: 'corrupt_history', detail: `ply ${mv.ply}: ${e instanceof Error ? e.message : String(e)}` },
            422,
          );
        }
        remaining = removeDie(remaining, decodeSub(s).die);
      }
      if (winner(board)) return json({ error: 'game_already_won' }, 409);
      board = endTurn(board);
    }

    if (board.turn !== botColor) {
      return json({ error: 'not_ai_turn', detail: `board on ${board.turn}, bot is ${botColor}` }, 409);
    }

    // Roll the bot's dice server-side.
    const buf = new Uint8Array(2);
    crypto.getRandomValues(buf);
    const d1 = ((buf[0]! % 6) + 1) as Die;
    const d2 = ((buf[1]! % 6) + 1) as Die;
    let remaining: Die[] = expandDice([d1, d2]);

    // Pick the bot's move sequence (legal by construction). [] = forced pass.
    const { moves } = pickMove(board, remaining, aiLevel);
    for (const move of moves) {
      try {
        board = applyMove(board, move);
      } catch (e) {
        return json(
          { error: 'ai_move_apply_failed', detail: e instanceof Error ? e.message : String(e) },
          500,
        );
      }
      remaining = removeDie(remaining, move.die);
    }

    // Derive the outcome with the engine's own functions.
    const gameWinner = winner(board);
    let winType: WinType | null = null;
    let points: number | null = null;
    let newWhite = match.white_score;
    let newBlack = match.black_score;
    let matchWinner: Player | null = null;
    let crawford: number | null = match.crawford_game_number;
    if (gameWinner) {
      const matchState: MatchState = {
        target: match.target,
        score: { white: match.white_score, black: match.black_score },
        gameNumber: game.game_number ?? 1,
        crawfordGameNumber: match.crawford_game_number ?? null,
        cube: { value: (match.cube_value ?? 1) as CubeValue, owner: (match.cube_owner ?? null) as Player | null },
        cubeOffer: null,
        winner: null,
      };
      const result = computeBearOffResult(matchState, board, gameWinner);
      const next = applyGameResult(matchState, result);
      winType = result.winType;
      points = result.points;
      newWhite = next.score.white;
      newBlack = next.score.black;
      matchWinner = next.winner;
      crawford = next.crawfordGameNumber;
    }

    const subMoves: SubMoveJSON[] = moves.map((m) => ({ from: m.from, to: m.to, die: m.die, hit: m.hit }));

    const { data: commit, error: cErr } = await sb.rpc('commit_ai_turn', {
      p_match_id: matchId,
      p_dice: [d1, d2],
      p_sub_moves: subMoves,
      p_game_winner: gameWinner,
      p_game_win_type: winType,
      p_game_points: points,
      p_new_white_score: newWhite,
      p_new_black_score: newBlack,
      p_match_winner: matchWinner,
      p_crawford_game_number: crawford,
    });
    if (cErr) return json({ error: 'commit_failed: ' + (cErr.message ?? String(cErr)) }, 500);

    return json({
      status: 'ok',
      matchId,
      botColor,
      dice: [d1, d2],
      moves: subMoves,
      derived: { gameWinner, winType, points, newWhite, newBlack, matchWinner, crawford },
      commit,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
