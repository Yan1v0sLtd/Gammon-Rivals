import {ShopIcon} from "./ShopIcon"

export function PriceLabel({
  priceUsd,
  priceGems,
}: {priceUsd: number | null, priceGems: number | null}) {
  if (priceGems !== null) {
    return (<span className="flex items-center justify-center gap-1.5">
      <ShopIcon
        className="h-7 w-7"
        kind="gems"/>
      <span className="tabular-nums">{priceGems.toLocaleString()}</span>
    </span>)
  }
  return <span className="tabular-nums">${(priceUsd ?? 0).toFixed(2)}</span>
}
