import {HeroArt} from "./HeroArt"
import styles from "./PackCard.module.css"
import {PriceLabel} from "./PriceLabel"
import {formatAmount, type Pack} from "./shopCatalog"

// Small gold pill under a pack's icon advertising the running sale.
function SaleBadge({bonusPercent}: {bonusPercent: number}) {
  return (<div className={styles.saleBadge}>
    +{bonusPercent}% Extra
  </div>)
}

export function PackCard({
  pack,
  isBusy,
  bonusPercent,
  onBuy,
}: {
  pack: Pack, isBusy: boolean, bonusPercent: number, onBuy: () => void,
}) {
  // baseAmount is the numeric headline-currency grant (null for non-currency
  // packs). A running sale boosts it the same way the server boosts the grant.
  const base = pack.baseAmount
  const onSale = bonusPercent > 0 && base !== null
  const boosted = base !== null ? Math.round(base * (1 + bonusPercent / 100)) : null
  return (<div className={styles.packCard}>
    {/* Title bar — optional. Hidden when no header text is configured; the
          card is a fixed-height flex column, so the body just fills the freed
          space and the grid stays aligned. Colours are BO-overridable (unset →
          the default gold plate + cream text). */}
    {pack.headerText ? (<div
      className={`${styles.headerBar} ${pack.headerBg ? "" : styles.headerBarGold}`}
      style={{
        ...(pack.headerBg ? {background: pack.headerBg} : {}), ...(pack.headerFg ? {color: pack.headerFg} : {}),
      }}>
      {pack.headerText}
    </div>) : null}
    <div className={styles.body}>
      {/* Icon −20% to free room for the (bigger) amount + price below. */}
      <div
        className={styles.iconArea}
        data-fly-source={pack.id}>
        <HeroArt
          className={styles.heroArt}
          imageUrl={pack.imageUrl}
          kind={pack.headlineKind}/>
      </div>
      {onSale ? <SaleBadge bonusPercent={bonusPercent}/> : null}
      {base !== null || pack.headlineSubLabel ? (<div className={styles.amounts}>
        {base !== null ? (onSale ? (<>
          <div
            className={styles.struckAmount}>{formatAmount(base)}</div>
          <div
            className={styles.boostedAmount}>{formatAmount(boosted!)}</div>
        </>) : (<div
          className={styles.plainAmount}>{formatAmount(base)}</div>)) : null}
        {pack.headlineSubLabel
          ? <div className={styles.sublabel}>{pack.headlineSubLabel}</div> : null}
      </div>) : null}
      <button
        className={styles.buyButton}
        disabled={isBusy}
        type="button"
        onClick={onBuy}>
        <PriceLabel
          priceGems={pack.priceGems}
          priceUsd={pack.priceUsd}/>
      </button>
    </div>
  </div>)
}
