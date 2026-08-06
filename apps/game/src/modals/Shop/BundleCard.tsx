import {HeroArt} from "./HeroArt"
import {PriceLabel} from "./PriceLabel"
import {formatAmount, type Bundle, type RewardKind} from "./shopCatalog"
import {type ShopIconKind, ShopIcon} from "./ShopIcon"
import {GOLD_PLATE, PLATE_TEXT, PRICE_SHADOW} from "./shopStyles"

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
  const toneCls = tone === "gold" ? "from-[#ffe08a] to-[#b8801f] text-[#3a2406]" : tone === "rose" ? "from-rose-500 to-rose-700 text-white" : "from-violet-500 to-violet-700 text-white"
  return (<div
    className={`pointer-events-none absolute z-20 ${side === "left" ? "-left-px" : "-right-px"} -top-px h-28 w-28 overflow-hidden`}>
    {/* Wide, centred diagonal band whose ends run past the clip box, so it
          reads as a corner ribbon touching BOTH edges. whitespace-nowrap +
          text-center keep "Best Value!" on one line instead of clipping. */}
    <div
      className={`absolute left-[-34%] top-[17%] w-[168%] py-1 bg-gradient-to-b ${toneCls} font-display text-center text-[0.62rem] font-black uppercase leading-tight tracking-[0.06em] whitespace-nowrap shadow-[0_2px_4px_rgba(0,0,0,0.35)] ${side === "left" ? "-rotate-45" : "rotate-45"}`}>
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
  return (<div
    className="relative flex h-full min-h-[30rem] flex-1 flex-col overflow-hidden rounded-2xl border border-[#ffc93d]/85 bg-gradient-to-b from-[#0c1e39] to-[#071326] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(0,0,0,0.35)]">
    {/* Title bar — optional. Hidden entirely when no header text is configured
          in the BO. Background/text colours are BO-overridable; unset falls back
          to the default gold plate + cream text. */}
    {bundle.headerText ? (<div
      className={`${bundle.headerBg ? "" : GOLD_PLATE} ${PLATE_TEXT} px-4 py-4 text-center text-2xl tracking-[0.12em]`}
      style={{
        ...(bundle.headerBg ? {background: bundle.headerBg} : {}), ...(bundle.headerFg ? {color: bundle.headerFg} : {}),
      }}>
      {bundle.headerText}
    </div>) : null}
    <div className="flex flex-1 flex-col p-5">
      {/* Hero — the headline currency, scaled up. Ribbons sit here (over the
            hero, below the title bar). On sale: gold "X% BONUS" left, the
            Popular/Best-Value tag moves right; otherwise the tag stays left.
            data-fly-source anchors the reward-flight on a successful gem buy. */}
      {/* -mx-5 -mt-5 bleeds the hero back out to the card frame, cancelling the
            body's p-5 for THIS block only, so the corner ribbon reaches the edges
            (the rest of the body keeps its padding). */}
      <div
        className="relative -mx-5 -mt-5 flex min-h-0 flex-1 items-center justify-center overflow-hidden border-b border-white/10"
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
          className="h-64 w-64"
          imageUrl={bundle.imageUrl}
          kind={bundle.headlineKind}/>
      </div>
      {/* Reward currencies — centered. On sale each currency reward shows the
            struck base above the boosted amount. */}
      <div className="flex flex-wrap items-stretch justify-center gap-4 border-b border-white/10 py-6">
        {bundle.rewards.slice(0, 4).map((r) => (<div
          key={`${r.kind}-${r.amount ?? r.label}-${r.label}`}
          className="flex min-w-[7rem] flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-[#183763]/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <RewardSlotIcon
            className="h-[3.7rem] w-[3.7rem]"
            kind={r.kind}/>
          {onSale && r.amount !== null ? (<div className="flex flex-col items-center leading-none">
            <span
              className="text-[1.05rem] font-bold text-[#9aabc5] line-through tabular-nums">{formatAmount(r.amount)}</span>
            <span
              className="text-[1.6rem] font-black text-white tabular-nums">{formatAmount(Math.round(r.amount * (1 + bonusPercent / 100)))}</span>
          </div>) : (<span
            className="text-center text-[1.6rem] font-black leading-tight text-white tabular-nums">{r.amount !== null ? formatAmount(r.amount) : r.label}</span>)}
        </div>))}
      </div>
      <button
        className={`mt-auto h-16 w-full rounded-xl bg-gradient-to-b from-[#27db74] to-[#079044] font-display text-[1.9rem] font-black text-white ${PRICE_SHADOW} shadow-[inset_0_2px_0_rgba(255,255,255,0.22),0_8px_18px_rgba(0,0,0,0.35)] transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-wait disabled:opacity-60`}
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
