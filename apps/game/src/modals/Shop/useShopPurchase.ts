import {useRef, useState} from "react"

import {type FlightCurrency, type RewardFlightSpec} from "../../components/RewardFlight"
import {selectAuthUserId, selectCurrentWallet} from "../../features/auth/authSelectors"
import {shopGrantConfirmed} from "../../features/shop/shopActions"
import {usePurchaseShopItemMutation} from "../../features/shop/shopApi"
import {getBilling} from "../../lib/billing/service"
import {baseApi} from "../../store/baseApi"
import {useAppDispatch, useAppSelector} from "../../store/hooks"

type ToastKind = "info" | "success" | "error"

type Toast = {
  readonly kind: ToastKind,
  readonly text: string,
}

export type BuyDescriptor = {
  readonly id: string,
  readonly label: string,
  readonly priceUsd: number | null,
  readonly priceGems: number | null,
  readonly flightKind: FlightCurrency | null,
}

/** Owns the whole buy flow: busy state, toasts, reward flights, and both
 *  purchase paths (gem → purchase_shop_item, USD → billing). The modal only
 *  renders the returned state and wires `buy` into each card. */
export function useShopPurchase() {
  const userId = useAppSelector(selectAuthUserId)
  const wallet = useAppSelector(selectCurrentWallet)
  const dispatch = useAppDispatch()
  const [toast, setToast] = useState<Toast | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rewardFlights, setRewardFlights] = useState<readonly RewardFlightSpec[]>([])
  const nextFlightIdRef = useRef(1)
  const [purchaseShopItem] = usePurchaseShopItemMutation()

  const showToast = (kind: ToastKind, text: string, ms = 2400) => {
    setToast({
      kind,
      text,
    })
    window.setTimeout(() => {
      setToast(null)
    }, ms)
  }

  const spawnFlights = (currency: FlightCurrency, sourceEl: Element, count: number) => {
    const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`)
    if (!target) return
    const src = sourceEl.getBoundingClientRect()
    const dst = target.getBoundingClientRect()
    const startX = src.left + src.width / 2
    const startY = src.top + src.height / 2
    const endX = dst.left + dst.width / 2
    const endY = dst.top + dst.height / 2
    const additions: RewardFlightSpec[] = []
    for (let i = 0; i < count; i++) {
      // Deterministic per-token jitter (no Math.random — keeps the function
      // pure-by-static-analysis; the spread reads the same to the eye).
      additions.push({
        id: nextFlightIdRef.current++,
        currency,
        startX: startX + (((i * 37) % 15) - 7),
        startY: startY + (((i * 53) % 15) - 7),
        endX,
        endY,
        delayMs: i * 70,
        durationMs: 800,
      })
    }
    setRewardFlights((prev) => [...prev, ...additions])
  }

  const removeFlight = (id: number) => {
    setRewardFlights((prev) => prev.filter((f) => f.id !== id))
  }

  // Native uses Play Billing. The web mock remains server-gated for test accounts.
  const handleUsdPurchase = async (item: BuyDescriptor) => {
    if (busyId !== null) return
    setBusyId(item.id)
    const billing = await getBilling()
    const outcome = await billing.purchase({
      itemId: item.id,
      label: item.label,
    })
    setBusyId(null)
    if (outcome.status !== "granted") {
      if (outcome.status === "error") {
        const {code} = outcome
        switch (code) {
          case "already_owned":
            showToast("info", "You already own that board.")
            break
          case "unsupported_grant":
            showToast("error", `${item.label}: unsupported grant.`)
            break
          case "not_authorized":
            showToast("info", "Purchases are available in the app.")
            break
          default:
            showToast("error", "Purchase failed.")
        }
      }
      // cancelled / pending: stay silent.
      return
    }
    const sourceEl = document.querySelector(`[data-fly-source="${item.id}"]`)
    if (sourceEl && item.flightKind) spawnFlights(item.flightKind, sourceEl, 6)
    // Any confirmed grant funnels through shopGrantConfirmed; the listener
    // owns the delayed wallet + XP-boost refresh for both purchase paths.
    if (userId) dispatch(shopGrantConfirmed({userId}))
    showToast("success", `${item.label} purchased ✓`)
  }

  // Gem path — live for everyone via purchase_shop_item.
  const buyWithGems = async (item: BuyDescriptor) => {
    if (busyId !== null) return
    if (!userId) {
      showToast("error", "Sign in to make purchases")
      return
    }
    if (wallet && item.priceGems !== null && wallet.gems < item.priceGems) {
      showToast("info", "Not enough gems — grab a gem pack first.")
      return
    }
    const sourceEl = document.querySelector(`[data-fly-source="${item.id}"]`)
    setBusyId(item.id)
    try {
      await purchaseShopItem({
        itemId: item.id,
        userId,
      }).unwrap()
    }
    catch (err) {
      setBusyId(null)
      // unwrap() rejects with the serialized ApiError ({ message }), not an
      // Error — handle both shapes so the message matching keeps working.
      const msg = err instanceof Error ? err.message : (err as {message?: string}).message ?? ""
      if (msg.includes("unsupported_grant")) {
        showToast("info", `${item.label} — coming soon`)
      }
      else if (msg.includes("insufficient_gems")) {
        showToast("info", "Not enough gems.")
        // The displayed balance disagreed with the server, so resync
        // immediately (this replaces the old refreshWallet()).
        dispatch(baseApi.util.invalidateTags([{
          type: "Wallet",
          id: userId,
        }]))
      }
      else if (msg.includes("already_owned_board")) {
        showToast("info", "You already own that board.")
      }
      else if (msg.includes("purchase_limit_reached")) {
        showToast("info", "Purchase limit reached for this item.")
      }
      else {
        showToast("error", "Purchase failed. Try again.")
      }
      return
    }
    setBusyId(null)
    if (sourceEl && item.flightKind) spawnFlights(item.flightKind, sourceEl, 6)
    dispatch(shopGrantConfirmed({userId}))
    showToast("success", `Got ${item.label}!`)
  }

  const buy = (item: BuyDescriptor) => {
    if (item.priceGems !== null) return void buyWithGems(item)
    if (item.priceUsd !== null) return void handleUsdPurchase(item)
  }

  return {
    toast,
    busyId,
    buy,
    rewardFlights,
    removeFlight,
  }
}
