import { Link } from 'react-router-dom';
import type { MatchState } from '../engine';

interface Props {
  match: MatchState;
  whitePip: number;
  blackPip: number;
  turnLabel: string;
  inCrawford: boolean;
  onNewMatch?: () => void;
}

export default function MatchHeader({
  match,
  whitePip,
  blackPip,
  turnLabel,
  inCrawford,
  onNewMatch,
}: Props) {
  return (
    <header className="z-30 flex h-9 shrink-0 items-center justify-between gap-2 px-3 text-board-felt/80 sm:px-4">
      <div className="flex min-w-0 items-center gap-3 order-1">
        <Link to="/" className="text-board-accent text-sm whitespace-nowrap">
          ← Home
        </Link>
        <Link
          to="/profile"
          className="text-xs text-board-felt/50 hover:text-board-accent transition"
        >
          Profile
        </Link>
        {onNewMatch && (
          <button
            onClick={onNewMatch}
            className="text-xs text-board-felt/50 hover:text-board-accent transition"
          >
            New match
          </button>
        )}
      </div>

      <div className="hidden text-xs text-board-felt/60 capitalize whitespace-nowrap order-2 sm:order-3 sm:block">
        {turnLabel}
      </div>

      <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono justify-center order-3 sm:order-2">
        <span className="text-chip-cream">
          w <span className="text-board-felt/50">{whitePip}</span>
        </span>
        <span className="px-2 py-0.5 rounded bg-amber-900/40 text-amber-200 font-display tracking-wider">
          {match.score.white}–{match.score.black}
        </span>
        <span className="text-board-felt">
          <span className="text-board-felt/50">{blackPip}</span> b
        </span>
        <span className="text-board-felt/40">·</span>
        <span className="text-board-felt/60">to {match.target}</span>
        {inCrawford && (
          <span className="px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-200 font-display text-[10px] tracking-wider uppercase">
            Crawford
          </span>
        )}
      </div>
    </header>
  );
}
