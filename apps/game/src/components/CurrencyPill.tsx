import {RollingNumber} from "../lobby/RollingNumber"

import styles from "./CurrencyPill.module.css"

/**
 * The premium coins/gems balance pill used in the lobby top bar — extracted
 * here so other surfaces (the Shop header) render the *same* element with the
 * player's real balance, not a lookalike. `data-fly-target` is preserved so
 * reward-flight animations keep aiming at it. Sizing/markup are unchanged from
 * the original lobby pill; callers control behaviour via `onAdd`.
 */
type CurrencyPillProps = {
  readonly flyTarget: "coins" | "gems",
  readonly label: string,
  readonly value: number | null | undefined,
  readonly icon: string,
} & (
  /* The green "+" that opens the shop is shown by default (lobby behaviour)
     and needs a handler; hiding it (e.g. inside the shop itself) makes the
     handler meaningless, so the union keeps the two in sync at compile time
     instead of leaving a dead/throwing callback behind. */
  {readonly showAdd?: true, readonly onAdd: () => void} | {readonly showAdd: false, readonly onAdd?: never}
)

export function CurrencyPill({
  flyTarget,
  label,
  value,
  icon,
  onAdd,
  showAdd = true,
}: CurrencyPillProps) {
  return (<div
    aria-label={`${label}: ${value ?? 0}`}
    className={styles.currencyPill}
    data-fly-target={flyTarget}
    // With the add button hidden, drop the trailing grid column (the pill is
    // a 3-col grid in the module) so there's no empty gap on the right.
    style={showAdd ? undefined : {gridTemplateColumns: "calc(48 * var(--lobby-u)) minmax(0, 1fr)"}}>
    <span className={styles.currencyIcon}>
      <img
        alt=""
        className={styles.currencyIconImg}
        draggable={false}
        src={icon}/>
    </span>
    <span className={styles.currencyValue}>
      <RollingNumber value={value}/>
    </span>
    {showAdd ? (<button
      aria-label={`Get more ${label}`}
      className={styles.currencyAdd}
      type="button"
      onClick={onAdd}>
      <span className={styles.currencyAddBarV}/>
      <span className={styles.currencyAddBarH}/>
    </button>) : null}
  </div>)
}
