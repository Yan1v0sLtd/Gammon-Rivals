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
const SPIN_FAST_MS = 1200;
const SPIN_DECEL_MS = 2200;
const CELEBRATION_MS = 2400;

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
  const currentRotRef = useRef(0);
  const nextFlightIdRef = useRef(0);

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

    // Two-phase rotation in a single Web Animation: fast linear
    // ramp for SPIN_FAST_MS, then ease-out for SPIN_DECEL_MS,
    // landing the chosen slot centred under the top pointer.
    const disc = discRef.current;
    if (disc) {
      const start = currentRotRef.current;
      const fastDelta = 8 * 360;
      const fastEnd = start + fastDelta;
      const finalEnd = fastEnd + targetDelta(result.slot_index);
      const totalMs = SPIN_FAST_MS + SPIN_DECEL_MS;
      const splitOffset = SPIN_FAST_MS / totalMs;
      const anim = disc.animate(
        [
          { transform: `rotate(${start}deg)` },
          {
            transform: `rotate(${fastEnd}deg)`,
            offset: splitOffset,
            easing: 'cubic-bezier(0.4, 0.0, 1, 1)',
          },
          {
            transform: `rotate(${finalEnd}deg)`,
            easing: 'cubic-bezier(0.17, 0.67, 0.21, 1)',
          },
        ],
        { duration: totalMs, fill: 'forwards' }
      );
      try {
        await anim.finished;
      } catch {
        // ignored — modal may have unmounted mid-spin
      }
      currentRotRef.current = finalEnd;
    }

    setPhase('celebrating');

    // Spawn flying tokens toward the wallet pills. Stagger and
    // count scale loosely with the reward — bigger wins look more
    // dramatic without overwhelming the screen.
    if (result.credited_coins > 0) {
      const count = Math.min(8, Math.max(3, Math.ceil(result.credited_coins / 75)));
      spawnFlights('coins', count);
    }
    if (result.credited_gems > 0) {
      const count = Math.min(6, Math.max(2, result.credited_gems));
      spawnFlights('gems', count);
    }

    // Hold the celebration long enough to read the prize, then
    // hand back to the lobby for wallet/wheel refetch + close.
    window.setTimeout(() => {
      onSpinComplete();
      onClose();
    }, CELEBRATION_MS);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div className="relative w-full max-w-md origin-center scale-[0.9] rounded-3xl bg-gradient-to-b from-[#fde68a] via-[#d97706] to-[#78350f] p-[5px] shadow-[0_25px_60px_rgba(0,0,0,0.65)] lg:scale-100">
        <div className="rounded-[22px] bg-gradient-to-b from-[#fef3c7] via-[#fbbf24] to-[#92400e] p-[2px]">
          <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-b from-[#f7e9c8] to-[#e7d09a] px-5 pb-6 pt-5">
            {/* Top decorative lozenge — matches DailyBonus modal */}
            <div
              aria-hidden
              className="absolute -top-[12px] left-1/2 z-20 h-6 w-6 -translate-x-1/2 rotate-45 rounded-[3px] bg-gradient-to-br from-[#fef08a] via-[#f59e0b] to-[#7c2d12] shadow-[0_3px_8px_rgba(120,53,15,0.55),inset_0_1px_0_rgba(255,255,255,0.5)]"
            />

            {/* Title row + close button */}
            <div className="flex items-center justify-between gap-2">
              <span className="h-8 w-8" aria-hidden />
              <div className="flex flex-1 items-center justify-center gap-3">
                <span className="text-lg text-amber-500/80">◆</span>
                <h2 className="whitespace-nowrap bg-gradient-to-b from-[#fcd34d] via-[#d97706] to-[#7c2d12] bg-clip-text font-display text-3xl font-black uppercase tracking-[0.08em] text-transparent drop-shadow-[0_2px_0_rgba(255,255,255,0.6)] sm:text-4xl">
                  Hourly Bonus
                </h2>
                <span className="text-lg text-amber-500/80">◆</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={phase !== 'idle'}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full border border-amber-700/40 bg-amber-100/60 text-xl font-black leading-none text-amber-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </div>

            {/* Wheel stage */}
            <div className="relative mx-auto mt-4 flex flex-col items-center">
              <div
                className="relative"
                style={
                  {
                    width: wheelDimension,
                    height: wheelDimension,
                    ['--wheel-d' as never]: wheelDimension,
                  } as React.CSSProperties
                }
              >
                {/* Top pointer — points DOWN into the wheel */}
                <div
                  aria-hidden
                  className="absolute z-20"
                  style={{
                    top: '-6%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: 'calc(var(--wheel-d) * 0.05) solid transparent',
                    borderRight: 'calc(var(--wheel-d) * 0.05) solid transparent',
                    borderTop: 'calc(var(--wheel-d) * 0.1) solid #b91c1c',
                    filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.55))',
                  }}
                />

                {/* Decorative rim. The spinning disc sits inside this
                 *  ring; the rim itself does NOT rotate. */}
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    boxShadow:
                      '0 0 0 5px #5a3413, 0 0 0 9px #fcd34d, 0 0 0 12px #5a3413, 0 14px 32px rgba(0,0,0,0.55)',
                  }}
                />

                {/* Spinning disc — conic-gradient + per-slot content */}
                <div
                  ref={discRef}
                  className="absolute inset-0 overflow-hidden rounded-full"
                  style={{
                    background: conicBg,
                    transformOrigin: '50% 50%',
                    willChange: 'transform',
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
                   *  content inside is positioned at a fixed pixel
                   *  offset (computed off --wheel-d) above the pivot,
                   *  which puts it on the wedge halfway between centre
                   *  and rim. The whole pivot rotates with the disc so
                   *  icons + label naturally follow the spin. */}
                  {slots.map((slot, i) => {
                    const isWinning =
                      phase === 'celebrating' && spinResult?.slot_index === i;
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
                          className="absolute flex flex-col items-center justify-start"
                          style={{
                            top: 'calc(var(--wheel-d) * -0.38)',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: 'calc(var(--wheel-d) * 0.22)',
                            color: 'white',
                            fontFamily: 'system-ui, sans-serif',
                            fontWeight: 900,
                            fontSize: 'calc(var(--wheel-d) * 0.045)',
                            lineHeight: 1.05,
                            textShadow:
                              '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 3px rgba(0,0,0,0.6)',
                            filter: isWinning
                              ? 'drop-shadow(0 0 8px #fef08a)'
                              : undefined,
                          }}
                        >
                          {/* Icon row — primary, optionally + secondary
                           *  side by side. */}
                          <div
                            className="flex items-center justify-center gap-1"
                            style={{
                              width: '100%',
                              height: 'calc(var(--wheel-d) * 0.13)',
                            }}
                          >
                            <div
                              style={{
                                width: slot.secondary_reward
                                  ? 'calc(var(--wheel-d) * 0.085)'
                                  : 'calc(var(--wheel-d) * 0.115)',
                                height: slot.secondary_reward
                                  ? 'calc(var(--wheel-d) * 0.085)'
                                  : 'calc(var(--wheel-d) * 0.115)',
                              }}
                            >
                              <RewardIcon
                                type={slot.primary_reward.type}
                                iconUrl={slot.primary_reward.icon_url}
                              />
                            </div>
                            {slot.secondary_reward ? (
                              <div
                                style={{
                                  width: 'calc(var(--wheel-d) * 0.075)',
                                  height: 'calc(var(--wheel-d) * 0.075)',
                                }}
                              >
                                <RewardIcon
                                  type={slot.secondary_reward.type}
                                  iconUrl={slot.secondary_reward.icon_url}
                                />
                              </div>
                            ) : null}
                          </div>
                          <div
                            className="mt-0.5 text-center"
                            style={{ whiteSpace: 'nowrap' }}
                          >
                            {slot.label ??
                              `${shortAmount(slot.primary_reward.amount)}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Center hub — fixed, does not rotate. Doubles as the
                 *  visual flight origin for RewardFlight. */}
                <div
                  ref={wheelCenterRef}
                  aria-hidden
                  className="absolute"
                  style={{
                    top: '50%',
                    left: '50%',
                    width: 'calc(var(--wheel-d) * 0.18)',
                    height: 'calc(var(--wheel-d) * 0.18)',
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle at 35% 35%, #fde68a, #d97706 70%, #7c2d12 100%)',
                    boxShadow:
                      'inset 0 2px 4px rgba(255,255,255,0.55), 0 0 0 3px #5a3413, 0 6px 12px rgba(0,0,0,0.6)',
                    zIndex: 10,
                  }}
                />

                {/* Celebration prize banner — overlays the wheel centre
                 *  during the celebration phase. Pulses for emphasis. */}
                {phase === 'celebrating' && spinResult ? (
                  <div
                    className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
                  >
                    <div className="animate-pulse rounded-xl border-4 border-amber-200 bg-gradient-to-b from-[#fcd34d] to-[#b45309] px-4 py-2 text-center font-display font-black uppercase tracking-[0.1em] text-white shadow-[0_8px_28px_rgba(0,0,0,0.7)]">
                      <div className="text-lg sm:text-2xl">
                        {spinResult.label ?? 'You win!'}
                      </div>
                      <div className="mt-1 text-xs sm:text-sm font-bold">
                        {[
                          spinResult.credited_coins > 0
                            ? `+${spinResult.credited_coins} coins`
                            : null,
                          spinResult.credited_gems > 0
                            ? `+${spinResult.credited_gems} gems`
                            : null,
                          spinResult.credited_xp > 0
                            ? `+${spinResult.credited_xp} XP`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* SPIN CTA. Tap-to-spin on the wheel itself is also
               *  supported (the disc has no pointer-events disabled),
               *  but a clear button gives mobile players a big target. */}
              <button
                type="button"
                disabled={!isReady}
                onClick={handleSpin}
                className="mt-5 rounded-full border-2 border-amber-900/50 bg-gradient-to-b from-[#fbbf24] to-[#ea580c] px-10 py-2.5 font-display text-2xl font-black uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(0,0,0,0.45)] transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'spinning'
                  ? 'Spinning…'
                  : phase === 'celebrating'
                    ? 'Nice!'
                    : 'Spin'}
              </button>

              {error ? (
                <div className="mt-2 rounded-md border border-rose-700/40 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-900">
                  {error}
                </div>
              ) : null}
            </div>
          </div>
        </div>
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
