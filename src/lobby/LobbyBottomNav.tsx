import { lobbyNavItems } from './lobbyData';

export function LobbyBottomNav() {
  return (
    <nav
      aria-label="Lobby sections"
      className="lobby-bottom-nav-shell mx-auto mt-1 grid h-[5.9rem] w-full max-w-[76rem] grid-cols-6 px-[6.8%] pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-[0.85rem]"
    >
      {lobbyNavItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className="lobby-bottom-nav-item relative flex min-h-14 flex-col items-center justify-center gap-1 text-[#ffdb86] transition hover:brightness-125 active:translate-y-0.5"
        >
          <span className="relative grid h-8 w-8 place-items-center rounded-md border border-[#e8ba55]/40 bg-gradient-to-b from-[#2a2c35] to-[#111827] text-lg font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
            {item.symbol}
          </span>
          <span className="text-[0.68rem] font-black uppercase tracking-wide text-white/88">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
