import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

/**
 * Formats milliseconds-remaining into the most useful coarse unit.
 *
 *   >= 1 day        → "6d 23h"
 *   >= 1 hour       → "5h 12m"
 *   >= 1 minute     → "12m 03s"
 *   < 1 minute      → "00:42"
 *
 * The seconds-only branch is only used in the last minute — by then
 * the buff is essentially expired, but the precise countdown keeps
 * the badge feeling alive (and obvious it's about to disappear).
 */
function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours.toString().padStart(2, '0')}h`;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  return `00:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Adaptive tick interval. When the boost has hours/days left we don't
 * need a 1Hz tick — that would be a re-render every second across the
 * lobby for no visible change. Tighten the cadence as we approach
 * expiry so the final-minute readout still counts down second-by-second.
 */
function pickInterval(ms: number): number {
  if (ms > 60 * 60 * 1000) return 30_000; // > 1h → every 30s is fine ("5h 12m" doesn't change)
  if (ms > 60 * 1000) return 1_000;       // > 1m → 1Hz so minutes tick
  return 250;                              // < 1m → smoother final countdown
}

export function XpBoostBadge() {
  const { activeXpBoost, refreshXpBoost } = useAuth();
  const expiresAtMs = activeXpBoost ? new Date(activeXpBoost.expiresAt).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());

  // Adaptive tick — adjusts interval as the deadline approaches, and
  // refreshes the boost data once it expires (which sets the next
  // expiresAtMs to 0 → the badge disappears via the early return below).
  useEffect(() => {
    if (!activeXpBoost) return;
    const remaining = expiresAtMs - Date.now();
    if (remaining <= 0) {
      // Already expired — clear it from auth context. Server-side, the
      // multiplier is already gone (current_xp_multiplier filters by
      // expires_at > now()), so this is purely a UI refresh.
      void refreshXpBoost();
      return;
    }
    const interval = pickInterval(remaining);
    const handle = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(handle);
  }, [activeXpBoost, expiresAtMs, refreshXpBoost]);

  if (!activeXpBoost) return null;
  const remaining = expiresAtMs - now;
  if (remaining <= 0) return null;

  return (
    <span
      title={`Active XP boost expires ${new Date(activeXpBoost.expiresAt).toLocaleString()}`}
      className="inline-flex items-center gap-1 rounded-full border border-violet-400/60 bg-gradient-to-b from-[#7c3aed]/85 to-[#4c1d95]/95 px-2 py-0.5 text-[0.62rem] font-black uppercase tracking-wider text-amber-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_4px_rgba(0,0,0,0.45)]"
    >
      <span className="text-amber-300">×{activeXpBoost.multiplier}</span>
      <span className="text-white/80">XP</span>
      <span aria-hidden="true" className="text-amber-300/70">·</span>
      <span className="tabular-nums text-white/90">{formatRemaining(remaining)}</span>
    </span>
  );
}
