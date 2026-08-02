import {useEffect} from 'react';

interface BoardLockTooltipProps {
  readonly requiredLevel: number;
  readonly onDismiss: () => void;
}

export function BoardLockTooltip({
  requiredLevel,
  onDismiss
}: BoardLockTooltipProps) {
  useEffect(() => {
    const timeout = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timeout);
  }, [onDismiss]);

  return (<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
    <div
      className="pointer-events-auto rounded-xl border-2 border-amber-700 bg-gradient-to-b from-amber-100 to-amber-300 px-6 py-4 text-center font-display text-base font-black uppercase tracking-[0.12em] text-amber-950 shadow-2xl">
      Reach level {requiredLevel} to unlock
    </div>
  </div>);
}
