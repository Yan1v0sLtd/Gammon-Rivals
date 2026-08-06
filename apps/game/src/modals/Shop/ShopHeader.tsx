import {CurrencyPill} from "../../components/CurrencyPill"
import type {UserWallet} from "../../features/playerData/playerData"
import type {ShopStoreConfig} from "../../features/shop/shopData"

import styles from "./ShopHeader.module.css"

export function ShopHeader({
  storeConfig,
  wallet,
  onClose,
}: {
  storeConfig: ShopStoreConfig, wallet: UserWallet | null, onClose: () => void,
}) {
  return (<header className={styles.header}>
    {storeConfig.bgImageUrl ? (
      <img
        alt={""}
        aria-hidden="true"
        className={styles.bgImage}
        src={storeConfig.bgImageUrl}
        onError={(e) => {
          e.currentTarget.style.display = "none"
        }}/>
    ) : null}
    <span aria-hidden="true"/>
    <h1 className={styles.title}>
      {storeConfig.title || "Store"}
    </h1>
    <div className={styles.headerRight}>
      {/* Same balance element as the lobby, with the real wallet. The lobby pill
            sizes itself off `--lobby-u` (defined on .lobby-shell); outside the
            lobby we scope a fixed unit + a definite height so it renders at the
            right size — the same trick the profile page (.profile-top-currency)
            uses. No "+" here — you're already in the shop. */}
      <div className={styles.currencyCluster}>
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
        className={styles.closeButton}
        type="button"
        onClick={onClose}>
        {/* SVG cross — the × glyph sits visually high; this is centered. */}
        <svg
          aria-hidden="true"
          className={styles.closeIcon}
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
