interface Props {
  readonly progress: number;
  readonly secondsLeft: number;
  readonly compact?: boolean;
}

export default function TurnTimerBar({ progress, secondsLeft, compact = false }: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  const fill =
    clamped > 0.34
      ? 'from-[#b9ff5c] via-[#44e544] to-[#0a9d20]'
      : clamped > 0.16
        ? 'from-[#ffe66a] via-[#ffaf28] to-[#d67205]'
        : 'from-[#ff8b72] via-[#ef3f3f] to-[#981b1b]';

  return (
    <div className={`w-full ${compact ? 'max-w-[9rem]' : 'max-w-[11.5rem]'}`}>
      <div
        className={`relative overflow-hidden rounded-full border border-black/60 bg-black/55 shadow-[inset_0_1px_3px_rgba(0,0,0,0.85)] ${
          compact ? 'h-2.5' : 'h-3.5'
        }`}
        aria-label={`${secondsLeft} seconds left`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r ${fill} shadow-[inset_0_1px_0_rgba(255,255,255,0.58),0_0_8px_rgba(105,255,73,0.34)] transition-[width] duration-200`}
          style={{ width: `${clamped * 100}%` }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/24" />
      </div>
      {!compact && (
        <div className="mt-1 text-center text-[0.68rem] font-black uppercase tracking-wide text-amber-100/75">
          {secondsLeft}s
        </div>
      )}
    </div>
  );
}
