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
    className="relative z-[3] grid grid-cols-[340px_1fr] gap-8 p-10">
    <div className="flex flex-col">
      <SectionTitle compact>Featured Pack</SectionTitle>
      <div className="min-h-[30rem] flex-1 animate-pulse rounded-2xl border border-[#ffc93d]/20 bg-[#0c1e39]/60"/>
    </div>
    <div className="min-w-0">
      <SectionTitle>Packs</SectionTitle>
      <div className="grid grid-cols-4 gap-6">
        {SHOP_SKELETON_KEYS.map((skeletonKey) => (
          <div
            key={skeletonKey}
            className="h-[18rem] animate-pulse rounded-2xl border border-[#4a7ecc]/25 bg-[#0c1e39]/60"/>))}
      </div>
    </div>
  </div>)
}

// Shown when the catalog fetch fails, so a network error surfaces as a retry
// instead of masquerading as an empty store on the screen where players pay.
function ShopError({onRetry}: {onRetry: () => void}) {
  return (<div className="relative z-[3] flex flex-col items-center justify-center gap-5 px-10 py-24 text-center">
    <p className="max-w-md font-display text-lg font-bold text-[#f6e6b8]">
      The store couldn’t load. Check your connection and try again.
    </p>
    <button
      className="rounded-xl border border-[#ffc93d]/60 bg-gradient-to-b from-[#f6cf5e] to-[#a06f16] px-6 py-3 font-display text-lg font-black uppercase tracking-[0.06em] text-[#3a2406] shadow-[0_4px_10px_rgba(0,0,0,0.35)] transition hover:brightness-110 active:translate-y-[1px]"
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
        className="origin-center"
        style={{transform: `scale(${scale})`}}>
        <div
          className="relative isolate flex flex-col overflow-hidden rounded-[22px] border border-[#ffc93d]/40 text-[#f6f0df] shadow-[0_26px_70px_rgba(0,0,0,0.55)]"
          style={{width: PANEL_DESIGN_W}}>
          {/* ---- Liquid-glass surface (replaces the flat blue panel) ----
                A colourful base (stands in for the lobby behind the modal) gives
                the refraction edges to bend; the effect layer blurs + distorts it;
                the dark tint keeps it on-theme and the content readable; the
                shine adds the glossy rim. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              background: "radial-gradient(38% 48% at 18% 22%, rgba(56,189,248,0.55), transparent 70%)," + "radial-gradient(42% 52% at 84% 16%, rgba(250,204,21,0.45), transparent 70%)," + "radial-gradient(48% 58% at 78% 86%, rgba(139,92,246,0.50), transparent 70%)," + "radial-gradient(44% 54% at 22% 88%, rgba(16,185,129,0.48), transparent 70%)," + "#03070d",
            }}/>
          {/* The frosted-glass layer (backdrop-filter blur(14px)+saturate +
                an SVG feDisplacementMap) was REMOVED for mobile perf — it was
                the single heaviest surface in the app, and all it blurred was
                the static gradient layer above (already smooth, so the visual
                delta is tiny). If the glass texture is ever missed, bake it
                into a static overlay image instead of a live filter. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[1]"
            style={{background: "rgba(10,26,51,0.55)"}}/>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[2]"
            style={{boxShadow: "inset 2px 2px 1px 0 rgba(255,255,255,0.5), inset -1px -1px 1px 1px rgba(255,255,255,0.22)"}}/>

          <ShopHeader
            storeConfig={storeConfig}
            wallet={wallet}
            onClose={onClose}/>

          {/* Content: Featured Pack | Packs grid — skeleton while the catalog
                loads, a retry on failure, otherwise the two sections. */}
          {status === "error" ? (<ShopError onRetry={() => void catalogQuery.refetch()}/>) : !contentReady ? (
            <ShopSkeleton/>) : (<div className="relative z-[3] grid grid-cols-[340px_1fr] gap-8 p-10">
            {/* No divider; the column is a flex stack so the bundle below the
                  title stretches to the exact height of the two pack rows. */}
            <div className="flex flex-col">
              <SectionTitle compact>Featured Pack</SectionTitle>
              {data.bundles.length > 0 ? (<div className="flex flex-1 flex-col">
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
              </div>) : (<div
                className="grid flex-1 place-items-center rounded-2xl border border-dashed border-[#9aabc5]/25 text-center text-sm text-[#9aabc5]">
                No featured packs yet.
              </div>)}
            </div>

            <div className="min-w-0">
              <SectionTitle>Packs</SectionTitle>
              {data.packs.length > 0 ? (<div className="grid grid-cols-4 gap-6">
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
              </div>) : (<div
                className="grid h-64 place-items-center rounded-2xl border border-dashed border-[#9aabc5]/25 text-center text-sm text-[#9aabc5]">
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
      className={"pointer-events-none fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg px-4 py-2 font-bold shadow-2xl " + (toast.kind === "success" ? "border border-emerald-700/60 bg-gradient-to-b from-emerald-100 to-emerald-300 text-emerald-950" : toast.kind === "error" ? "border border-rose-700/60 bg-gradient-to-b from-rose-100 to-rose-300 text-rose-950" : "border border-amber-700/60 bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950")}>
      {toast.text}
    </div>) : null}
  </>)
}
