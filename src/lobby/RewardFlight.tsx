import { useEffect, useRef } from 'react';

export type FlightCurrency = 'coins' | 'gems';

export interface RewardFlightSpec {
  readonly id: number;
  readonly currency: FlightCurrency;
  /** Viewport coords for the starting centre of the flying token. */
  readonly startX: number;
  readonly startY: number;
  /** Viewport coords for the centre of the destination wallet pill. */
  readonly endX: number;
  readonly endY: number;
  /** Stagger so multiple tokens don't overlap perfectly. */
  readonly delayMs: number;
  /** Total flight duration in ms. */
  readonly durationMs: number;
}

const ICONS: Record<FlightCurrency, string> = {
  coins: '/lobby/icons/gold-coin.webp',
  gems: '/lobby/carousel/gem.webp',
};

interface Props {
  readonly spec: RewardFlightSpec;
  readonly onLanded: (id: number) => void;
}

/**
 * One flying token. Uses the Web Animations API to slide and slightly
 * arc from the start point to the wallet pill, scaling down and fading
 * out as it lands. When the animation finishes, it removes itself via
 * the onLanded callback.
 */
export function RewardFlight({ spec, onLanded }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Stash the latest onLanded in a ref so we can reference it from the
  // mount-only effect without listing it as a dep (which would cause
  // the effect to re-run on every parent render and cancel the flight
  // mid-flight).
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dx = spec.endX - spec.startX;
    const dy = spec.endY - spec.startY;
    // Arc up by ~30 % of the vertical distance so tokens curve, not slide.
    const arcY = dy * 0.5 - Math.max(60, Math.abs(dy) * 0.25);
    const anim = el.animate(
      [
        {
          transform: 'translate(-50%, -50%) translate(0px, 0px) scale(1)',
          opacity: 1,
        },
        {
          // Mid-point: half the horizontal travel + arc Y peak.
          transform: `translate(-50%, -50%) translate(${dx * 0.55}px, ${arcY}px) scale(0.95)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.35)`,
          opacity: 0,
        },
      ],
      {
        duration: spec.durationMs,
        delay: spec.delayMs,
        easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
        fill: 'forwards',
      }
    );
    let cancelled = false;
    anim.finished
      .then(() => {
        if (!cancelled) onLandedRef.current(spec.id);
      })
      .catch(() => {
        if (!cancelled) onLandedRef.current(spec.id);
      });
    return () => {
      cancelled = true;
      try {
        anim.cancel();
      } catch {
        // ignore — element may have been removed already
      }
    };
    // Mount-only: the spec is immutable for this instance, so we only
    // want to start the animation once. Re-creating the animation on
    // every parent render would cancel it mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed z-[60] h-10 w-10 select-none drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)]"
      style={{
        left: `${spec.startX}px`,
        top: `${spec.startY}px`,
        // Initial transform is set so the element is centred on (startX,startY)
        // before the animation begins; the animation keyframes also include
        // `translate(-50%, -50%)` so the centre is preserved through the path.
        transform: 'translate(-50%, -50%)',
      }}
    >
      <img
        src={ICONS[spec.currency]}
        alt=""
        className="h-full w-full"
        draggable={false}
      />
    </div>
  );
}
