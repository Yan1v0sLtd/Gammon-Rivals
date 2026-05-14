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
      <div aria-hidden="true" />
    </header>
  );
}
