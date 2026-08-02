import type { CSSProperties } from 'react';

interface Props {
  readonly progress: number;
  readonly secondsLeft: number;
  readonly compact?: boolean;
  readonly side?: 'left' | 'right';
}

export default function TurnTimerBar({
  progress,
  secondsLeft,
  compact = false,
  side = 'left',
}: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  const tone = clamped > 0.34 ? 'is-safe' : clamped > 0.16 ? 'is-warning' : 'is-danger';
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');
  const timerStyle = { '--timer-progress': clamped } as CSSProperties;

  return (
    <div className={`game-turn-timer game-turn-timer--${side} ${compact ? 'is-compact' : ''} ${tone}`}>
      <div
        className="game-turn-timer-track"
        aria-label={`${secondsLeft} seconds left`}
        style={timerStyle}
      >
        <div className="game-turn-timer-fill" />
      </div>
      <strong>{minutes}:{seconds}</strong>
    </div>
  );
}
