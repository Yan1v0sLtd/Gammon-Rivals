import { useEffect, useState } from 'react';
import { HourlyBonusWidget } from './HourlyBonusWidget';
import { lobbyNavItems } from './lobbyData';
import type { LobbyFeatureConfigMap } from '../lib/lobbyData';
import type { WheelStateResult } from './useWheelState';

interface Props {
  readonly wheel: WheelStateResult;
  readonly onClaimWheel: () => void;
  readonly onOpenMissions?: () => void;
  /** Badge count for the Missions slot (claimable + unclaimed). */
  readonly missionsBadge?: number;
  /** Per-feature unlock levels (by feature_key). Empty = nothing gated. */
  readonly featureConfigs: LobbyFeatureConfigMap;
  /** Current player level, compared against each feature's unlock level. */
  readonly playerLevel: number;
}

/**
 * Wood-bar navigator at the bottom of the lobby. Four side slots render their
 * pre-rendered icon+label .webp; the middle slot hosts the hourly-bonus wheel
 * (never level-gated — it's a core free reward).
 *
 * A level-locked feature dims its icon and overlays a bare gold padlock (no
 * circular badge). Tapping the lock wiggles it and pops a gold-rimmed tooltip
 * ABOVE it ("Reach level N to unlock") with a downward pointer and a jelly
 * stretch. The tooltip TEXT matches the board carousel pill's font. The open
 * lock is parent-controlled and collapses on an outside tap.
 */
export function LobbyBottomNav({
  wheel,
  onClaimWheel,
  onOpenMissions,
  missionsBadge,
  featureConfigs,
  playerLevel,
}: Props) {
  // Which locked slot's pill is expanded (feature_key), or null.
  const [openLockKey, setOpenLockKey] = useState<string | null>(null);

  // Collapse the expanded pill as soon as the player taps anywhere else. The
  // listener is armed on the next tick so the tap that opened it doesn't
  // immediately close it. (UnlockPill stops propagation on its own taps, so
  // tapping the lock itself never reaches this.)
  useEffect(() => {
    if (!openLockKey) return;
    const close = () => setOpenLockKey(null);
    const armId = window.setTimeout(() => {
      window.addEventListener('pointerdown', close);
    }, 0);
    return () => {
      window.clearTimeout(armId);
      window.removeEventListener('pointerdown', close);
    };
  }, [openLockKey]);

  return (
    <nav aria-label="Lobby sections" className="lobby-bottom-nav-shell">
      <div className="lobby-bottom-nav-bar" aria-hidden="true" />
      <div className="lobby-bottom-nav-row">
        {lobbyNavItems.map((item) => {
          if (item.id === 'placeholder') {
            return (
              <div
                key={item.id}
                className="lobby-bottom-nav-slot lobby-bottom-nav-slot--hourly"
              >
                <HourlyBonusWidget result={wheel} onClaim={onClaimWheel} />
              </div>
            );
          }
          const cfg = featureConfigs[item.id];
          const locked = cfg ? playerLevel < cfg.unlockLevel : false;

          // Locked slot: NOT a <button> (the padlock itself is the interactive
          // button — a button-in-button would be invalid). Dimmed icon + the
          // bare padlock + its pop-above tooltip.
          if (locked && item.image) {
            return (
              <div key={item.id} className="lobby-bottom-nav-slot is-locked">
                <img src={item.image} alt="" draggable={false} />
                <NavFeatureLock
                  level={cfg!.unlockLevel}
                  label={item.label}
                  text={cfg!.tooltipText}
                  gradientId={`navlock-${item.id}`}
                  open={openLockKey === item.id}
                  onToggle={() =>
                    setOpenLockKey((k) => (k === item.id ? null : item.id))
                  }
                />
              </div>
            );
          }

          const isMissions = item.id === 'missions';
          const onClick = isMissions ? onOpenMissions : undefined;
          const badge =
            isMissions && missionsBadge && missionsBadge > 0
              ? String(missionsBadge)
              : item.badge;
          return item.image ? (
            <button
              key={item.id}
              type="button"
              className="lobby-bottom-nav-slot"
              aria-label={item.label}
              onClick={onClick}
            >
              <img src={item.image} alt="" draggable={false} />
              {badge ? <span className="lobby-nav-badge">{badge}</span> : null}
            </button>
          ) : (
            <span key={item.id} className="lobby-bottom-nav-slot is-placeholder" aria-hidden="true" />
          );
        })}
      </div>
    </nav>
  );
}

interface NavFeatureLockProps {
  readonly level: number;
  readonly label: string;
  /** Operator override; blank/null falls back to "Reach level N to unlock". */
  readonly text: string | null;
  /** Unique <linearGradient> id so multiple locks don't collide. */
  readonly gradientId: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}

/**
 * Bare gold padlock overlaid on a locked feature slot (no circular badge).
 * Tapping wiggles the lock and pops a gold-rimmed tooltip above it; tapping
 * again (or anywhere outside) collapses it. The pill auto-sizes to its text,
 * which the operator can override per feature (e.g. "Coming soon") — otherwise
 * it shows "Reach level N to unlock". The font matches the board carousel
 * pill. All of the motion is CSS — see the .lobby-nav-lock-* rules in index.css.
 */
function NavFeatureLock({ level, label, text, gradientId, open, onToggle }: NavFeatureLockProps) {
  const tipText = text && text.trim() ? text.trim() : `Reach level ${level} to unlock`;
  return (
    <div className={`lobby-nav-lock-wrap ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="lobby-nav-lock"
        aria-label={open ? tipText : `${label} locked`}
        // Stop the tap that opens/toggles the lock from reaching the
        // window-level outside-tap listener that closes it.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <svg className="lobby-nav-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff2a2" />
              <stop offset="45%" stopColor="#f3c14c" />
              <stop offset="100%" stopColor="#b97918" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#${gradientId})`}
            d="M12 1.5a5 5 0 0 0-5 5V10H6.5A2.5 2.5 0 0 0 4 12.5v8A2.5 2.5 0 0 0 6.5 23h11a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 17.5 10H17V6.5a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3V10H9V6.5a3 3 0 0 1 3-3zm0 11a2 2 0 0 1 .8 3.83V20.5a.8.8 0 0 1-1.6 0v-2.17A2 2 0 0 1 12 14.5z"
          />
        </svg>
      </button>
      <div className="lobby-nav-lock-tip" aria-hidden={!open}>
        <span>{tipText}</span>
      </div>
    </div>
  );
}
