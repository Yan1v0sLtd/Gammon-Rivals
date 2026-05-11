interface Props {
  enabled: boolean;
  onChange: (next: boolean) => void;
  className?: string;
  variant?: 'panel' | 'inline';
}

/**
 * Vertical pill toggle for the auto-roll preference. Rendered in the
 * right side panel beside the player's avatar — when on, the dice are
 * rolled automatically at the start of the player's turn.
 */
export default function AutoRollToggle({
  enabled,
  onChange,
  className = '',
  variant = 'panel',
}: Props) {
  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`flex h-10 items-center gap-1.5 rounded-full border-2 border-slate-950 bg-[#101827]/95 px-1.5 shadow-[inset_0_2px_0_rgba(255,255,255,0.12),0_0_0_2px_rgba(245,197,90,0.45)] transition hover:brightness-110 active:scale-95 sm:h-12 sm:gap-2 sm:px-2.5 ${className}`}
        aria-pressed={enabled}
        title={enabled ? 'Auto-roll is on' : 'Auto-roll is off'}
      >
        <span
          className={`relative inline-flex h-6 w-10 items-center rounded-full border transition sm:h-7 sm:w-12 ${
            enabled
              ? 'border-lime-200 bg-gradient-to-b from-lime-300 to-emerald-600'
              : 'border-amber-500/45 bg-gradient-to-b from-stone-700 to-stone-950'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-amber-100 shadow transition-transform sm:h-6 sm:w-6 ${
              enabled ? 'translate-x-4 sm:translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </span>
        <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-amber-100/80 sm:block">
          Auto
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`flex flex-col items-center gap-1 select-none group ${className}`}
      aria-pressed={enabled}
      title={enabled ? 'Auto-roll is on' : 'Auto-roll is off'}
    >
      <span
        className={`relative inline-flex items-center w-12 h-7 rounded-full border transition ${
          enabled
            ? 'bg-amber-600/90 border-amber-800'
            : 'bg-stone-800/80 border-stone-700'
        }`}
      >
        <span
          className={`absolute top-0.5 w-6 h-6 rounded-full bg-amber-100 shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
        <span
          className={`absolute inset-0 flex items-center px-1.5 text-[9px] font-display tracking-wider ${
            enabled ? 'text-amber-50 justify-start' : 'text-stone-400 justify-end'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </span>
      </span>
      <span className="text-[10px] font-display tracking-wider text-amber-200/70 group-hover:text-amber-200 transition uppercase">
        Auto Roll
      </span>
    </button>
  );
}
