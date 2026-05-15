interface Props {
  readonly progress: number;
  readonly secondsLeft: number;
  readonly compact?: boolean;
}

export default function TurnTimerBar({ progress, secondsLeft, compact = false }: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  const tone = clamped > 0.34 ? 'is-safe' : clamped > 0.16 ? 'is-warning' : 'is-danger';
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className={`game-turn-timer ${compact ? 'is-compact' : ''} ${tone}`}>
      <span className="game-turn-timer-icon" aria-hidden="true" />
      <div className="game-turn-timer-track" aria-label={`${secondsLeft} seconds left`}>
        <div className="game-turn-timer-fill" style={{ width: `${clamped * 100}%` }} />
      </div>
      <strong>{minutes}:{seconds}</strong>
    </div>
  );
}
