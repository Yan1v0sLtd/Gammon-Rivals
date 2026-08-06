import type {CSSProperties} from "react"

import {CurrencyPill} from "../../components/CurrencyPill"
import type {UserWallet} from "../../features/playerData/playerData"
import type {ShopStoreConfig} from "../../features/shop/shopData"

export function ShopHeader({
  storeConfig,
  wallet,
  onClose,
}: {
  storeConfig: ShopStoreConfig, wallet: UserWallet | null, onClose: () => void,
}) {
  return (<header
    className="relative z-[3] grid grid-cols-[1fr_auto_1fr] items-center gap-4 overflow-hidden border-b border-[#ffc93d]/25 bg-gradient-to-b from-[#0c1c37]/40 to-[#050d1c]/10 px-10 py-5">
    {storeConfig.bgImageUrl ? (
      <img
        alt={""}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
        src={storeConfig.bgImageUrl}
        style={{
          filter: "blur(2px)",
          transform: "scale(1.06)",
        }}
        onError={(e) => {
          e.currentTarget.style.display = "none"
        }}/>
    ) : null}
    <span aria-hidden="true"/>
    <h1
      className="text-center font-display text-[2.9rem] font-black uppercase tracking-[0.18em] text-[#ffc93d] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
      {storeConfig.title || "Store"}
    </h1>
    <div className="flex items-center justify-end gap-4">
      {/* Same balance element as the lobby, with the real wallet. The
            lobby pill sizes itself off `--lobby-u` (defined on
            .lobby-shell); outside the lobby we scope a fixed unit + a
            definite height so it renders at the right size — the same
            trick the profile page (.profile-top-currency) uses. No "+"
            here — you're already in the shop. */}
      <div
        className="flex items-center gap-3"
        style={{
          "--lobby-u": "1.02px",
          height: "3.7rem",
        } as CSSProperties}>
        <CurrencyPill
          flyTarget="coins"
          icon="/lobby/icons/gold-coin.webp"
          label="Coins"
          showAdd={false}
          value={wallet?.coins}/>
        <CurrencyPill
          flyTarget="gems"
          icon="/lobby/icons/gem.webp"
          label="Gems"
          showAdd={false}
          value={wallet?.gems}/>
      </div>
      {/* App-standard close: golden frame, black fill (matches the
            board / other modals). */}
      <button
        aria-label="Close store"
        className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] via-[#161210] to-[#0c0908] text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.45)] transition hover:brightness-110 active:scale-95"
        type="button"
        onClick={onClose}>
        {/* SVG cross — the × glyph sits visually high; this is centered. */}
        <svg
          aria-hidden="true"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.6"
          viewBox="0 0 24 24">
          <path d="M7 7l10 10M17 7L7 17"/>
        </svg>
      </button>
    </div>
  </header>)
}
