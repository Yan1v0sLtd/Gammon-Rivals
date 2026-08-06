import {Link} from "react-router-dom"

import {formatCompactNumber} from "../../lib/format"
import {useAppSelector} from "../../store/hooks"
import {useShop} from "../appUi/useShop"
import {selectCurrentWallet} from "../auth/authSelectors"

import styles from "./ProfileTopNav.module.css"

/**
 * Profile-page CurrencyPill — same visual design as the lobby's top-bar
 * pill. The `profileCurrency*` module classes carry the full look; the
 * --lobby-u-scaled padding/height are baked into `profileCurrencyPill`
 * directly (no shared global hooks). `--lobby-u` is supplied by the
 * `.profileTopCurrency` wrapper (landscape uses the same formula as
 * `.lobbyShell`; portrait a fixed fallback). Without `--lobby-u` the
 * `calc(… * var(--lobby-u))` overrides are invalid and the icon renders
 * at its intrinsic webp size (~512-1024px) — full-screen on the profile
 * page.
 */
function CurrencyPill({
  flyTarget,
  icon,
  label,
  value,
  onAdd,
}: {
  readonly flyTarget: "coins" | "gems" | "xp",
  readonly icon: string,
  readonly label: string,
  readonly value: number,
  readonly onAdd: () => void,
}) {
  return (<div
    aria-label={`${label}: ${value ?? 0}`}
    className={styles.profileCurrencyPill}
    data-fly-target={flyTarget}>
    <span className={styles.profileCurrencyIcon}>
      <img
        alt=""
        className={styles.profileCurrencyImg}
        draggable={false}
        src={icon}/>
    </span>
    <span className={styles.profileCurrencyValue}>
      {formatCompactNumber(value)}
    </span>
    <button
      aria-label={`Get more ${label}`}
      className={styles.profileCurrencyAdd}
      type="button"
      onClick={onAdd}>
      <span className={`${styles.profileCurrencyPlus} ${styles.profileCurrencyPlusH}`}/>
      <span className={styles.profileCurrencyPlus}/>
    </button>
  </div>)
}

export function ProfileTopNav() {
  const wallet = useAppSelector(selectCurrentWallet)
  const {openShop} = useShop()

  return (<header className={styles.profileTopNav}>
    <Link
      aria-label="Back to lobby"
      className={styles.profileIconButton}
      to="/play">
      <span className={styles.profileBackChevron}/>
    </Link>

    {/* Wallet pills centered in the top nav. Same pill design as the
        * lobby top-bar, but the size-modifier class shrinks them ~20 %
        * so the centered cluster doesn't crowd the back button. */}
    <div
      aria-label="Wallet"
      className={styles.profileTopCurrency}>
      <CurrencyPill
        flyTarget="coins"
        icon="/lobby/icons/gold-coin.webp"
        label="Coins"
        value={wallet?.coins ?? 0}
        onAdd={openShop}/>
      <CurrencyPill
        flyTarget="gems"
        icon="/lobby/icons/gem.webp"
        label="Gems"
        value={wallet?.gems ?? 0}
        onAdd={openShop}/>
    </div>
  </header>)
}
