import { useEffect, useRef, useState } from 'react';
import { formatCompactNumber } from '../lib/format';

interface RollingNumberProps {
  /** The numeric value the wallet currently holds. */
  readonly value: number | null | undefined;
  /** How long the count-up animation runs (ms). 700 by default —
   *  long enough to read the change, short enough that the player
   *  isn't waiting on it. */
  readonly durationMs?: number;
  /** Whether to format with K / M suffixes (matches the static
   *  display). Defaults to true so the rolling display reads
   *  identically to the post-animation static value. */
  readonly compact?: boolean;
}

/**
 * Animates a number from its previous value to the current one over
 * `durationMs`. Used on the wallet pills so when a reward lands the
 * coin counter visibly tick-rolls up to the new total instead of
 * snapping. Mounts displaying whatever value is already there (no
 * animation on first render) — only changes animate.
 */
export function RollingNumber({ value, durationMs = 700, compact = true }: RollingNumberProps) {
  const target = Math.max(0, value ?? 0);
  const [displayed, setDisplayed] = useState<number>(target);
  const fromRef = useRef<number>(target);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip animation if the value didn't actually change.
    if (target === displayed) return;
    fromRef.current = displayed;
    startRef.current = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic — fast at the start, settles smoothly.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setDisplayed(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // We intentionally don't include `displayed` in deps — it would
    // re-trigger the effect on every frame and reset fromRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return <>{compact ? formatCompactNumber(displayed) : displayed.toLocaleString()}</>;
}
