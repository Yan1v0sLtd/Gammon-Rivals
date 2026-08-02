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
    return (<button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`game-auto-toggle ${enabled ? 'is-on' : ''} ${className}`}
      aria-pressed={enabled}
      title={enabled ? 'Auto-roll is on' : 'Auto-roll is off'}
    >
        <span className="game-auto-switch">
          <span className="game-auto-knob"/>
        </span>
      <span className="game-auto-label">
          Auto
        </span>
    </button>);
  }

  return (<button
    type="button"
    onClick={() => onChange(!enabled)}
    className={`flex flex-col items-center gap-1 select-none group ${className}`}
    aria-pressed={enabled}
    title={enabled ? 'Auto-roll is on' : 'Auto-roll is off'}
  >
      <span
        className={`relative inline-flex items-center w-12 h-7 rounded-full border transition ${enabled ? 'bg-amber-600/90 border-amber-800' : 'bg-stone-800/80 border-stone-700'}`}
      >
        <span
          className={`absolute top-0.5 w-6 h-6 rounded-full bg-amber-100 shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
        <span
          className={`absolute inset-0 flex items-center px-1.5 text-[9px] font-display tracking-wider ${enabled ? 'text-amber-50 justify-start' : 'text-stone-400 justify-end'}`}
        >
          {enabled ? 'ON' : 'OFF'}
        </span>
      </span>
    <span
      className="text-[10px] font-display tracking-wider text-amber-200/70 group-hover:text-amber-200 transition uppercase">
        Auto Roll
      </span>
  </button>);
}
