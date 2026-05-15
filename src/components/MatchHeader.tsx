import { Link } from 'react-router-dom';
import type { MatchState } from '../engine';

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
  const cleanTurnLabel = turnLabel.replace(/\s*\(AI\)/i, '').toUpperCase();
  const whiteDisplayName = displayName(whiteName).toUpperCase();
  const blackDisplayName = displayName(blackName).toUpperCase();

  return (
    <header className="game-match-header">
      <div className="game-nav-home">
        <Link to="/" className="game-home-link">
          <span className="game-home-icon" aria-hidden="true" />
          <span>Home</span>
        </Link>
      </div>

      <div className="game-match-hud">
        <img
          src="/gameplay/premium-purple/header.webp"
          alt=""
          className="game-match-hud-art"
          draggable={false}
        />
        <div className="game-match-label">Match to {match.target}</div>
        <div className="game-score-strip">
          <div className="game-score-player game-score-player--left">
            <span>{whiteDisplayName}</span>
            <strong>{whitePip}</strong>
          </div>
          <div className="game-score-core">
            <span>{match.score.white}</span>
            <span className="game-score-separator">:</span>
            <span>{match.score.black}</span>
          </div>
          <div className="game-score-player game-score-player--right">
            <span>{blackDisplayName}</span>
            <strong>{blackPip}</strong>
          </div>
        </div>
        <div className="game-turn-pill">
          <span className="game-turn-dot" />
          <span>{cleanTurnLabel}</span>
          {inCrawford && <span className="game-crawford-pill">Crawford</span>}
        </div>
      </div>
      <div className="game-header-actions">
        <button type="button" className="game-header-icon-button" aria-label="Statistics">
          <img src="/gameplay/premium-purple/stats.webp" alt="" draggable={false} />
        </button>
        <button type="button" className="game-header-icon-button" aria-label="Settings">
          <img src="/gameplay/premium-purple/settings.webp" alt="" draggable={false} />
        </button>
      </div>
    </header>
  );
}
