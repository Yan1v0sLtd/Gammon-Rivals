import {lobbyOffers} from "./lobbyData"
import styles from "./LobbySideOffers.module.css"
import {Sunbeam} from "./Sunbeam"

type LobbySideOffersProps = {
  readonly onOfferClick?: (offerId: string) => void,
  /** Which offer ids to render, in order. Defaults to all. Lets the lobby
   *  split the rail — Special Offers on the left, Daily Bonus + How to Play
   *  on the right — by mounting two instances. */
  readonly offerIds?: readonly string[],
  /** Which side of the board this rail sits on (drives left/right pinning
   *  in LobbySideOffers.module.css via `.offersRight`). */
  readonly side?: "left" | "right",
}

export function LobbySideOffers({
  onOfferClick,
  offerIds,
  side = "left",
}: LobbySideOffersProps = {}) {
  const offers = offerIds ? offerIds
    .map((id) => lobbyOffers.find((o) => o.id === id))
    .filter((o): o is (typeof lobbyOffers)[number] => Boolean(o)) : lobbyOffers
  return (<aside
    className={`${styles.offers} ${side === "right" ? styles.offersRight : ""} flex flex-row gap-3 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible xl:pb-0`}>
    {offers.map((offer) => (<button
      key={offer.id}
      aria-label={offer.title}
      className={`${styles.offerCard} relative flex min-w-[17.5rem] max-w-[17.5rem] items-center justify-center overflow-visible bg-transparent p-0 text-left outline-none ring-0 focus:outline-none focus-visible:outline-none transition hover:brightness-110 hover:scale-[1.03] active:translate-y-1 ${offer.image ? "border-0 shadow-none" : `min-h-[6.7rem] rounded-lg border border-white/25 bg-gradient-to-br ${offer.tone} shadow-[0_9px_18px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]`}`}
      style={offer.image ? {aspectRatio: offer.aspectRatio} : undefined}
      type="button"
      onClick={() => onOfferClick?.(offer.id)}>
      {offer.image ? (<>
        {/* Animated sunbeam glow behind the Special Offers icon only. */}
        {offer.id === "coins" ? <Sunbeam/> : null}
        {/* Standalone 200x200 icon. No background tint, no
                  arrow chevron, no border — the icon art carries
                  its own frame and CTA hint. The icon sits ABOVE the
                  sunbeam canvas (relative z-[1]). */}
        <img
          alt=""
          className="relative z-[1] h-full w-full object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.42)]"
          draggable={false}
          src={offer.image}/>
      </>) : (<>
        <span className="absolute inset-x-0 bottom-0 h-10 bg-black/16"/>
        <span
          className={`${styles.offerIcon} relative ml-4 grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 border-[#f9d96c] bg-gradient-to-b from-[#fff5a9] to-[#d79a20] text-3xl font-black text-[#351c05] shadow-[0_5px_0_rgba(0,0,0,0.25)]`}>
          {offer.symbol}
        </span>
        <span className={`${styles.offerBody} relative min-w-0`}>
          <span
            className={`${styles.offerTitle} block font-display text-xl font-black uppercase leading-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]`}>
            {offer.title}
          </span>
          <span className={`${styles.offerSubtitle} mt-1 block text-xs font-semibold uppercase tracking-wide text-white/70`}>
            {offer.subtitle}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={styles.offerArrow}>›</span>
      </>)}
    </button>))}
  </aside>)
}
