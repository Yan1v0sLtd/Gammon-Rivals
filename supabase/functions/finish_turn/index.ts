// Phase 2b, slice 3 — server-authoritative turn commit (validate + derive).
//
// Replaces the trust-the-client finish_turn RPC for the online (PvP) move path.
// The client used to compute the game outcome (winner / win type / points /
// scores / match winner / crawford) and pass it to the finish_turn RPC, which
// wrote it verbatim. This edge function instead:
//
//   1. authenticates the caller (verify_jwt) and loads the match + current_turn
//      + the current game's recorded moves (service role);
//   2. replays the recorded prior moves to reconstruct the board, then applies
//      THIS turn's submoves, VALIDATING every sub-move against legalMoves — an
//      illegal submove is rejected, nothing is committed;
//   3. DERIVES the true outcome with the engine's own computeBearOffResult +
//      applyGameResult (the exact functions the client uses, so the server
//      derives precisely what an honest client would);
//   4. calls commit_turn_server (service role) with the DERIVED values + the
//      validated submoves to do the atomic 3-write.
//
// The client no longer asserts any outcome — it just says "commit my turn".
// `dryRun` returns the derived outcome without writing (for verification).
//
// Scope: bear-off wins + normal turns. Dropped-double game-ends (cube, target>1
// only) still go through the client-direct path and are addressed separately;
// the live single-game (target=1) economy has no cube.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  applyGameResult,
  applyMove,
  computeBearOffResult,
  endTurn,
  expandDice,
  initialBoard,
  legalMoves,
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

interface DerivedOutcome {
  gameWinner: Player | null;
  winType: WinType | null;
  points: number | null;
  newWhite: number;
  newBlack: number;
  matchWinner: Player | null;
  crawford: number | null;
  gameEnded: boolean;
  matchEnded: boolean;
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

    // Authenticate the caller (verify_jwt is on). Reads/writes use the service
    // role; the validated caller id is passed to commit_turn_server explicitly.
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const callerId = userData.user.id;

    const body = await req.json().catch(() => null);
    const matchId = body && typeof body.matchId === 'string' ? body.matchId : null;
    if (!matchId) return json({ error: 'matchId required' }, 400);
    const elapsedMs =
      body && typeof body.elapsedMs === 'number' && Number.isFinite(body.elapsedMs)
        ? Math.max(0, Math.floor(body.elapsedMs))
        : null;
    const dryRun = !!(body && body.dryRun);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: match, error: mErr } = await sb
      .from('matches')
      .select(
        'id, owner_id, opponent_id, owner_color, target, white_score, black_score, ' +
          'crawford_game_number, current_turn, current_game_id, cube_value, cube_owner, finished_at',
      )
      .eq('id', matchId)
      .single();
    if (mErr || !match) return json({ error: 'match_not_found' }, 404);


    const isParticipant =
      callerId === match.owner_id ||
      (match.opponent_id != null && callerId === match.opponent_id);
    if (!isParticipant) return json({ error: 'not_match_participant' }, 403);
    if (match.finished_at != null) return json({ error: 'match_already_finished' }, 409);
    if (match.current_game_id == null) return json({ error: 'no_current_game' }, 409);

    const ct = match.current_turn as
      | { player?: string; dice?: [number, number]; subMoves?: SubMoveJSON[] }
      | null;
    if (!ct) return json({ error: 'no_turn_in_progress' }, 409);
    const ctPlayer = ct.player;
    if (ctPlayer !== 'white' && ctPlayer !== 'black') {
      return json({ error: 'malformed_current_turn' }, 422);
    }
    if (!Array.isArray(ct.dice) || ct.dice.length !== 2) {
      return json({ error: 'malformed_current_turn' }, 422);
    }

    // Caller must be the active player.
    const ownerColor = match.owner_color === 'black' ? 'black' : 'white';
    const callerColor: Player =
      callerId === match.owner_id
        ? ownerColor
        : ownerColor === 'white'
          ? 'black'
          : 'white';
    if (callerColor !== ctPlayer) return json({ error: 'not_your_turn' }, 409);


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


    let board: BoardState = initialBoard();
    for (const mv of priorMoves ?? []) {
      let remaining: Die[] = expandDice([mv.dice[0] as Die, mv.dice[1] as Die]);
      const subs = (mv.sub_moves ?? []) as SubMoveJSON[];
      for (const s of subs) {
        try {
          board = applyMove(board, decodeSub(s));
        } catch (e) {
          // A prior move that no longer applies means the recorded history is
          // corrupt (or predates validation). Refuse to commit on top of it.
          return json(
            { error: 'corrupt_history', detail: `ply ${mv.ply}: ${e instanceof Error ? e.message : String(e)}` },
            422,
          );
        }
        remaining = removeDie(remaining, decodeSub(s).die);
      }
      if (winner(board)) {
        // The game was already won by a prior move — this turn shouldn't exist.
        return json({ error: 'game_already_won' }, 409);
      }
      board = endTurn(board);
    }

    // After replaying prior moves the board must be on the active player's roll.
    if (board.turn !== ctPlayer) {
      return json({ error: 'turn_desync', detail: `board on ${board.turn}, current_turn ${ctPlayer}` }, 409);
    }


    const subMoves = (ct.subMoves ?? []) as SubMoveJSON[];
    let remaining: Die[] = expandDice([ct.dice[0] as Die, ct.dice[1] as Die]);
    for (let i = 0; i < subMoves.length; i++) {
      const move = decodeSub(subMoves[i]);
      const legal = legalMoves(board, remaining);
      if (!legal.some((L) => sameMove(L, move))) {
        return json({ error: 'illegal_move', detail: `submove ${i}`, move }, 422);
      }
      board = applyMove(board, move);
      remaining = removeDie(remaining, move.die);
    }


    const gameWinner = winner(board);
    const out: DerivedOutcome = {
      gameWinner,
      winType: null,
      points: null,
      newWhite: match.white_score,
      newBlack: match.black_score,
      matchWinner: null,
      crawford: match.crawford_game_number,
      gameEnded: gameWinner != null,
      matchEnded: false,
    };

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
      out.winType = result.winType;
      out.points = result.points;
      out.newWhite = next.score.white;
      out.newBlack = next.score.black;
      out.matchWinner = next.winner;
      out.crawford = next.crawfordGameNumber;
      out.matchEnded = next.winner != null;
    }

    if (dryRun) {
      return json({ dryRun: true, matchId, priorPlies: (priorMoves ?? []).length, derived: out });
    }


    const { data: commit, error: cErr } = await sb.rpc('commit_turn_server', {
      p_match_id: matchId,
      p_caller_id: callerId,
      p_dice: [ct.dice[0], ct.dice[1]],
      p_sub_moves: subMoves,
      p_game_winner: out.gameWinner,
      p_game_win_type: out.winType,
      p_game_points: out.points,
      p_game_dropped_double: false,
      p_new_white_score: out.newWhite,
      p_new_black_score: out.newBlack,
      p_match_winner: out.matchWinner,
      p_crawford_game_number: out.crawford,
      p_elapsed_ms: elapsedMs,
    });
    if (cErr) {
      const msg = cErr.message ?? String(cErr);
      // Benign races the client can absorb with a refresh.
      if (
        msg.includes('no_turn_in_progress') ||
        msg.includes('match_already_finished') ||
        msg.includes('not_your_turn')
      ) {
        return json({ error: msg, benign: true }, 409);
      }
      return json({ error: 'commit_failed: ' + msg }, 500);
    }

    return json({ status: 'ok', matchId, derived: out, commit });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
