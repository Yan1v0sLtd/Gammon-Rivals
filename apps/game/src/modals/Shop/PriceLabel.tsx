import styles from "./PriceLabel.module.css"
import {ShopIcon} from "./ShopIcon"

export function PriceLabel({
  priceUsd,
  priceGems,
}: {priceUsd: number | null, priceGems: number | null}) {
  if (priceGems !== null) {
    return (<span className={styles.priceRow}>
      <ShopIcon
        className={styles.gemIcon}
        kind="gems"/>
      <span className={styles.priceValue}>{priceGems.toLocaleString()}</span>
    </span>)
  }
  return <span className={styles.priceValue}>${(priceUsd ?? 0).toFixed(2)}</span>
}
