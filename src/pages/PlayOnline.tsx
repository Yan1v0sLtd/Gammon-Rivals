import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import BoardCanvas from '../board/BoardCanvas';
import DiceTray from '../components/DiceTray';
import CubeOfferDecision from '../components/CubeOfferDecision';
import BoardLayout from '../components/BoardLayout';
import ActionButtons from '../components/ActionButtons';
import AutoRollToggle from '../components/AutoRollToggle';
import MatchHeader from '../components/MatchHeader';
import { useAuth } from '../lib/auth';
import { useNavigationOverlay } from '../lib/navigationOverlay';
import { supabase } from '../lib/supabase';
import { formatCompactNumber } from '../lib/format';
import { getProfileProgression } from '../lib/progression';
import { useOnlineGame } from '../game/useOnlineGame';
import { pipCount } from '../engine';
import type { Position } from '../engine/types';
import type { CubeValue, MatchState } from '../engine';
import { useBoardThemeConfig } from '../board/theme';
import type { Database } from '../types/database';
import type { PlayerIdentity } from '../lib/identity';
import { useAutoRoll, useAutoRollEffect } from '../lib/useAutoRoll';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

function profileToIdentity(p: ProfileRow | null): PlayerIdentity | null {
  if (!p) return null;
  return { name: p.display_name, avatarSeed: p.avatar_seed, avatarUrl: p.avatar_url };
}

export default function PlayOnline() {
  const { matchId } = useParams<{ matchId: string }>();
  const [params] = useSearchParams();
  const {
    user,
    wallet,
    progression,
    levelConfigs,
    isLoading: authLoading,
  } = useAuth();
  const navigate = useNavigate();
  // The lobby's matchmaking flow calls showOverlay() right before
  // routing here (so the overlay covers the route swap). PlayOnline
  // is the destination, so it owns the hide call. We fire it once the
  // online game's first state load resolves — whether the match was
  // found or returned an error, the overlay should stop showing
  // "Loading…" so the user can interact (or see the error).
  const { hide: hideOverlay } = useNavigationOverlay();
  /**
   * Difficulty rooms set ?turn=<seconds> when they route into here so
   * the inactivity-forfeit threshold scales with the room's per-turn
   * timer. Allow a 15-second grace on top of the timer (one missed
   * turn worth) before declaring the opponent absent. Legacy
   * /play/:id entry points (invite link, public lobby) don't pass
   * ?turn= — they fall back to the 5-minute default inside the hook.
   */
  const turnSecondsParam = (() => {
    const raw = params.get('turn');
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return null;
    return Math.min(600, Math.max(5, n));
  })();
  // Auto-forfeit threshold needs to be lenient enough that a player
  // who's lining up a checker move doesn't get yanked into a loss.
  // Pick the larger of "3x the room's turn timer" and a 60s floor.
  // For Beginner (turn=15s) -> 60s; for Pro (45s) -> 135s; etc.
  // Pairs with the !!currentGame gate in useOnlineGame so this
  // doesn't fire at match start before anyone has rolled.
  const inactivityForfeitMs = turnSecondsParam !== null
    ? Math.max(turnSecondsParam * 3, 60) * 1000
    : undefined;
  const game = useOnlineGame(matchId, {
    inactivityForfeitMs,
    turnSeconds: turnSecondsParam,
  });
  const boardParam = params.get('board');
  const { theme: selectedTheme } = useBoardThemeConfig(boardParam);

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
  }, [game.match]);

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

  const inviteCode = game.match?.invite_code;
  const inviteUrl = useMemo(
    () =>
      inviteCode
        ? `${window.location.origin}/join/${inviteCode}${
            boardParam ? `?board=${encodeURIComponent(boardParam)}` : ''
          }`
        : null,
    [boardParam, inviteCode]
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

  // ---- Auto-roll preference ----
  // Hooks must be called unconditionally — these run on every render.
  const [autoRollOn, setAutoRollOn] = useAutoRoll();
  useAutoRollEffect(autoRollOn, game.canRoll && !game.betweenGames, () => {
    void game.rollDice();
  });

  // Dismiss the route-spanning loader once the online game's first
  // load resolves (match + game state). Without this the lobby's
  // matchmaking showOverlay() never fades — the player sits on the
  // "Loading" branding indefinitely after a successful pair-up.
  // Fires on both the success path (game ready) and the error path
  // (so the error UI is visible).
  const overlayReady = !authLoading && (!game.loading || game.error !== null);
  useEffect(() => {
    if (overlayReady) hideOverlay();
  }, [overlayReady, hideOverlay]);

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
  const isSpectator = role === 'spectator';

  // Map owner/opponent profiles to seats based on local color. The local
  // player sits on the right; the opponent on the left.
  const ownerColor = match.owner_color === 'black' ? 'black' : 'white';
  const opponentColor = ownerColor === 'white' ? 'black' : 'white';
  const isOwnerLocal = user.id === match.owner_id;
  const selfProfile = isOwnerLocal ? ownerProfile : opponentProfile;
  const opponentProf = isOwnerLocal ? opponentProfile : ownerProfile;
  const selfColor = isOwnerLocal ? ownerColor : opponentColor;
  const oppColor = selfColor === 'white' ? 'black' : 'white';
  const selfPip = selfColor === 'white' ? whitePip : blackPip;
  const oppPip = oppColor === 'white' ? whitePip : blackPip;
  const isLocalTurn = !!game.isLocalTurn;
  const isRollForSelf = game.turn === selfColor;
  const selfProgression =
    selfProfile?.id === user.id ? progression : getProfileProgression(selfProfile, levelConfigs);
  const opponentProgression = getProfileProgression(opponentProf, levelConfigs);
  const selfName = selfProfile?.display_name;
  const oppName = opponentProf?.display_name;

  const turnLabel = game.matchFinished
    ? 'match over'
    : isSpectator
      ? `${game.turn} to ${game.roll === null ? 'roll' : 'move'}`
      : game.gameWinner
        ? `${game.gameWinner} wins game`
        : !game.isLocalTurn
          ? `${game.turn}'s turn`
          : game.roll === null
            ? 'your turn — roll'
            : 'your turn — move';

  // Build a synthetic MatchState for MatchHeader (it expects engine shape).
  const headerMatch: MatchState = {
    score: { white: match.white_score, black: match.black_score },
    target: match.target,
    cube: { value: game.cubeValue as CubeValue, owner: game.cubeOwner },
    cubeOffer: game.cubeOffer,
    crawfordGameNumber: null,
    gameNumber: 1,
    winner: null,
  };

  const showCubeDecisionCenter =
    game.cubeOffer !== null &&
    game.localColor !== null &&
    game.cubeOffer !== game.localColor &&
    !game.matchFinished;
  const showCubePending =
    game.cubeOffer !== null &&
    game.cubeOffer === game.localColor &&
    !game.matchFinished;
  const showBetweenGames = game.betweenGames && !game.matchFinished && !!game.currentGame;
  const showMatchOver = game.matchFinished && !!match.winner;

  const showActions = role !== 'spectator' && !game.betweenGames && !game.matchFinished && game.cubeOffer === null;
  const gameplayBackground =
    selectedTheme.gameplayBackgroundImage ?? selectedTheme.backgroundImage;

  return (
    <BoardLayout
      backgroundImage={gameplayBackground}
      header={
        <MatchHeader
          match={headerMatch}
          whitePip={oppPip}
          blackPip={selfPip}
          turnLabel={turnLabel}
          inCrawford={game.inCrawfordGame}
          whiteName={oppName ?? 'Opponent'}
          blackName={selfName ?? 'Player'}
        />
      }
      opponent={{
        identity: profileToIdentity(opponentProf),
        pipCount: oppPip,
        scoreLabel: `${oppColor === 'white' ? match.white_score : match.black_score} / ${match.target}`,
        level: opponentProgression.level,
        stateLabel: opponentProgression.statusLabel,
        coinsLabel: '—',
        isTurn: !isLocalTurn && !showMatchOver,
        timerProgress:
          !isLocalTurn && !showMatchOver && !game.betweenGames
            ? game.turnProgress ?? undefined
            : undefined,
        timerSecondsLeft:
          !isLocalTurn && !showMatchOver && !game.betweenGames
            ? game.turnSecondsLeft ?? undefined
            : undefined,
      }}
      self={{
        identity: profileToIdentity(selfProfile),
        pipCount: selfPip,
        scoreLabel: `${selfColor === 'white' ? match.white_score : match.black_score} / ${match.target}`,
        level: selfProgression.level,
        stateLabel: selfProgression.statusLabel,
        coinsLabel: formatCompactNumber(wallet?.coins),
        isTurn: isLocalTurn && !showMatchOver,
        timerProgress:
          isLocalTurn && !showMatchOver && !game.betweenGames
            ? game.turnProgress ?? undefined
            : undefined,
        timerSecondsLeft:
          isLocalTurn && !showMatchOver && !game.betweenGames
            ? game.turnSecondsLeft ?? undefined
            : undefined,
      }}
      actionsOverlay={
        showActions ? (
          <ActionButtons
            canRoll={game.canRoll}
            onRoll={() => void game.rollDice()}
            canEndTurn={game.canEndTurn}
            onEndTurn={() => void game.endTurn()}
            canDouble={game.canOfferDouble}
            onDouble={() => void game.offerDouble()}
            cubeValue={game.cubeValue}
            // Online undo not supported (server-authoritative). We still
            // render the row so DOUBLE/ROLL stay positioned; UNDO simply
            // never shows.
            canUndo={false}
            onUndo={() => {}}
            autoRollSlot={
              !isSpectator ? (
                <AutoRollToggle
                  enabled={autoRollOn}
                  onChange={setAutoRollOn}
                  variant="inline"
                />
              ) : null
            }
          />
        ) : null
      }
      centerOverlay={
        showCubeDecisionCenter ? (
          <CubeOfferDecision
            offeredBy={game.cubeOffer!}
            currentValue={game.cubeValue as CubeValue}
            onAccept={() => void game.acceptDouble()}
            onDrop={() => void game.dropDouble()}
          />
        ) : showCubePending ? (
          <div className="bg-amber-100/95 text-amber-950 px-6 py-4 rounded-xl border-2 border-amber-700 text-sm">
            Waiting for opponent to accept or drop…
          </div>
        ) : showBetweenGames ? (
          <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-sm">
            <div className="font-display text-2xl uppercase tracking-wider mb-1 capitalize">
              {game.currentGame!.winner} wins
              {game.currentGame!.dropped_double
                ? ' by drop'
                : game.currentGame!.win_type
                  ? ` ${game.currentGame!.win_type}`
                  : ''}
            </div>
            <div className="text-sm mb-3">
              +{game.currentGame!.points_awarded} · match {match.white_score}–{match.black_score} (to {match.target})
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
        ) : showMatchOver ? (
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
        ) : null
      }
    >
      <BoardCanvas
        state={game.board}
        theme={selectedTheme}
        selection={{
          selectedFrom: isLocalTurn && !isSpectator ? game.selectedFrom : null,
          validDestinations: isLocalTurn && !isSpectator ? game.validDestinations : [],
          legalOrigins: isLocalTurn && !isSpectator ? game.legalOrigins : [],
          opponentOrigins: game.opponentPreviewOrigins,
          opponentDestinations: game.opponentPreviewDestinations,
        }}
        onPointClick={handlePointClick}
      />
      <DiceTray
        roll={game.roll}
        remaining={game.remaining}
        settleSide={isRollForSelf ? 'right' : 'left'}
      />

      {/* Resign button — top-right of board. Only during active play
          (not spectator, not finished, not waiting for opponent). The
          confirm uses window.confirm because the resign flow is a
          one-off "are you sure" — no need for a styled modal layer
          when we already have native dialogs for cancel-match. */}
      {!isSpectator && !game.matchFinished && !waiting && (
        <button
          type="button"
          onClick={async () => {
            if (!confirm('Resign this match? Your opponent will be credited with the win and you take the rating + payout penalty.')) return;
            await game.resign();
          }}
          className="absolute top-2 right-2 z-20 px-2.5 py-1 rounded bg-black/60 border border-board-felt/20 text-board-felt/70 hover:text-rose-300 hover:border-rose-400/40 text-[11px] uppercase tracking-wider backdrop-blur transition"
        >
          Resign
        </button>
      )}

      {/* Inactivity countdown / claim button — sits at top of board.
          Shown only when the opponent has been silent for long enough
          that "they're thinking" is no longer a charitable read. The
          claim-in countdown reflects the actual inactivityForfeitMs
          for this room (60s for Beginner, 135s for Pro, etc.) rather
          than the hardcoded 5-minute default that used to render here
          and confuse tier players whose actual threshold was way
          shorter. */}
      {(() => {
        const totalForfeitSeconds = Math.floor((inactivityForfeitMs ?? 5 * 60 * 1000) / 1000);
        // Show the indicator once the player has been waiting at
        // least half the forfeit threshold, capped at 30s so even
        // long-threshold rooms surface the indicator promptly.
        const showThresholdSeconds = Math.min(Math.floor(totalForfeitSeconds / 2), 30);
        if (isSpectator || game.matchFinished || game.isLocalTurn) return null;
        if (game.secondsSinceActivity < showThresholdSeconds) return null;
        const claimInSeconds = Math.max(0, totalForfeitSeconds - game.secondsSinceActivity);
        return (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 border border-board-felt/20 text-board-felt/80 text-xs px-3 py-1.5 rounded z-20 flex items-center gap-2 backdrop-blur">
            {game.canClaimByInactivity ? (
              <>
                <span>Opponent inactive for {game.secondsSinceActivity}s</span>
                <button
                  onClick={async () => {
                    if (!confirm('Claim victory by opponent timeout?')) return;
                    await game.claimByInactivity();
                  }}
                  className="px-2 py-0.5 rounded bg-amber-700 text-amber-50 hover:brightness-110"
                >
                  Claim victory
                </button>
              </>
            ) : (
              <span>
                Opponent thinking · claim in {claimInSeconds}s
              </span>
            )}
          </div>
        );
      })()}
    </BoardLayout>
  );
}
