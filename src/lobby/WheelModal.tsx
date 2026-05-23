import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RewardFlight, type FlightCurrency, type RewardFlightSpec } from './RewardFlight';
import type { WheelSlot, WheelStateResult } from './useWheelState';

/**
 * spin_wheel returns a single object describing what the player won
 * plus the credited deltas. Coins & gems are credited atomically on
 * the server inside the RPC; the lobby then refetches the wallet so
 * the top-bar RollingNumber ticks to the new total around the time
 * the flying tokens land on the pills.
 */
interface SpinResult {
  readonly slot_index: number;
  readonly label: string | null;
  readonly accent_color: string;
  readonly primary_reward: {
    readonly type: string;
    readonly amount: number;
    readonly icon_url: string | null;
  };
  readonly secondary_reward: {
    readonly type: string;
    readonly amount: number;
    readonly icon_url: string | null;
  } | null;
  readonly credited_coins: number;
  readonly credited_gems: number;
  readonly credited_xp: number;
  readonly next_spin_at: string;
  readonly wallet: { readonly coins: number; readonly gems: number };
  readonly profile: { readonly xp: number; readonly level: number };
}

interface Props {
  readonly wheel: WheelStateResult;
  readonly onClose: () => void;
  /** Called once the spin animation + celebration completes. The
   *  lobby uses this to refresh the wallet + wheel state so the
   *  next cooldown begins. */
  readonly onSpinComplete: () => void;
}

const SLOT_COUNT = 10;
const SLOT_ANGLE = 360 / SLOT_COUNT;
const SLOT_HALF = SLOT_ANGLE / 2;
/** Single-phase Power4 ease-out spin. Five seconds is long enough
 *  for anticipation to build, short enough that the player isn't
 *  bored. Matches the GSAP reference's feel. */
const SPIN_DURATION_MS = 5000;
/** How long the modal stays open AFTER the wheel lands and reward
 *  flights launch. Needs to cover the longest flight delay + flight
 *  duration so no token vanishes mid-arc when the modal unmounts. */
const POST_SPIN_HOLD_MS = 1500;

/** Per-accent gradient pair. The first hex shades the conic-gradient
 *  wedge; the second is used for darker rim/glow accents. Unknown
 *  accents fall back to gold so a BO mistype still renders. */
const ACCENT_PAIRS: Record<string, [string, string]> = {
  gold: ['#f5b41a', '#a55d09'],
  purple: ['#a855f7', '#581c87'],
  red: ['#ef4444', '#7f1d1d'],
  green: ['#22c55e', '#14532d'],
  blue: ['#3b82f6', '#1e3a8a'],
  orange: ['#f97316', '#7c2d12'],
};

function accentPair(accent: string): [string, string] {
  return ACCENT_PAIRS[accent] ?? ACCENT_PAIRS.gold;
}

/** Build the conic-gradient string painting all 10 wedges. The
 *  `from` value (-SLOT_HALF) puts slot 0 centered at the top so the
 *  pointer aligns to the canonical slot indexing. */
function conicGradientFromSlots(slots: readonly WheelSlot[]): string {
  const parts: string[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = slots[i];
    const [light] = accentPair(slot?.accent_color ?? 'gold');
    parts.push(`${light} ${i * SLOT_ANGLE}deg ${(i + 1) * SLOT_ANGLE}deg`);
  }
  return `conic-gradient(from -${SLOT_HALF}deg, ${parts.join(', ')})`;
}

/** Inline-SVG XP hex — matches the DailyBonusModal styling. Used
 *  whenever a slot's reward type is 'xp', regardless of whether
 *  icon_url points at a (potentially missing) /lobby/icons/xp.webp.
 *  Keeps XP visuals consistent across the lobby. */
function XpHex() {
  return (
    <svg viewBox="0 0 100 110" width="100%" height="100%" aria-hidden>
      <defs>
        <linearGradient id="wm-xp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#581c87" />
        </linearGradient>
      </defs>
      <polygon points="50,3 96,28 96,82 50,107 4,82 4,28" fill="#fbbf24" />
      <polygon points="50,11 88,33 88,77 50,99 12,77 12,33" fill="url(#wm-xp-fill)" />
      <text
        x="50"
        y="68"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="900"
        fontSize="34"
        fill="white"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1"
      >
        XP
      </text>
    </svg>
  );
}

/** Render the slot's icon. For 'xp' rewards we always render the
 *  inline hex so the missing /lobby/icons/xp.webp doesn't show as
 *  a broken-image glyph. For other types we honour icon_url and
 *  fall back silently when it's blank. */
function RewardIcon({ type, iconUrl }: { type: string; iconUrl: string | null }) {
  if (type === 'xp') return <XpHex />;
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))',
        }}
      />
    );
  }
  return null;
}

/** Format the amount the way the slot label reads — JACKPOT keeps
 *  its name, 1000+ collapses to "1K" so the wedge text doesn't
 *  overflow. */
function shortAmount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function WheelModal({ wheel, onClose, onSpinComplete }: Props) {
  const state = wheel.state;
  const slots = state?.slots ?? [];

  const [phase, setPhase] = useState<'idle' | 'spinning' | 'celebrating'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [spinResult, setSpinResult] = useState<SpinResult | null>(null);
  const [flights, setFlights] = useState<readonly RewardFlightSpec[]>([]);

  const discRef = useRef<HTMLDivElement | null>(null);
  const wheelCenterRef = useRef<HTMLDivElement | null>(null);
  const tickerRef = useRef<HTMLDivElement | null>(null);
  const currentRotRef = useRef(0);
  const nextFlightIdRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  /** Tilt the ticker briefly, then snap back. Called from the spin
   *  rAF loop each time a wedge boundary crosses under the pointer.
   *  Cancel any in-flight kick before starting a new one so rapid
   *  early-spin boundaries don't pile up overlapping animations.
   *  The −10° kick + +3° overshoot matches the GSAP reference's
   *  subtler swing (down from the v1 −22° we used earlier — that was
   *  too aggressive and read as the pointer bouncing rather than
   *  ticking). */
  const kickTicker = () => {
    const el = tickerRef.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: 'translateX(-50%) rotate(0deg)' },
        { transform: 'translateX(-50%) rotate(-10deg)', offset: 0.4 },
        { transform: 'translateX(-50%) rotate(3deg)', offset: 0.75 },
        { transform: 'translateX(-50%) rotate(0deg)' },
      ],
      { duration: 180, easing: 'ease-out', fill: 'forwards' }
    );
  };

  // Stop the rAF loop if the modal unmounts mid-spin. Without this
  // the loop would call setTransform on an unmounted element until
  // it completes, which is harmless but wasteful.
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const conicBg = useMemo(() => conicGradientFromSlots(slots), [slots]);

  /** Five full turns plus the slot-specific delta to bring the
   *  chosen slot's centre under the top pointer. Pulled into a
   *  helper so the math is easy to read and test. */
  const targetDelta = (slotIndex: number) =>
    5 * 360 + (360 - SLOT_ANGLE * slotIndex - SLOT_HALF);

  const spawnFlights = (currency: FlightCurrency, count: number) => {
    const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`);
    const src = wheelCenterRef.current;
    if (!target || !src) return;
    const srcRect = src.getBoundingClientRect();
    const dstRect = target.getBoundingClientRect();
    const startX = srcRect.left + srcRect.width / 2;
    const startY = srcRect.top + srcRect.height / 2;
    const endX = dstRect.left + dstRect.width / 2;
    const endY = dstRect.top + dstRect.height / 2;
    const additions: RewardFlightSpec[] = [];
    for (let i = 0; i < count; i++) {
      additions.push({
        id: nextFlightIdRef.current++,
        currency,
        startX: startX + (Math.random() - 0.5) * 30,
        startY: startY + (Math.random() - 0.5) * 30,
        endX,
        endY,
        delayMs: i * 70,
        durationMs: 850,
      });
    }
    setFlights((prev) => [...prev, ...additions]);
  };

  const removeFlight = (id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSpin = async () => {
    if (phase !== 'idle' || !state || !wheel.canSpin) return;
    setError(null);
    setPhase('spinning');

    const { data, error: rpcErr } = await supabase.rpc('spin_wheel', {
      p_config_id: state.config_id,
    });
    if (rpcErr) {
      setError(spinErrorMessage(rpcErr.message));
      setPhase('idle');
      return;
    }
    const result = data as unknown as SpinResult;
    setSpinResult(result);

    // Drive rotation manually via rAF so we can fire ticker kicks
    // each time a wedge boundary crosses under the top pointer.
    // Web Animations API would also work, but recovering the
    // current rotation from a computed transform matrix every frame
    // (to detect boundary crossings) is more code than the rAF
    // loop. Easing is Power4 ease-out: 1 − (1−t)⁴ — starts fast,
    // decelerates dramatically, which matches the GSAP reference.
    const disc = discRef.current;
    if (disc) {
      const startRot = currentRotRef.current;
      const endRot = startRot + targetDelta(result.slot_index);
      const startTime = performance.now();
      // Wedge index just BEFORE the start; new crossings have an
      // index strictly greater than this. Using Math.floor preserves
      // sign so we don't mis-fire when startRot is exactly on a
      // boundary.
      let lastBoundary = Math.floor(startRot / SLOT_ANGLE);

      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          const elapsed = now - startTime;
          const t = Math.min(1, elapsed / SPIN_DURATION_MS);
          const eased = 1 - Math.pow(1 - t, 4);
          const rot = startRot + (endRot - startRot) * eased;
          disc.style.transform = `rotate(${rot}deg)`;

          const currentBoundary = Math.floor(rot / SLOT_ANGLE);
          if (currentBoundary > lastBoundary) {
            kickTicker();
            lastBoundary = currentBoundary;
          }

          if (t < 1) {
            rafIdRef.current = requestAnimationFrame(tick);
          } else {
            currentRotRef.current = endRot;
            rafIdRef.current = null;
            resolve();
          }
        };
        rafIdRef.current = requestAnimationFrame(tick);
      });
    }

    setPhase('celebrating');

    // Tiny pause so the player visually registers the winning
    // wedge sitting under the pointer before tokens fly out.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220));

    // Spawn flying tokens for every credited reward. Count scales
    // loosely with the amount — bigger wins look more dramatic
    // without overwhelming the lobby's wallet pills.
    if (result.credited_coins > 0) {
      const count = Math.min(8, Math.max(3, Math.ceil(result.credited_coins / 75)));
      spawnFlights('coins', count);
    }
    if (result.credited_gems > 0) {
      const count = Math.min(6, Math.max(2, result.credited_gems));
      spawnFlights('gems', count);
    }
    if (result.credited_xp > 0) {
      const count = Math.min(5, Math.max(2, result.credited_xp));
      spawnFlights('xp', count);
    }

    // Hold open long enough for the slowest-stagger flight to
    // reach the wallet pill, then refresh + close.
    window.setTimeout(() => {
      onSpinComplete();
      onClose();
    }, POST_SPIN_HOLD_MS);
  };

  // ESC closes the modal — only when idle so a user can't bail
  // mid-spin and miss their credited reward animation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase === 'idle') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  if (!state) return null;

  const isReady = phase === 'idle' && wheel.canSpin;
  const wheelDimension = 'clamp(17rem, 65vmin, 24rem)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      {/* Carnival / fortune-wheel stack: title plate, pointer,
          gold-framed wheel with bulb lights, big SPIN CTA. No more
          cream modal box — the elements sit directly on the page
          overlay, matching the reference design. */}
      <div className="relative flex flex-col items-center">
        {/* Title plate + close button. Wrapped in a relative
            container so the close button can be positioned against
            the plate's edge (not the bonus-ui stack's edge, which
            previously placed the X on top of the right "✦"). */}
        <div className="relative z-10 flex items-center justify-center">
          {/* Red pill with thick gold border. Width clamped narrower
              than v1 so the X button sits outside its right edge
              instead of overlapping the title text. */}
          <div
            className="grid place-items-center font-display whitespace-nowrap"
            style={{
              width: 'clamp(17rem, 60vmin, 22rem)',
              height: 'clamp(3rem, 7.5vmin, 3.6rem)',
              borderRadius: '9999px',
              background: 'linear-gradient(180deg, #6d0808 0%, #3b0203 100%)',
              border: '4px solid #f6b52b',
              boxShadow:
                '0 0 0 2px #7b3408, inset 0 4px 6px rgba(255,255,255,0.22), inset 0 -6px 10px rgba(0,0,0,0.5), 0 8px 18px rgba(0,0,0,0.45)',
              color: '#ffd76b',
              // Smaller font + tighter letter-spacing so "✦ HOURLY
              // BONUS ✦" fits comfortably and the right ✦ stays
              // visible (the X used to obscure it).
              fontSize: 'clamp(1rem, 2.6vmin, 1.4rem)',
              fontWeight: 900,
              letterSpacing: '0.1em',
              textShadow: '0 3px 0 #7a3507, 0 0 10px rgba(255,210,80,0.7)',
            }}
          >
            ✦ HOURLY BONUS ✦
          </div>

          {/* Close orb — sits just outside the plate's right edge.
              Smaller than v1 (h-10 vs h-12) so it doesn't dominate
              the title row. */}
          <button
            type="button"
            onClick={onClose}
            disabled={phase !== 'idle'}
            aria-label="Close"
            className="absolute grid h-10 w-10 place-items-center rounded-full font-display text-xl font-black leading-none text-amber-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              top: '50%',
              right: '-1.25rem',
              transform: 'translateY(-50%)',
              background:
                'radial-gradient(circle at 35% 25%, #ffec8a, #f47b20 55%, #9a210d)',
              border: '3px solid #ffd35a',
              textShadow: '0 2px 0 #8b180b',
              boxShadow:
                '0 4px 0 #702207, 0 8px 14px rgba(0,0,0,0.45)',
            }}
          >
            ×
          </button>
        </div>

        {/* Pointer — red teardrop/drop shape that hangs into the top
            of the wheel. SVG-based so we can draw a true drop with
            curved shoulders and a sharp apex (the diamond clipPath
            we used in v1 read as a kite, not a pointer). Pivot
            anchored at the top so kickTicker swings the apex from
            side to side without translating it. The inner light
            "pin" is the same highlight the reference shows — sells
            the drop-of-paint look. */}
        <div
          ref={tickerRef}
          aria-hidden
          className="absolute z-10"
          style={{
            top: 'clamp(3.2rem, 8.5vmin, 4.2rem)',
            left: '50%',
            transform: 'translateX(-50%)',
            transformOrigin: '50% 0%',
            width: 'clamp(2.6rem, 6vmin, 3.4rem)',
            height: 'clamp(3.4rem, 8vmin, 4.6rem)',
            filter:
              'drop-shadow(0 6px 0 #4b0708) drop-shadow(0 8px 8px rgba(0,0,0,0.45))',
          }}
        >
          <svg
            viewBox="0 0 100 130"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <radialGradient id="wm-drop-fill" cx="0.5" cy="0.25" r="0.7">
                <stop offset="0%" stopColor="#ff7a7a" />
                <stop offset="55%" stopColor="#cf1a20" />
                <stop offset="100%" stopColor="#5b060a" />
              </radialGradient>
              <radialGradient id="wm-drop-pin" cx="0.5" cy="0.4" r="0.5">
                <stop offset="0%" stopColor="#ffe9c7" />
                <stop offset="100%" stopColor="#f1a78c" />
              </radialGradient>
            </defs>
            {/* Classic drop shape: rounded top, tapered apex at the
                bottom. Coordinates are tuned so the visual centre of
                gravity sits ~30% from the top, matching the GSAP
                reference's pointer. */}
            <path
              d="M50,128 C18,98 6,68 14,42 C22,18 38,4 50,4 C62,4 78,18 86,42 C94,68 82,98 50,128 Z"
              fill="url(#wm-drop-fill)"
              stroke="#3b0306"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {/* Inner pin — small bright oval that catches the eye and
                reads as a highlight on the drop. */}
            <ellipse cx="50" cy="38" rx="13" ry="11" fill="url(#wm-drop-pin)" />
          </svg>
        </div>

        {/* Wheel frame — thick gold ring around the spinning disc.
            Contains 16 evenly-spaced bulb lights and the disc itself
            inside its padded interior. */}
        <div
          className="relative mt-3"
          style={
            {
              // 1.13× wheel-d gives the gold ring room to breathe
              // around the spinning disc.
              width: `calc(${wheelDimension} * 1.13)`,
              height: `calc(${wheelDimension} * 1.13)`,
              padding: `calc(${wheelDimension} * 0.045)`,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 35% 25%, #fff4a1 0%, #f8bf31 28%, #c46d0e 60%, #5a2407 100%)',
              boxShadow:
                'inset 0 0 0 5px #ffe178, inset 0 0 0 11px #9b4509, 0 14px 22px rgba(0,0,0,0.55), 0 0 30px rgba(255,180,45,0.4)',
              ['--wheel-d' as never]: wheelDimension,
            } as React.CSSProperties
          }
        >
          {/* Inner ring decoration — thin gold band hugging the
              edge of the gold rim (matches the reference's
              :before ring). Sits above the bulbs so they read as
              embedded in the rim, not floating on top. */}
          <div
            aria-hidden
            className="absolute rounded-full"
            style={{
              inset: 'calc(var(--wheel-d) * 0.018)',
              border: 'calc(var(--wheel-d) * 0.022) solid rgba(255,229,108,0.9)',
              boxShadow: 'inset 0 0 0 3px #6b2b06',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />

          {/* Tick marks — 10 small rectangular gold pips around the
              rim, one per wedge boundary (i × 36° + 18°). Replaces
              the 16 round bulbs we used in v1 to match the GSAP
              reference's tick-mark rim. Each pip is a thin vertical
              rectangle rotated to point outward, with a brighter
              gold highlight on top of a dark amber base so it pops
              against the gold rim. The boundary placement (instead
              of slot centres) means the ticks line up with the
              wedge dividers when the wheel is at rest, reading as
              clear slot demarcations. */}
          <div
            aria-hidden
            className="absolute rounded-full"
            style={{
              inset: 'calc(var(--wheel-d) * 0.018)',
              zIndex: 4,
              pointerEvents: 'none',
            }}
          >
            {Array.from({ length: SLOT_COUNT }).map((_, i) => (
              <span
                key={`tick-${i}`}
                className="absolute"
                style={{
                  left: '50%',
                  top: '50%',
                  width: 'calc(var(--wheel-d) * 0.022)',
                  height: 'calc(var(--wheel-d) * 0.055)',
                  marginLeft: 'calc(var(--wheel-d) * -0.011)',
                  marginTop: 'calc(var(--wheel-d) * -0.0275)',
                  borderRadius: 'calc(var(--wheel-d) * 0.006)',
                  background:
                    'linear-gradient(180deg, #fff7c0 0%, #ffd24a 45%, #a94b08 100%)',
                  boxShadow:
                    '0 0 6px rgba(255, 220, 120, 0.8), inset 0 0 0 1px rgba(91, 35, 6, 0.6)',
                  transform: `rotate(${i * SLOT_ANGLE + SLOT_HALF}deg) translateY(calc(var(--wheel-d) * -0.535))`,
                  transformOrigin: 'center',
                }}
              />
            ))}
          </div>

          {/* Spinning disc — conic-gradient + per-slot content.
              Sits at relative w-full h-full so it fills the
              wheel-frame's content area (inside the gold ring's
              padding), not the entire padding-box that would also
              cover the bulb lights. */}
          <div
            ref={discRef}
            className="relative h-full w-full overflow-hidden rounded-full"
            style={{
              background: conicBg,
              transformOrigin: '50% 50%',
              willChange: 'transform',
              boxShadow:
                'inset 0 0 0 3px #5b2506, inset 0 0 35px rgba(0,0,0,0.32)',
            }}
          >
                  {/* Wedge dividers — radial lines from center to rim,
                   *  one per slot boundary. They sit ON TOP of the
                   *  conic gradient and rotate with the disc. */}
                  {Array.from({ length: SLOT_COUNT }).map((_, i) => (
                    <div
                      key={`divider-${i}`}
                      aria-hidden
                      className="absolute"
                      style={{
                        top: 0,
                        left: '50%',
                        marginLeft: '-1px',
                        width: '2px',
                        height: '50%',
                        background: 'rgba(0,0,0,0.35)',
                        transformOrigin: '50% 100%',
                        transform: `rotate(${i * SLOT_ANGLE + SLOT_HALF}deg)`,
                      }}
                    />
                  ))}

                  {/* Slot content pivots. Each pivot is a 0×0 anchor at
                   *  the disc centre rotated by `i × SLOT_ANGLE`. The
                   *  content stack hangs from a point near the rim and
                   *  reads radially inward: primary-icon → primary-
                   *  amount → (combo) secondary-icon → secondary-amount.
                   *  Stacking radially (not tangentially) keeps every
                   *  amount upright relative to its wedge, instead of
                   *  warping the label around the wheel circumference. */}
                  {slots.map((slot, i) => {
                    const isWinning =
                      phase === 'celebrating' && spinResult?.slot_index === i;
                    const hasSecondary = !!slot.secondary_reward;
                    // Combo slots squeeze two icon+amount pairs into the
                    // same wedge; shrink both icon and text so they fit
                    // without clipping at the divider lines.
                    const iconSize = hasSecondary
                      ? 'calc(var(--wheel-d) * 0.08)'
                      : 'calc(var(--wheel-d) * 0.11)';
                    const amountSize = hasSecondary
                      ? 'calc(var(--wheel-d) * 0.045)'
                      : 'calc(var(--wheel-d) * 0.06)';
                    return (
                      <div
                        key={`slot-${i}`}
                        className="absolute"
                        style={{
                          top: '50%',
                          left: '50%',
                          width: 0,
                          height: 0,
                          transform: `rotate(${i * SLOT_ANGLE}deg)`,
                        }}
                      >
                        <div
                          className="absolute flex flex-col items-center"
                          style={{
                            top: 'calc(var(--wheel-d) * -0.43)',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: 'calc(var(--wheel-d) * 0.22)',
                            gap: 'calc(var(--wheel-d) * 0.005)',
                            color: 'white',
                            fontFamily: 'system-ui, sans-serif',
                            fontWeight: 900,
                            lineHeight: 1,
                            textShadow:
                              '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 3px rgba(0,0,0,0.65)',
                            filter: isWinning
                              ? 'drop-shadow(0 0 10px #fef08a)'
                              : undefined,
                          }}
                        >
                          {/* Primary reward — icon then amount, stacked. */}
                          <div style={{ width: iconSize, height: iconSize }}>
                            <RewardIcon
                              type={slot.primary_reward.type}
                              iconUrl={slot.primary_reward.icon_url}
                            />
                          </div>
                          <div
                            style={{
                              fontSize: amountSize,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {shortAmount(slot.primary_reward.amount)}
                          </div>

                          {/* Secondary reward (combo slots) — same pattern,
                           *  one tier deeper toward the wheel centre. */}
                          {hasSecondary && slot.secondary_reward ? (
                            <>
                              <div
                                style={{
                                  width: iconSize,
                                  height: iconSize,
                                  marginTop: 'calc(var(--wheel-d) * 0.005)',
                                }}
                              >
                                <RewardIcon
                                  type={slot.secondary_reward.type}
                                  iconUrl={slot.secondary_reward.icon_url}
                                />
                              </div>
                              <div
                                style={{
                                  fontSize: amountSize,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {shortAmount(slot.secondary_reward.amount)}
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

          {/* Center hub — gold orb with a star symbol, sitting on
              top of the wheel. Fixed (does not rotate) so it
              doubles as the visual flight origin for RewardFlight. */}
          <div
            ref={wheelCenterRef}
            aria-hidden
            className="absolute grid place-items-center font-display"
            style={{
              top: '50%',
              left: '50%',
              width: 'calc(var(--wheel-d) * 0.26)',
              height: 'calc(var(--wheel-d) * 0.26)',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 35% 22%, #fff7a6, #ffc72e 35%, #c96c0c 70%, #5d2305)',
              border: 'calc(var(--wheel-d) * 0.018) solid #ffd158',
              boxShadow:
                '0 6px 0 #713006, 0 10px 18px rgba(0,0,0,0.55), inset 0 4px 8px rgba(255,255,255,0.6)',
              zIndex: 10,
              color: '#fff08a',
              fontSize: 'calc(var(--wheel-d) * 0.16)',
              lineHeight: 1,
              textShadow: '0 3px 0 #a24a08',
            }}
          >
            ★
          </div>
        </div>

        {/* SPIN CTA — large gold-gradient pill with thick gold
            border and a 3D drop-shadow that compresses on press.
            Tap-to-spin on the wheel itself is also supported (the
            disc has no pointer-events disabled), but the big button
            is the obvious target on mobile. */}
        <button
          type="button"
          disabled={!isReady}
          onClick={handleSpin}
          className="relative z-10 mt-2 font-display transition active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            width: 'clamp(11rem, 32vmin, 14rem)',
            height: 'clamp(3.6rem, 9vmin, 4.4rem)',
            borderRadius: '9999px',
            border: '6px solid #ffd866',
            background:
              'linear-gradient(180deg, #fff070 0%, #ffbd24 35%, #f2730d 72%, #b73808 100%)',
            color: 'white',
            fontSize: 'clamp(1.6rem, 4.4vmin, 2.4rem)',
            fontWeight: 900,
            letterSpacing: '0.1em',
            textShadow: '0 4px 0 #8e3308',
            boxShadow:
              '0 7px 0 #793006, 0 12px 18px rgba(0,0,0,0.5), inset 0 4px 6px rgba(255,255,255,0.55)',
          }}
        >
          {phase === 'idle' ? 'SPIN' : 'SPINNING…'}
        </button>

        {error ? (
          <div className="mt-3 rounded-md border border-rose-700/40 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-900">
            {error}
          </div>
        ) : null}
      </div>

      {/* Flying tokens render OUTSIDE the modal frame at z-[60] so they
          travel cleanly across the lobby to the wallet pills. */}
      {flights.map((spec) => (
        <RewardFlight key={spec.id} spec={spec} onLanded={removeFlight} />
      ))}
    </div>
  );
}

/** Map server-side spin errors to player-readable copy. */
function spinErrorMessage(code: string): string {
  if (code.includes('cooldown_not_elapsed')) {
    return 'Bonus not ready yet — check the cooldown.';
  }
  if (code.includes('wheel_disabled')) return 'The wheel is currently unavailable.';
  if (code.includes('wheel_misconfigured')) {
    return 'The wheel is being adjusted — try again soon.';
  }
  if (code.includes('not_authenticated')) return 'Sign in to spin the wheel.';
  return code;
}
