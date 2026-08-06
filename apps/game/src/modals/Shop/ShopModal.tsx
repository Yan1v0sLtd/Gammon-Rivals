import {useEffect, useMemo, useState} from "react"

import {type FlightCurrency, RewardFlight} from "../../components/RewardFlight"
import {ScaleInModal} from "../../components/ScaleInModal"
import {selectCurrentWallet} from "../../features/auth/authSelectors"
import {
  useGetShopCatalogQuery, useGetStoreConfigQuery, useGetStoreSaleQuery,
} from "../../features/shop/shopApi"
import {useImagePreloader} from "../../lib/useImagePreloader"
import {useAppSelector} from "../../store/hooks"

import {BundleCard} from "./BundleCard"
import {PackCard} from "./PackCard"
import {SaleCountdown} from "./SaleCountdown"
import {mapShop, type HeadlineKind} from "./shopCatalog"
import {ShopHeader} from "./ShopHeader"
import styles from "./ShopModal.module.css"
import {SectionTitle} from "./ShopSectionTitle"
import {useShopPurchase} from "./useShopPurchase"

// Redesigned Store. Two sections, no category tabs (per current direction):
//   • Featured Packs — bundles (shop_items.kind = 'bundle')
//   • Packs grid     — every other purchasable single pack
// Balances in the header reuse the lobby's CurrencyPill (same element + the
// player's real wallet). Buy flow: gem-priced → purchase_shop_item; USD →
// the admin test-purchase (so the whole flow is testable) until real billing.

const PANEL_DESIGN_W = 1320
const PANEL_DESIGN_H = 860

const SHOP_SKELETON_KEYS = ["shop-skeleton-1", "shop-skeleton-2", "shop-skeleton-3", "shop-skeleton-4", "shop-skeleton-5", "shop-skeleton-6", "shop-skeleton-7", "shop-skeleton-8"] as const

// Placeholder catalog shown while shop_items loads — mirrors the real layout
// (one featured column + an 8-card grid) so nothing jumps when data arrives.
function ShopSkeleton() {
  return (<div
    aria-hidden="true"
    className={styles.content}>
    <div className={styles.featuredColumn}>
      <SectionTitle compact>Featured Pack</SectionTitle>
      <div className={styles.skeletonFeatured}/>
    </div>
    <div className={styles.packsColumn}>
      <SectionTitle>Packs</SectionTitle>
      <div className={styles.packsGrid}>
        {SHOP_SKELETON_KEYS.map((skeletonKey) => (
          <div
            key={skeletonKey}
            className={styles.skeletonPack}/>))}
      </div>
    </div>
  </div>)
}

// Shown when the catalog fetch fails, so a network error surfaces as a retry
// instead of masquerading as an empty store on the screen where players pay.
function ShopError({onRetry}: {onRetry: () => void}) {
  return (<div className={styles.error}>
    <p className={styles.errorText}>
      The store couldn’t load. Check your connection and try again.
    </p>
    <button
      className={styles.errorButton}
      type="button"
      onClick={onRetry}>
      Try again
    </button>
  </div>)
}

export function ShopModal({onClose}: {readonly onClose: () => void}) {
  const wallet = useAppSelector(selectCurrentWallet)
  const {
    toast, busyId, buy, rewardFlights, removeFlight,
  } = useShopPurchase()
  const [scale, setScale] = useState(1)

  // All three refetch on open: the boot warm-up (see ShopHost) keeps them
  // resident for the whole session, so without this an operator's price, sale
  // or artwork change would never reach a long-lived tab. Cached data stays on
  // screen while the refetch runs, so a warmed open still reveals instantly.
  const catalogQuery = useGetShopCatalogQuery(undefined, {refetchOnMountOrArgChange: true})
  const saleQuery = useGetStoreSaleQuery(undefined, {refetchOnMountOrArgChange: true})
  const configQuery = useGetStoreConfigQuery(undefined, {refetchOnMountOrArgChange: true})

  const data = useMemo(() => mapShop(catalogQuery.data ?? []), [catalogQuery.data])
  const sale = saleQuery.data ?? null
  // Memoized so the null fallback keeps a stable identity while config loads;
  // shopImageUrls below depends on it, and a fresh object every render would
  // re-run the preloader's effect on each frame.
  const storeConfig = useMemo(() => configQuery.data ?? {
    title: "Store",
    bgImageUrl: null,
  }, [configQuery.data])
  // Catalog is the gating fetch: it alone decides the three states. RTK
  // Query keeps `data` across background refetches, so a refresh failure
  // with a catalog already on screen stays 'ready' — only a cold load that
  // errors reaches the retry UI.
  const status: "loading" | "ready" | "error" = catalogQuery.data !== undefined ? "ready" : catalogQuery.isError ? "error" : "loading"

  // Gate the reveal on the operator-uploaded pack art + themed background so the
  // store appears fully-formed instead of images popping in after the frame.
  // (Static currency icons are already cached from the lobby; only these remote
  // BO images pop in.) Errors don't block the gate — a missing image can't hang it.
  const shopImageUrls = useMemo(() => [...data.bundles.map((b) => b.imageUrl), ...data.packs.map((p) => p.imageUrl), storeConfig.bgImageUrl], [data, storeConfig])
  const {ready: shopImagesReady} = useImagePreloader(shopImageUrls)
  // Sale and config must have settled too, not just the catalog: the sale
  // multiplies every reward amount on screen, and the config carries the
  // themed background. Revealing before either lands re-prices the store or
  // re-closes the gate (a late background URL grows the preload set) in front
  // of the player. Both data sources resolve to null instead of rejecting, so
  // an `undefined` check is a settled-check that cannot hang the gate.
  const storefrontSettled = saleQuery.data !== undefined && configQuery.data !== undefined
  const contentReady = status === "ready" && storefrontSettled && shopImagesReady

  useEffect(() => {
    const update = () => {
      const s = Math.min(1, (window.innerWidth * 0.92) / PANEL_DESIGN_W, (window.innerHeight * 0.9) / PANEL_DESIGN_H)
      setScale(s)
    }
    update()
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("resize", update)
    }
  }, [])

  const flightKindOf = (k: HeadlineKind): FlightCurrency | null => (k === "coins" || k === "gems" ? k : null)

  return (<>
    <ScaleInModal onClose={onClose}>
      <div
        className={styles.scaleWrap}
        style={{transform: `scale(${scale})`}}>
        <div className={styles.panel}>
          {/* ---- Liquid-glass surface (replaces the flat blue panel) ----
                A colourful base (stands in for the lobby behind the modal) gives
                the refraction edges to bend; the effect layer blurs + distorts it;
                the dark tint keeps it on-theme and the content readable; the
                shine adds the glossy rim. */}
          <div
            aria-hidden="true"
            className={styles.glassBase}/>
          {/* The frosted-glass layer (backdrop-filter blur(14px)+saturate +
                an SVG feDisplacementMap) was REMOVED for mobile perf — it was
                the single heaviest surface in the app, and all it blurred was
                the static gradient layer above (already smooth, so the visual
                delta is tiny). If the glass texture is ever missed, bake it
                into a static overlay image instead of a live filter. */}
          <div
            aria-hidden="true"
            className={styles.glassTint}/>
          <div
            aria-hidden="true"
            className={styles.glassShine}/>

          <ShopHeader
            storeConfig={storeConfig}
            wallet={wallet}
            onClose={onClose}/>

          {/* Content: Featured Pack | Packs grid — skeleton while the catalog
                loads, a retry on failure, otherwise the two sections. */}
          {status === "error" ? (<ShopError onRetry={() => void catalogQuery.refetch()}/>) : !contentReady ? (
            <ShopSkeleton/>) : (<div className={styles.content}>
            {/* No divider; the column is a flex stack so the bundle below the
                  title stretches to the exact height of the two pack rows. */}
            <div className={styles.featuredColumn}>
              <SectionTitle compact>Featured Pack</SectionTitle>
              {data.bundles.length > 0 ? (<div className={styles.bundleStack}>
                {data.bundles.slice(0, 1).map((b) => (<BundleCard
                  key={b.id}
                  bonusPercent={sale?.bonusPercent ?? 0}
                  bundle={b}
                  isBusy={busyId === b.id}
                  onBuy={() => {
                    buy({
                      id: b.id,
                      label: b.title,
                      priceUsd: b.priceUsd,
                      priceGems: b.priceGems,
                      flightKind: flightKindOf(b.headlineKind),
                    })
                  }}/>))}
              </div>) : (<div className={styles.emptyState}>
                No featured packs yet.
              </div>)}
            </div>

            <div className={styles.packsColumn}>
              <SectionTitle>Packs</SectionTitle>
              {data.packs.length > 0 ? (<div className={styles.packsGrid}>
                {data.packs.map((p) => (<PackCard
                  key={p.id}
                  bonusPercent={sale?.bonusPercent ?? 0}
                  isBusy={busyId === p.id}
                  pack={p}
                  onBuy={() => {
                    buy({
                      id: p.id,
                      label: p.headlineLabel,
                      priceUsd: p.priceUsd,
                      priceGems: p.priceGems,
                      flightKind: flightKindOf(p.headlineKind),
                    })
                  }}/>))}
              </div>) : (<div className={styles.emptyStateTall}>
                No packs available.
              </div>)}
            </div>
          </div>)}

          {/* Live sale countdown — only when a running sale has a scheduled end. */}
          {contentReady && sale?.endsAt ? <SaleCountdown endsAt={sale.endsAt}/> : null}
        </div>
      </div>
    </ScaleInModal>

    {rewardFlights.map((spec) => (<RewardFlight
      key={spec.id}
      spec={spec}
      onLanded={removeFlight}/>))}

    {toast ? (<div
      className={`${styles.toast} ${toast.kind === "success" ? styles.toastSuccess : toast.kind === "error" ? styles.toastError : styles.toastInfo}`}>
      {toast.text}
    </div>) : null}
  </>)
}
