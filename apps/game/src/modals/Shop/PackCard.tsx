import {HeroArt} from "./HeroArt"
import {PriceLabel} from "./PriceLabel"
import {formatAmount, type Pack} from "./shopCatalog"
import {GOLD_PLATE, PLATE_TEXT, PRICE_SHADOW} from "./shopStyles"

// Small gold pill under a pack's icon advertising the running sale.
function SaleBadge({bonusPercent}: {bonusPercent: number}) {
  return (<div
    className="mx-auto mb-2 w-fit rounded-full border border-[#ffe08a]/70 bg-gradient-to-b from-[#ffe08a] to-[#b8801f] px-3.5 py-1 font-display text-[1.1rem] font-black uppercase tracking-wide text-[#3a2406] shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
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
  return (<div
    className="relative flex h-[18rem] flex-col overflow-hidden rounded-2xl border border-[#4a7ecc]/55 bg-gradient-to-b from-[#0c1e39] to-[#071326] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(0,0,0,0.25)]">
    {/* Title bar — optional. Hidden when no header text is configured; the
          card is a fixed-height flex column, so the body just fills the freed
          space and the grid stays aligned. Colours are BO-overridable (unset →
          the default gold plate + cream text). */}
    {pack.headerText ? (<div
      className={`${pack.headerBg ? "" : GOLD_PLATE} ${PLATE_TEXT} flex h-12 items-center justify-center px-2 text-center text-[1.05rem] leading-[1.05] tracking-[0.05em]`}
      style={{
        ...(pack.headerBg ? {background: pack.headerBg} : {}), ...(pack.headerFg ? {color: pack.headerFg} : {}),
      }}>
      {pack.headerText}
    </div>) : null}
    <div className="flex flex-1 flex-col p-4">
      {/* Icon −20% to free room for the (bigger) amount + price below. */}
      <div
        className="flex flex-1 items-center justify-center"
        data-fly-source={pack.id}>
        <HeroArt
          className="h-[4.8rem] w-[4.8rem]"
          imageUrl={pack.imageUrl}
          kind={pack.headlineKind}/>
      </div>
      {onSale ? <SaleBadge bonusPercent={bonusPercent}/> : null}
      {base !== null || pack.headlineSubLabel ? (<div className="mb-2 text-center leading-none">
        {base !== null ? (onSale ? (<>
          <div
            className="text-[1.1rem] font-bold text-[#9aabc5] line-through tabular-nums">{formatAmount(base)}</div>
          <div
            className="mt-1 font-display text-[2.05rem] font-black tabular-nums text-white">{formatAmount(boosted!)}</div>
        </>) : (<div
          className="font-display text-[2.05rem] font-black tabular-nums text-white">{formatAmount(base)}</div>)) : null}
        {pack.headlineSubLabel
          ? <div className="mt-1 text-[0.95rem] font-bold text-[#9aabc5]">{pack.headlineSubLabel}</div> : null}
      </div>) : null}
      <button
        className={`mt-auto h-14 w-full rounded-lg bg-gradient-to-b from-[#27db74] to-[#079044] font-display text-[1.72rem] font-black text-white ${PRICE_SHADOW} shadow-[inset_0_2px_0_rgba(255,255,255,0.22),0_6px_14px_rgba(0,0,0,0.3)] transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-wait disabled:opacity-60`}
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
