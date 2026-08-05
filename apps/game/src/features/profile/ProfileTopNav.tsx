import {Link} from "react-router-dom"

import {formatCompactNumber} from "../../lib/format"
import styles from "../../pages/Profile.module.css"
import {useAppSelector} from "../../store/hooks"
import {useShop} from "../appUi/useShop"
import {selectCurrentWallet} from "../auth/authSelectors"

/**
 * Profile-page CurrencyPill — same visual design as the lobby's top-bar
 * pill. It reuses the `.lobby-currency-*` class hooks but must supply
 * `--lobby-u` itself on `.profile-top-currency` (landscape uses the same
 * formula as `.lobby-shell`; portrait a fixed fallback) plus an explicit
 * pill height. Without `--lobby-u` the lobby's `calc(46 * var(--lobby-u))`
 * width override is invalid and the icon renders at its intrinsic webp
 * size (~512-1024px) — full-screen on the profile page.
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
    className={`lobby-currency-pill ${styles.profileCurrencyPill}`}
    data-fly-target={flyTarget}>
    <span className={`lobby-currency-icon ${styles.profileCurrencyIcon}`}>
      <img
        alt=""
        className={styles.profileCurrencyImg}
        draggable={false}
        src={icon}/>
    </span>
    <span className={`lobby-currency-value ${styles.profileCurrencyValue}`}>
      {formatCompactNumber(value)}
    </span>
    <button
      aria-label={`Get more ${label}`}
      className={`lobby-currency-add ${styles.profileCurrencyAdd}`}
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
