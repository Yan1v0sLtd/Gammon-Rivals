// Server-authoritative dice roll for online matches.
// v2 (Phase 5d): handles multi-game match continuation — when current_game_id
// points to a finished game, lazy-create a new game and reset cube state.
// v3 (Phase 2b slice 4): writes via the SERVICE ROLE. The caller is still
// authenticated (and authorized below by the owner/opponent + turn checks), but
// the DB writes no longer run as the caller — so slice 4 can revoke clients'
// direct INSERT on `games`/`moves` for online matches (locking the PvP game
// record to server-only writers) without breaking this function's game-row
// creation.

import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY) {
      return json({ error: 'server misconfigured' }, 500);
    }

    // Authenticate the caller with their JWT; do all DB work with the service
    // role. Authorization is enforced explicitly below (owner/opponent + turn).
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const user = userData.user;

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => null);
    const matchId = body && typeof body.matchId === 'string' ? body.matchId : null;
    if (!matchId) return json({ error: 'matchId required' }, 400);

    const { data: match, error: mErr } = await sb
      .from('matches').select('*').eq('id', matchId).single();
    if (mErr || !match) return json({ error: 'match not found' }, 404);

    if (match.mode !== 'online') return json({ error: 'not an online match' }, 400);
    if (match.finished_at) return json({ error: 'match finished' }, 400);
    // current_turn may contain only the _abandonment side-channel object
    // (written by replace_opponent_with_ai) with NONE of the engine fields.
    // That's not a real turn — it's audit metadata. Treat it as "no turn in
    // progress" so the next roll can land and clobber the metadata cleanly.
    if (
      match.current_turn &&
      typeof match.current_turn === 'object' &&
      typeof (match.current_turn as Record<string, unknown>).player === 'string' &&
      Array.isArray((match.current_turn as Record<string, unknown>).dice)
    ) {
      return json({ error: 'turn already in progress' }, 400);
    }
    if (!match.opponent_id) return json({ error: 'waiting for opponent' }, 400);

    let callerColor: 'white' | 'black';
    if (user.id === match.owner_id) {
      callerColor = (match.owner_color === 'black' ? 'black' : 'white');
    } else if (user.id === match.opponent_id) {
      callerColor = match.owner_color === 'white' ? 'black' : 'white';
    } else {
      return json({ error: 'not a player' }, 403);
    }

    let gameId: string | null = match.current_game_id;
    if (gameId) {
      const { data: g } = await sb
        .from('games').select('finished_at').eq('id', gameId).maybeSingle();
      if (g?.finished_at) gameId = null;
    }

    let expectedPlayer: 'white' | 'black' = 'white';
    if (gameId) {
      const { data: lastMove } = await sb
        .from('moves').select('player').eq('game_id', gameId)
        .order('ply', { ascending: false }).limit(1).maybeSingle();
      if (lastMove?.player === 'white' || lastMove?.player === 'black') {
        expectedPlayer = lastMove.player === 'white' ? 'black' : 'white';
      }
    }

    if (callerColor !== expectedPlayer) {
      return json({ error: `not your turn (expected ${expectedPlayer})` }, 403);
    }

    const startedNewGame = !gameId;
    if (!gameId) {
      const { count } = await sb
        .from('games').select('id', { count: 'exact', head: true }).eq('match_id', matchId);
      const gameNumber = (count ?? 0) + 1;
      const { data: newGame, error: gErr } = await sb
        .from('games').insert({ match_id: matchId, game_number: gameNumber }).select('id').single();
      if (gErr || !newGame) {
        return json({ error: 'could not create game: ' + (gErr?.message ?? 'unknown') }, 500);
      }
      gameId = newGame.id;
    }

    const buf = new Uint8Array(2);
    crypto.getRandomValues(buf);
    const d1 = ((buf[0] % 6) + 1);
    const d2 = ((buf[1] % 6) + 1);
    const remaining = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];

    const turnState = { player: callerColor, dice: [d1, d2], remaining, subMoves: [] };

    const matchUpdate: Record<string, unknown> = {
      current_turn: turnState,
      current_game_id: gameId,
    };
    if (startedNewGame) {
      matchUpdate.cube_value = 1;
      matchUpdate.cube_owner = null;
      matchUpdate.cube_offer = null;
    }

    const { error: upErr } = await sb.from('matches').update(matchUpdate).eq('id', matchId);
    if (upErr) return json({ error: 'update failed: ' + upErr.message }, 500);

    return json({ dice: [d1, d2], remaining, player: callerColor, gameId, prevGameFinished: startedNewGame });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
