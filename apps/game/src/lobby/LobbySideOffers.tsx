import {lobbyOffers} from "./lobbyData"
import styles from "./LobbySideOffers.module.css"
import {Sunbeam} from "./Sunbeam"

const offerTone: Record<string, string> = {
  coins: styles.toneCoins,
  daily: styles.toneDaily,
  connect: styles.toneConnect,
}

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
    className={`${styles.offers} ${side === "right" ? styles.offersRight : ""}`}>
    {offers.map((offer) => (<button
      key={offer.id}
      aria-label={offer.title}
      className={offer.image ? styles.offerCard : `${styles.offerCard} ${offerTone[offer.id] ?? ""}`}
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
          className={styles.offerImage}
          draggable={false}
          src={offer.image}/>
      </>) : (<>
        <span className={styles.offerGlare}/>
        <span className={styles.offerIcon}>
          {offer.symbol}
        </span>
        <span className={styles.offerBody}>
          <span className={styles.offerTitle}>
            {offer.title}
          </span>
          <span className={styles.offerSubtitle}>
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
