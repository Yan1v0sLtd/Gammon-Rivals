import { HourlyBonusWidget } from './HourlyBonusWidget';
import { lobbyNavItems } from './lobbyData';
import type { WheelStateResult } from './useWheelState';

interface Props {
  readonly wheel: WheelStateResult;
  readonly onClaimWheel: () => void;
  readonly onOpenMissions?: () => void;
  /** Badge count for the Missions slot (claimable + unclaimed). */
  readonly missionsBadge?: number;
}

/**
 * Wood-bar navigator at the bottom of the lobby. The bar itself is a
 * single .webp (`/lobby/nav/nav-bg.webp`) with painted gold dividers
 * already in place. Each of the four side slots renders its own
 * pre-rendered icon+label .webp; the middle slot now hosts the
 * hourly-bonus wheel widget.
 */
export function LobbyBottomNav({ wheel, onClaimWheel, onOpenMissions, missionsBadge }: Props) {
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
          const isMissions = item.id === 'missions';
          const onClick = isMissions ? onOpenMissions : undefined;
          const badge = isMissions && missionsBadge && missionsBadge > 0
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
