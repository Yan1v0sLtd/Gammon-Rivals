// Phase 2b, slice 2 — SHADOW game validator (read-only, non-enforcing).
//
// Replays a match's recorded moves against the pure engine and DERIVES the true
// outcome (winner / win type / points), then compares it to what the client
// recorded in games/matches. The current finish_turn/finish_match path trusts
// the client's claimed result; this surfaces whether a recorded game actually
// supports its outcome (illegal moves, or a winner/points that the board can't
// justify). Slice 3 will reuse this replay in a validate-AND-commit path so the
// server stops trusting the client. This function writes nothing.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  applyMove,
  classifyWin,
  endTurn,
  expandDice,
  initialBoard,
  legalMoves,
  winner,
  WIN_MULTIPLIER,
  type BoardState,
  type Die,
  type Move,
  type Player,
  type Position,
  type WinType,
} from '../_shared/engine/index.ts';

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

const sameMove = (a: Move, b: Move): boolean =>
  a.from === b.from && a.to === b.to && a.die === b.die;

interface GameVerdict {
  gameNumber: number;
  plies: number;
  legalAllMoves: boolean;
  illegalAt: number | null; // ply index of the first illegal sub-move, if any
  derived: { winner: Player | null; winType: WinType | null; points: number };
  recorded: { winner: string | null; winType: string | null; points: number | null };
  outcomeMatches: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server misconfigured' }, 500);

    // Authenticate the caller (verify_jwt is on), then read with the service
    // role so the integrity tool can inspect any match's full move history.
    const authClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    const matchId = body && typeof body.matchId === 'string' ? body.matchId : null;
    if (!matchId) return json({ error: 'matchId required' }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: match, error: mErr } = await sb
      .from('matches').select('id, white_score, black_score, winner, target').eq('id', matchId).single();
    if (mErr || !match) return json({ error: 'match not found' }, 404);

    const { data: games, error: gErr } = await sb
      .from('games')
      .select('id, game_number, winner, win_type, points_awarded, cube_value')
      .eq('match_id', matchId)
      .order('game_number', { ascending: true });
    if (gErr) return json({ error: 'games read failed: ' + gErr.message }, 500);

    const verdicts: GameVerdict[] = [];
    let derivedWhite = 0;
    let derivedBlack = 0;

    for (const game of games ?? []) {
      const { data: moves, error: mvErr } = await sb
        .from('moves')
        .select('ply, player, dice, sub_moves')
        .eq('game_id', game.id)
        .order('ply', { ascending: true });
      if (mvErr) return json({ error: 'moves read failed: ' + mvErr.message }, 500);

      let board: BoardState = initialBoard();
      let legalAll = true;
      let illegalAt: number | null = null;
      let gameWinner: Player | null = null;

      for (const mv of moves ?? []) {
        if (gameWinner) break; // moves after a win are spurious
        // Turn-order sanity: the recorded mover should be on roll.
        if (mv.player !== board.turn) {
          legalAll = false;
          if (illegalAt === null) illegalAt = mv.ply;
        }
        let remaining: Die[] = expandDice([mv.dice[0] as Die, mv.dice[1] as Die]);
        const subs = (mv.sub_moves ?? []) as SubMoveJSON[];
        for (const s of subs) {
          const move = decodeSub(s);
          const legal = legalMoves(board, remaining);
          if (!legal.some((L) => sameMove(L, move))) {
            legalAll = false;
            if (illegalAt === null) illegalAt = mv.ply;
          }
          try {
            board = applyMove(board, move);
          } catch {
            legalAll = false;
            if (illegalAt === null) illegalAt = mv.ply;
            break;
          }
          remaining = removeDie(remaining, move.die);
        }
        const w = winner(board);
        if (w) {
          gameWinner = w;
          break;
        }
        board = endTurn(board);
      }

      const winType: WinType | null = gameWinner ? classifyWin(board, gameWinner) : null;
      const cube = typeof game.cube_value === 'number' && game.cube_value > 0 ? game.cube_value : 1;
      const points = winType ? WIN_MULTIPLIER[winType] * cube : 0;
      if (gameWinner === 'white') derivedWhite += points;
      else if (gameWinner === 'black') derivedBlack += points;

      verdicts.push({
        gameNumber: game.game_number,
        plies: (moves ?? []).length,
        legalAllMoves: legalAll,
        illegalAt,
        derived: { winner: gameWinner, winType, points },
        recorded: {
          winner: game.winner ?? null,
          winType: game.win_type ?? null,
          points: game.points_awarded ?? null,
        },
        outcomeMatches:
          gameWinner === (game.winner ?? null) &&
          (game.points_awarded == null || points === game.points_awarded),
      });
    }

    const allLegal = verdicts.every((v) => v.legalAllMoves);
    const allOutcomesMatch = verdicts.every((v) => v.outcomeMatches);
    const scoresMatch = derivedWhite === match.white_score && derivedBlack === match.black_score;

    return json({
      matchId,
      target: match.target,
      valid: allLegal && allOutcomesMatch && scoresMatch,
      allLegal,
      allOutcomesMatch,
      scoresMatch,
      derivedScore: { white: derivedWhite, black: derivedBlack },
      recordedScore: { white: match.white_score, black: match.black_score },
      recordedWinner: match.winner ?? null,
      games: verdicts,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
