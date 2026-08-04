import {useCallback} from "react"

import {skipToken} from "@reduxjs/toolkit/query"

import {extractErrorMessage} from "../../../../packages/shared/src/errors"
import {useShop} from "../features/appUi/useShop"
import {authRefreshRequested} from "../features/auth/authActions"
import {selectAuthUserId, selectCurrentProfile, selectCurrentWallet, selectProfileProgression} from "../features/auth/authSelectors"
import {useClaimDailyBonusMutation, usePurchaseBoardWithGemsMutation, useGetDailyBonusConfigsQuery, useGetDailyBonusStateQuery, useGetDailyMissionsQuery, useGetLobbyBoardsQuery} from "../features/lobby/lobbyApi"
import {boardPurchaseErrorMessage, dailyBonusErrorMessage} from "../features/lobby/lobbyErrors"
import {useLobbyMatchmaking} from "../features/lobby/lobbyMatchmaking"
import {selectLobbyModal} from "../features/lobby/lobbySelectors"
import {computeDaysClaimedInCurrentStreak, computeUpcomingDay, selectLobbyBoards, todayET, type MissionsResult} from "../features/lobby/lobbySelectors"
import {
  boardPurchaseFailed, dailyBonusClaimFailed, dailyBonusClaimSucceeded, lobbyModalClosed,
} from "../features/lobby/lobbySlice"
import {isSupabaseConfigured} from "../lib/supabase"
import {useAppDispatch, useAppSelector} from "../store/hooks"

import {BoardPurchaseModal} from "./BoardPurchaseModal"
import {DailyBonusModal} from "./DailyBonusModal"
import {DailyMissionsModal} from "./DailyMissionsModal"
import {DifficultyModal} from "./DifficultyModal"
import {HowToPlayModal} from "./HowToPlayModal"
import type {FlightCurrency} from "./RewardFlight"
import {useWheelState} from "./useWheelState"
import {WheelModal} from "./WheelModal"

type LobbyModalHostProps = {
  /** Reward flights render inside LobbyScreen, so spawning stays owned there. */
  readonly onSpawnFlights: (currency: FlightCurrency, sourceEl: Element, count: number) => void,
}

/**
 * Renders the slice's open full-screen lobby modal. Server data stays in
 * RTK Query; the slice owns only modal identity, in-flight error/result,
 * and the selected board id.
 */
export function LobbyModalHost({onSpawnFlights}: LobbyModalHostProps) {
  const dispatch = useAppDispatch()
  const modal = useAppSelector(selectLobbyModal)
  const userId = useAppSelector(selectAuthUserId)
  const profile = useAppSelector(selectCurrentProfile)
  const wallet = useAppSelector(selectCurrentWallet)
  const progression = useAppSelector(selectProfileProgression)
  const {openShop} = useShop()
  useGetLobbyBoardsQuery(undefined, {skip: !isSupabaseConfigured})
  const boards = useAppSelector(selectLobbyBoards)
  const {
    busyId,
    overlay,
    start,
    cancel,
  } = useLobbyMatchmaking()
  const dailyBonusConfigsQuery = useGetDailyBonusConfigsQuery(undefined, {skip: !isSupabaseConfigured})
  const dailyBonusStateQuery = useGetDailyBonusStateQuery(userId ?? skipToken, {skip: !isSupabaseConfigured})
  const today = todayET()
  const dailyBonusState = dailyBonusStateQuery.data ?? null
  const dailyBonus = {
    configs: dailyBonusConfigsQuery.data ?? [],
    canClaim: dailyBonusState !== null && dailyBonusState.last_claim_date_et !== today,
    upcomingDay: computeUpcomingDay(dailyBonusState, today),
    daysClaimedInCurrentStreak: computeDaysClaimedInCurrentStreak(dailyBonusState, today),
  }
  const wheel = useWheelState("main")
  const missionsQuery = useGetDailyMissionsQuery(profile?.id ?? skipToken, {skip: !isSupabaseConfigured})
  const missionsResult: MissionsResult = {
    state: missionsQuery.data ?? null,
    isLoading: missionsQuery.isLoading || (isSupabaseConfigured && !!profile?.id && missionsQuery.isUninitialized),
    error: missionsQuery.error?.message ?? null,
  }
  const [purchaseBoardWithGems, {isLoading: isPurchasing}] = usePurchaseBoardWithGemsMutation()
  const [claimDailyBonusMutation, {isLoading: isClaiming}] = useClaimDailyBonusMutation()

  const closeModal = useCallback(() => dispatch(lobbyModalClosed()), [dispatch])

  if (modal.kind === "difficulty") {
    return (<>
      <DifficultyModal
        busyId={busyId}
        matchmaking={overlay}
        open={modal.kind === "difficulty"}
        playerLevel={progression.level}
        walletCoins={wallet?.coins ?? 0}
        onCancelMatchmaking={cancel}
        onClose={() => {
          if (busyId !== null) return
          dispatch(lobbyModalClosed())
        }}
        onGetCoins={() => {
          // No showOverlay() here — /shop renders instantly and must not
          // trap the user behind the route overlay.
          dispatch(lobbyModalClosed())
          openShop()
        }}
        onSelect={start}/>
      {modal.error ? (<div
        className="pointer-events-none fixed left-1/2 top-6 z-[60] -translate-x-1/2 rounded-lg border border-rose-700/60 bg-gradient-to-b from-rose-100 to-rose-300 px-4 py-2 font-bold text-rose-950 shadow-2xl">
        {modal.error}
      </div>) : null}
    </>)
  }

  if (modal.kind === "boardPurchase") {
    const board = boards.find((b) => b.id === modal.boardId)
    if (!board) return null

    const confirmPurchase = async () => {
      if (isPurchasing) return
      if (!isSupabaseConfigured || !userId) {
        dispatch(boardPurchaseFailed({message: "Sign in to purchase boards."}))
        return
      }
      try {
        // The endpoint invalidates both the board-inventory and wallet tags,
        // so the carousel flips to owned and the top bar re-totals.
        await purchaseBoardWithGems({
          boardId: board.id,
          userId,
        }).unwrap()
        dispatch(lobbyModalClosed())
      }
      catch (err) {
        dispatch(boardPurchaseFailed({
          message: boardPurchaseErrorMessage(extractErrorMessage(err), board.unlockLevel),
        }))
      }
    }

    return (<BoardPurchaseModal
      boardName={board.name}
      errorMessage={modal.error}
      isPurchasing={isPurchasing}
      priceGems={board.priceGems}
      onCancel={() => {
        if (isPurchasing) return
        dispatch(lobbyModalClosed())
      }}
      onConfirm={confirmPurchase}/>)
  }

  if (modal.kind === "missions") {
    return (<DailyMissionsModal
      result={missionsResult}
      onClose={() => {
        dispatch(lobbyModalClosed())
        // Claims/rerolls/chests may have credited the wallet AND XP —
        // refresh both so the top-bar RollingNumber and the level
        // progress bar catch up.
        dispatch(authRefreshRequested({scope: "profileAndWallet"}))
      }}/>)
  }

  if (modal.kind === "wheel") {
    return (<WheelModal
      wheel={wheel}
      onClose={closeModal}
      onProgressionUpdated={() => {
        // Fires ~1500ms before the modal closes, while XP tokens are
        // still flying — the XP bar fills during the flight animation.
        dispatch(authRefreshRequested({scope: "profile"}))
      }}
      onSpinComplete={() => {
        // Refresh wallet so RollingNumber ticks the new total AFTER the
        // coin/gem flights land (visual cause→effect), and re-fetch the
        // wheel state so the lobby pill flips back to its countdown.
        dispatch(authRefreshRequested({scope: "wallet"}))
        wheel.refetch()
      }}/>)
  }

  if (modal.kind === "dailyBonus") {
    const claimDailyBonus = async () => {
      if (isClaiming) return
      if (!isSupabaseConfigured || !userId) {
        dispatch(dailyBonusClaimFailed({message: "Sign in to claim daily bonuses."}))
        return
      }
      // Capture each currency's source element BEFORE the modal re-renders
      // into its claimed state (which can move/remove icons); each currency
      // uses its own source so coins fly from the coin icon and gems from
      // the gem icon.
      const gemsSourceEl = document.querySelector('[data-fly-source="gems"]')
      const coinsSourceEl = document.querySelector('[data-fly-source="coins"]')

      try {
        const payload = await claimDailyBonusMutation({userId}).unwrap()
        if (!payload || typeof payload.day_claimed !== "number") return

        const reward = {
          day: payload.day_claimed,
          coins: payload.reward_coins ?? 0,
          gems: payload.reward_gems ?? 0,
          xp: payload.reward_xp ?? 0,
        }
        dispatch(dailyBonusClaimSucceeded(reward))

        // Spawn before the delayed wallet refresh lands so the tokens arrive
        // at a bumped balance. Fallback to the other source when a card has
        // only one icon — better a nearby start than no flight.
        if (reward.gems > 0) {
          const src = gemsSourceEl ?? coinsSourceEl
          if (src) onSpawnFlights("gems", src, 6)
        }
        if (reward.coins > 0) {
          const src = coinsSourceEl ?? gemsSourceEl
          if (src) onSpawnFlights("coins", src, 6)
        }
      }
      catch (err) {
        dispatch(dailyBonusClaimFailed({message: dailyBonusErrorMessage(extractErrorMessage(err))}))
      }
    }

    return (<DailyBonusModal
      canClaim={dailyBonus.canClaim}
      configs={dailyBonus.configs}
      daysClaimedInCurrentStreak={dailyBonus.daysClaimedInCurrentStreak}
      errorMessage={modal.error}
      isClaiming={isClaiming}
      justClaimed={modal.justClaimed}
      upcomingDay={dailyBonus.upcomingDay}
      onClaim={claimDailyBonus}
      onClose={closeModal}/>)
  }

  if (modal.kind === "howToPlay") {
    return <HowToPlayModal onClose={closeModal}/>
  }

  return null
}
