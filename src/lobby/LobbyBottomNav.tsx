import { lobbyNavItems } from './lobbyData';

export function LobbyBottomNav() {
  return (
    <nav
      aria-label="Lobby sections"
      className="lobby-bottom-nav-shell mx-auto mt-2 grid grid-cols-5"
    >
      <span className="lobby-bottom-nav-frame" aria-hidden="true" />
      {lobbyNavItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`lobby-bottom-nav-item ${
            item.featured ? 'is-featured' : ''
          }`}
        >
          <span className={`lobby-nav-icon lobby-nav-icon--${item.icon}`} aria-hidden="true">
            <span className="lobby-nav-icon-mark" />
          </span>
          <span className="lobby-nav-label">{item.label}</span>
          {item.badge ? <span className="lobby-nav-badge">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}
