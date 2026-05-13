import { lobbyNavItems } from './lobbyData';

export function LobbyBottomNav() {
  return (
    <nav
      aria-label="Lobby sections"
      className="lobby-bottom-nav-shell mx-auto mt-2 grid h-[7.1rem] w-full max-w-[88rem] grid-cols-5 px-[5.2%] pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-[0.8rem]"
    >
      {lobbyNavItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`lobby-bottom-nav-item relative flex min-h-16 flex-col items-center justify-center gap-1 text-[#ffdb86] transition hover:brightness-125 active:translate-y-0.5 ${
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
