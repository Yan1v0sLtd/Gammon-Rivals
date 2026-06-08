import { useNavigate } from 'react-router-dom';
import type { MatchState } from '../engine';
import { useNavigationOverlay } from '../lib/navigationOverlay';

interface Props {
  match: MatchState;
  whitePip: number;
  blackPip: number;
  turnLabel: string;
  inCrawford: boolean;
  onNewMatch?: () => void;
  whiteName?: string;
  blackName?: string;
}

function displayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Player';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export default function MatchHeader({
  match,
  whitePip,
  blackPip,
  turnLabel,
  inCrawford,
  whiteName = 'White',
  blackName = 'Black',
}: Props) {
  const navigate = useNavigate();
  const { show: showOverlay } = useNavigationOverlay();
  const cleanTurnLabel = turnLabel.replace(/\s*\(AI\)/i, '').toUpperCase();
  const whiteDisplayName = displayName(whiteName).toUpperCase();
  const blackDisplayName = displayName(blackName).toUpperCase();

  const goHome = () => {
    // Put the loader up before the route changes so the gameplay never
    // flashes between unmount and the lobby's own preload gate.
    showOverlay();
    navigate('/play');
  };

  return (
    <header className="game-match-header">
      <div className="game-nav-home">
        <button
          type="button"
          onClick={goHome}
          className="game-home-link"
          aria-label="Back to lobby"
        >
          <img
            src="/gameplay/premium-purple/lobby.webp"
            alt=""
            className="game-home-image"
            draggable={false}
          />
        </button>
      </div>

      <div className="game-match-hud">
        {/* "MATCH TO N" sits ABOVE the header asset, not inside it.
         * Hidden for quick-match (target=1) — every match is a single
         * game so the framing is just noise. The label comes back as
         * soon as tournaments use a larger target. */}
        {match.target > 1 && (
          <div className="game-match-label">Match to {match.target}</div>
        )}

        {/* The new header art has the rails baked in, so the row just
            contains the pill with the score overlay + turn label. The
            player names overlay the rail areas of the art at left/right. */}
        <div className="game-match-hud-row">
          <div className="game-match-hud-pill">
            <img
              src="/gameplay/premium-purple/header.webp"
              alt=""
              className="game-match-hud-art"
              draggable={false}
            />
            <div
              className="game-score-player game-score-player--left"
              aria-label={`${whiteDisplayName} pip count`}
            >
              <span>{whiteDisplayName}</span>
              <strong>{whitePip}</strong>
            </div>
            <div className="game-score-core">
              <span>{match.score.white}</span>
              <span className="game-score-separator">:</span>
              <span>{match.score.black}</span>
            </div>
            <div
              className="game-score-player game-score-player--right"
              aria-label={`${blackDisplayName} pip count`}
            >
              <span>{blackDisplayName}</span>
              <strong>{blackPip}</strong>
            </div>
            {/* Turn indicator sits in the BOTTOM tab of the header art. */}
            <div className="game-turn-pill">
              <span className="game-turn-dot" />
              <span>{cleanTurnLabel}</span>
              {inCrawford && <span className="game-crawford-pill">Crawford</span>}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
