import styles from "./BundleCard.module.css"
import {HeroArt} from "./HeroArt"
import {PriceLabel} from "./PriceLabel"
import {formatAmount, type Bundle, type RewardKind} from "./shopCatalog"
import {type ShopIconKind, ShopIcon} from "./ShopIcon"

const REWARD_TO_ICON: Record<RewardKind, ShopIconKind> = {
  coins: "coins",
  gems: "gems",
  xp: "xp",
  chest: "xp", // 'xp' / 'chest' fallback
}

function RewardSlotIcon({
  kind,
  className,
}: {kind: RewardKind, className: string}) {
  return (<ShopIcon
    className={className}
    kind={REWARD_TO_ICON[kind]}/>)
}

// Diagonal corner banner. Used for Popular/Best-Value and (in gold) the sale's
// "X% BONUS" — when both show, the bonus sits left and the tag moves right.
function CornerRibbon({
  text,
  side = "left",
  tone,
}: {
  text: string, side?: "left" | "right", tone: "gold" | "violet" | "rose",
}) {
  const toneCls = tone === "gold" ? styles.ribbonGold : tone === "rose" ? styles.ribbonRose : styles.ribbonViolet
  return (<div
    className={`${styles.ribbon} ${side === "left" ? styles.ribbonLeft : styles.ribbonRight}`}>
    {/* Wide, centred diagonal band whose ends run past the clip box, so it
          reads as a corner ribbon touching BOTH edges. whitespace-nowrap +
          text-center keep "Best Value!" on one line instead of clipping. */}
    <div
      className={`${styles.ribbonBand} ${toneCls} ${side === "left" ? styles.ribbonBandLeft : styles.ribbonBandRight}`}>
      {text}
    </div>
  </div>)
}

export function BundleCard({
  bundle,
  isBusy,
  bonusPercent,
  onBuy,
}: {
  bundle: Bundle, isBusy: boolean, bonusPercent: number, onBuy: () => void,
}) {
  const onSale = bonusPercent > 0
  return (<div className={styles.bundleCard}>
    {/* Title bar — optional. Hidden entirely when no header text is configured
          in the BO. Background/text colours are BO-overridable; unset falls back
          to the default gold plate + cream text. */}
    {bundle.headerText ? (<div
      className={`${styles.headerBar} ${bundle.headerBg ? "" : styles.headerBarGold}`}
      style={{
        ...(bundle.headerBg ? {background: bundle.headerBg} : {}), ...(bundle.headerFg ? {color: bundle.headerFg} : {}),
      }}>
      {bundle.headerText}
    </div>) : null}
    <div className={styles.body}>
      {/* Hero — the headline currency, scaled up. Ribbons sit here (over the
            hero, below the title bar). On sale: gold "X% BONUS" left, the
            Popular/Best-Value tag moves right; otherwise the tag stays left.
            data-fly-source anchors the reward-flight on a successful gem buy. */}
      {/* -mx-5 -mt-5 bleeds the hero back out to the card frame, cancelling the
            body's p-5 for THIS block only, so the corner ribbon reaches the edges
            (the rest of the body keeps its padding). */}
      <div
        className={styles.hero}
        data-fly-source={bundle.id}>
        {onSale ? <CornerRibbon
          side="left"
          text={`${bonusPercent}% Bonus`}
          tone="gold"/> : null}
        {bundle.ribbon ? (<CornerRibbon
          side={onSale ? "right" : "left"}
          text={bundle.ribbon === "best-value" ? "Best Value!" : "Popular"}
          tone={bundle.ribbon === "best-value" ? "rose" : "violet"}/>) : null}
        <HeroArt
          className={styles.heroArt}
          imageUrl={bundle.imageUrl}
          kind={bundle.headlineKind}/>
      </div>
      {/* Reward currencies — centered. On sale each currency reward shows the
            struck base above the boosted amount. */}
      <div className={styles.rewardsRow}>
        {bundle.rewards.slice(0, 4).map((r) => (<div
          key={`${r.kind}-${r.amount ?? r.label}-${r.label}`}
          className={styles.rewardSlot}>
          <RewardSlotIcon
            className={styles.rewardIcon}
            kind={r.kind}/>
          {onSale && r.amount !== null ? (<div className={styles.rewardAmounts}>
            <span
              className={styles.struckAmount}>{formatAmount(r.amount)}</span>
            <span
              className={styles.boostedAmount}>{formatAmount(Math.round(r.amount * (1 + bonusPercent / 100)))}</span>
          </div>) : (<span
            className={styles.plainAmount}>{r.amount !== null ? formatAmount(r.amount) : r.label}</span>)}
        </div>))}
      </div>
      <button
        className={styles.buyButton}
        disabled={isBusy}
        type="button"
        onClick={onBuy}>
        <PriceLabel
          priceGems={bundle.priceGems}
          priceUsd={bundle.priceUsd}/>
      </button>
    </div>
  </div>)
}
