import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BoardCanvas from '../board/BoardCanvas';
import DiceTray from '../components/DiceTray';
import DoublingCube from '../components/DoublingCube';
import CubeOfferDecision from '../components/CubeOfferDecision';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useOnlineGame } from '../game/useOnlineGame';
import { pipCount } from '../engine';
import type { Position } from '../engine/types';
import type { CubeValue } from '../engine';
import { woodTheme } from '../board/theme';
import type { Database } from '../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default function PlayOnline() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const game = useOnlineGame(matchId);

  const [ownerProfile, setOwnerProfile] = useState<ProfileRow | null>(null);
  const [opponentProfile, setOpponentProfile] = useState<ProfileRow | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch profiles when match loads
  useEffect(() => {
    if (!game.match) return;
    const ids = [game.match.owner_id, game.match.opponent_id].filter(Boolean) as string[];
    if (ids.length === 0) return;
    void (async () => {
      const { data } = await supabase.from('profiles').select('*').in('id', ids);
      setOwnerProfile(data?.find((p) => p.id === game.match!.owner_id) ?? null);
      setOpponentProfile(data?.find((p) => p.id === game.match!.opponent_id) ?? null);
    })();
  }, [game.match?.owner_id, game.match?.opponent_id]);

  const handlePointClick = (pos: Position) => {
    if (game.gameWinner || game.matchFinished) return;
    if (!game.isLocalTurn) return;
    if (game.selectedFrom === null) {
      game.selectFrom(pos);
      return;
    }
    if (game.validDestinations.includes(pos)) {
      void game.selectTo(pos);
    } else if (game.legalOrigins.includes(pos)) {
      game.selectFrom(pos);
    } else {
      game.cancelSelection();
    }
  };

  const inviteUrl = useMemo(
    () =>
      game.match?.invite_code
        ? `${window.location.origin}/join/${game.match.invite_code}`
        : null,
    [game.match?.invite_code]
  );

  const copyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  if (authLoading || game.loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-board-felt/60">
        Loading…
      </main>
    );
  }

  if (game.error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-rose-400 gap-3 p-6">
        <div>Error: {game.error}</div>
        <Link to="/" className="text-board-accent text-sm">← Home</Link>
      </main>
    );
  }

  const match = game.match;
  if (!match || !user) return null;

  const isOwner = user.id === match.owner_id;
  const role: 'owner' | 'opponent' | 'spectator' =
    isOwner ? 'owner' : user.id === match.opponent_id ? 'opponent' : 'spectator';
  const waiting = match.opponent_id === null;

  // ---------- Lobby UI when waiting ----------
  if (waiting) {
    return (
      <main className="min-h-screen flex flex-col items-center bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt">
        <header className="w-full flex items-center justify-between px-4 py-3 text-board-felt/80">
          <Link to="/" className="text-board-accent text-sm">← Home</Link>
          <div className="text-xs text-board-felt/50">Online · to {match.target}</div>
          <Link to="/profile" className="text-xs text-board-felt/60 hover:text-board-accent">Profile</Link>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md w-full p-6">
          <div className="font-display text-3xl text-board-accent text-center">
            Waiting for opponent…
          </div>
          {isOwner && inviteUrl && (
            <div className="w-full bg-board-felt/5 border border-board-felt/10 rounded-lg p-4 flex flex-col gap-3">
              <div className="text-xs uppercase tracking-wider text-board-felt/50">
                Send this link to your opponent
              </div>
              <div className="flex gap-2">
                <input
                  value={inviteUrl}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 bg-board-felt/10 border border-board-felt/20 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-board-accent"
                />
                <button
                  onClick={copyLink}
                  className="px-3 py-1 rounded bg-amber-700 text-amber-50 text-sm hover:brightness-110 active:scale-95 transition"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="text-[11px] text-board-felt/50">
                Code: <span className="font-mono text-board-accent">{match.invite_code}</span>{' '}
                · expires in 24h
              </div>
            </div>
          )}
          {isOwner && (
            <button
              onClick={async () => {
                if (!confirm('Cancel this online match?')) return;
                await supabase
                  .from('matches')
                  .update({ finished_at: new Date().toISOString() })
                  .eq('id', match.id);
                navigate('/');
              }}
              className="text-xs text-board-felt/50 hover:text-rose-400 transition"
            >
              Cancel match
            </button>
          )}
        </div>
      </main>
    );
  }

  // ---------- Game UI ----------
  const whitePip = pipCount(game.board, 'white');
  const blackPip = pipCount(game.board, 'black');

  const turnLabel = game.matchFinished
    ? 'match over'
    : game.gameWinner
      ? `${game.gameWinner} wins game`
      : !game.isLocalTurn
        ? `${game.turn}'s turn (waiting)`
        : game.roll === null
          ? 'your turn — roll'
          : 'your turn — move';

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt">
      <header className="flex items-center justify-between px-4 py-2 text-board-felt/80 gap-3">
        <Link to="/" className="text-board-accent text-sm whitespace-nowrap">← Home</Link>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-chip-cream">
            {ownerProfile?.display_name ?? '…'} {match.white_score}–{match.black_score}{' '}
            {opponentProfile?.display_name ?? '…'}
          </span>
          <span className="text-board-felt/40">·</span>
          <span className="text-board-felt/60">to {match.target}</span>
          <span className="text-board-felt/40 ml-2">w {whitePip}</span>
          <span className="text-board-felt/40">b {blackPip}</span>
        </div>
        <div className="text-xs text-board-felt/60 capitalize whitespace-nowrap">{turnLabel}</div>
      </header>

      <div className="flex-1 flex items-center justify-center p-2 sm:p-4">
        <div className="relative w-full max-w-[1100px] aspect-[3/2] rounded-lg overflow-hidden shadow-2xl">
          <BoardCanvas
            state={game.board}
            theme={woodTheme}
            selection={{
              selectedFrom: game.selectedFrom,
              validDestinations: game.validDestinations,
              legalOrigins: game.legalOrigins,
            }}
            onPointClick={handlePointClick}
          />

          <DoublingCube
            value={game.cubeValue as CubeValue}
            owner={game.cubeOwner}
            canOffer={game.canOfferDouble}
            pendingOffer={game.cubeOffer}
            onOffer={game.offerDouble}
          />

          {role !== 'spectator' && !game.betweenGames && !game.matchFinished && game.cubeOffer === null && (
            <DiceTray
              turn={game.turn}
              roll={game.roll}
              remaining={game.remaining}
              canRoll={game.canRoll}
              canEndTurn={game.canEndTurn}
              onRoll={game.rollDice}
              onEndTurn={game.endTurn}
            />
          )}

          {/* Cube offer pending: opponent decides */}
          {game.cubeOffer !== null && game.localColor !== null && game.cubeOffer !== game.localColor && !game.matchFinished && (
            <CubeOfferDecision
              offeredBy={game.cubeOffer}
              currentValue={game.cubeValue as CubeValue}
              onAccept={game.acceptDouble}
              onDrop={game.dropDouble}
            />
          )}
          {/* Cube offer pending and we are the offerer: just wait */}
          {game.cubeOffer !== null && game.cubeOffer === game.localColor && !game.matchFinished && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-30 pointer-events-none">
              <div className="bg-amber-100/95 text-amber-950 px-6 py-4 rounded-xl border-2 border-amber-700 text-sm">
                Waiting for opponent to accept or drop…
              </div>
            </div>
          )}

          {game.betweenGames && !game.matchFinished && game.currentGame && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/65 z-30">
              <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-sm">
                <div className="font-display text-2xl uppercase tracking-wider mb-1 capitalize">
                  {game.currentGame.winner} wins
                  {game.currentGame.dropped_double
                    ? ' by drop'
                    : game.currentGame.win_type
                      ? ` ${game.currentGame.win_type}`
                      : ''}
                </div>
                <div className="text-sm mb-3">
                  +{game.currentGame.points_awarded} · match {match.white_score}–{match.black_score} (to {match.target})
                </div>
                <div className="text-xs text-amber-900/70">
                  {game.localColor === game.turn
                    ? 'Roll to start the next game.'
                    : `Waiting for ${game.turn} to roll the next game…`}
                </div>
                {game.localColor === game.turn && (
                  <button
                    onClick={() => void game.rollDice()}
                    className="mt-4 px-5 py-2 rounded-md bg-amber-700 text-amber-50 font-medium hover:brightness-110 active:scale-95 transition"
                  >
                    Roll · next game
                  </button>
                )}
              </div>
            </div>
          )}

          {game.matchFinished && match.winner && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/65 z-30">
              <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center">
                <div className="font-display text-3xl uppercase tracking-wider mb-1">Match over</div>
                <div className="capitalize text-xl mb-3 font-display">
                  {match.winner} wins {match.white_score}–{match.black_score}
                </div>
                <button
                  onClick={() => navigate('/')}
                  className="px-6 py-2 rounded-md bg-amber-700 text-amber-50 font-medium hover:brightness-110 active:scale-95 transition"
                >
                  Home
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
