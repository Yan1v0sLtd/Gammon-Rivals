import type {HeadlineKind} from "./shopCatalog"
import {type ShopIconKind, ShopIcon} from "./ShopIcon"

const HEADLINE_TO_ICON: Record<HeadlineKind, ShopIconKind> = {
  coins: "coins",
  gems: "gems",
  "xp-boost": "xp",
  "lucky-dice": "dice",
}

function HeadlineIcon({
  kind,
  className,
}: {kind: HeadlineKind, className: string}) {
  return (<ShopIcon
    className={className}
    kind={HEADLINE_TO_ICON[kind]}/>)
}

/** Pack/bundle hero: the operator-uploaded art (shop_items.image_url) when set,
 *  otherwise the headline-currency icon. A broken image URL hides itself rather
 *  than showing a broken-image glyph. */
export function HeroArt({
  imageUrl,
  kind,
  className,
}: {imageUrl: string | null, kind: HeadlineKind, className: string}) {
  if (imageUrl) {
    return (<img
      alt=""
      className={`select-none object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] ${className}`}
      draggable={false}
      src={imageUrl}
      onError={(e) => {
        (e.currentTarget).style.visibility = "hidden"
      }}/>)
  }
  return (<HeadlineIcon
    className={className}
    kind={kind}/>)
}
