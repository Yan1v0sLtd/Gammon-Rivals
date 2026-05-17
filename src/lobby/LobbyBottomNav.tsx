import { lobbyNavItems } from './lobbyData';

/**
 * Wood-bar navigator at the bottom of the lobby. The bar itself is a
 * single .webp (`/lobby/nav/nav-bg.webp`) with painted gold dividers
 * already in place. Each of the four side slots renders its own
 * pre-rendered icon+label .webp; the middle slot is intentionally
 * empty for now.
 */
export function LobbyBottomNav() {
  return (
    <nav aria-label="Lobby sections" className="lobby-bottom-nav-shell">
      <div className="lobby-bottom-nav-bar" aria-hidden="true" />
      <div className="lobby-bottom-nav-row">
        {lobbyNavItems.map((item) =>
          item.image ? (
            <button
              key={item.id}
              type="button"
              className="lobby-bottom-nav-slot"
              aria-label={item.label}
            >
              <img src={item.image} alt="" draggable={false} />
              {item.badge ? <span className="lobby-nav-badge">{item.badge}</span> : null}
            </button>
          ) : (
            <span key={item.id} className="lobby-bottom-nav-slot is-placeholder" aria-hidden="true" />
          )
        )}
      </div>
    </nav>
  );
}
