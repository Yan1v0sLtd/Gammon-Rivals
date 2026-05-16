import { useEffect, useState } from 'react';
import type { Die } from '../engine/types';
import DieFace from './DieFace';

/**
 * During the roll animation, a real die tumbles through different face
 * values before settling. This wrapper cycles the rendered face through
 * a random sequence for `tumbleMs`, then locks to the final `value`.
 *
 * The flight CSS animation is ~980ms with a small per-die delay; we
 * tumble for the first ~75% of that and reveal the final value before
 * the dice come fully to rest so it reads as a clean settle.
 */

interface Props {
  /** Final value to settle on once tumbling is over. */
  value: Die;
  /** Total tumble duration in ms (defaults to ~75% of the flight). */
  tumbleMs?: number;
  /** Per-die start delay so two dice don't tumble in lockstep. */
  delayMs?: number;
  /** Pip/face color theme. */
  variant?: 'white' | 'dark';
  /** When false, skip the tumble and show the final value (used for
   *  "used" dice that don't re-animate). */
  animate?: boolean;
}

const FACE_VALUES: Die[] = [1, 2, 3, 4, 5, 6];

function pickRandomFace(exclude: Die): Die {
  // Avoid showing the same value twice in a row — it makes the tumble
  // look more lively.
  let next: Die = exclude;
  while (next === exclude) {
    next = FACE_VALUES[Math.floor(Math.random() * 6)];
  }
  return next;
}

export default function TumblingDieFace({
  value,
  tumbleMs = 720,
  delayMs = 0,
  variant = 'white',
  animate = true,
}: Props) {
  const [displayValue, setDisplayValue] = useState<Die>(value);

  useEffect(() => {
    if (!animate) {
      setDisplayValue(value);
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | undefined;
    let settleId: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    // Tumble starts on each new roll (new key remounts the component).
    // Step interval gradually lengthens so the tumble decelerates into
    // the settle, mimicking the dice slowing down.
    let lastValue: Die = value;
    setDisplayValue(pickRandomFace(value));

    const startDelay = setTimeout(() => {
      if (!mounted) return;
      const stepMs = 70;
      intervalId = setInterval(() => {
        lastValue = pickRandomFace(lastValue);
        setDisplayValue(lastValue);
      }, stepMs);

      settleId = setTimeout(() => {
        if (intervalId) clearInterval(intervalId);
        if (mounted) setDisplayValue(value);
      }, tumbleMs);
    }, delayMs);

    return () => {
      mounted = false;
      clearTimeout(startDelay);
      if (intervalId) clearInterval(intervalId);
      if (settleId) clearTimeout(settleId);
    };
    // Re-run whenever the final value changes (new roll).
  }, [value, tumbleMs, delayMs, animate]);

  return <DieFace value={displayValue} variant={variant} />;
}
