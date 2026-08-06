import {useEffect, useMemo, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors"
import {type FlightCurrency, RewardFlight, type RewardFlightSpec} from "../../components/RewardFlight"
import {ScaleInModal} from "../../components/ScaleInModal"
import {selectAuthUserId} from "../../features/auth/authSelectors"
import {
  useClaimMissionMutation, useClaimStreakChestMutation, useRerollMissionMutation,
} from "../../features/lobby/lobbyApi"
import type {Mission} from "../../features/lobby/lobbyData"
import {formatCountdown, type MissionsResult, nextResetMs} from "../../features/lobby/lobbySelectors"
import {createEmptyArray} from "../../lib/constants.ts"
import {useAppSelector} from "../../store/hooks"

import styles from "./DailyMissionsModal.module.css"
import {MissionCard} from "./MissionCard"
import {formatAmount, hideImg} from "./missionHelpers"
import {RerollConfirmModal} from "./RerollConfirmModal"
import {RewardIcon} from "./RewardIcon"
import {WeeklyCard} from "./WeeklyCard"

type Props = {
  readonly result: MissionsResult,
  readonly onClose: () => void,
}

/**
 * Daily Missions modal.
 *
 * Mission Points + the chest-milestone track stay gated behind CHESTS_ENABLED.
 */
const DESIGN_W = 1536
const DESIGN_H = 812

export function DailyMissionsModal({
  result,
  onClose,
}: Props) {
  const {
    state,
    isLoading,
    error,
  } = result
  const userId = useAppSelector(selectAuthUserId)
  const [claimMission] = useClaimMissionMutation()
  const [rerollMission] = useRerollMissionMutation()
  const [claimStreakChest] = useClaimStreakChestMutation()
  const [actionError, setActionError] = useState<string | null>(null)
  const [claimingMissionId, setClaimingMissionId] = useState<string | null>(null)
  const [rerollingMissionId, setRerollingMissionId] = useState<string | null>(null)
  const [rerollConfirmId, setRerollConfirmId] = useState<string | null>(null)
  // The most-recently-rerolled mission floats to the top of the list so the
  // replacement is always visible up top (not buried mid-list). reroll_mission
  // updates the row in place, so the id is stable across the refetch.
  const [rerolledTopId, setRerolledTopId] = useState<string | null>(null)
  const [tab, setTab] = useState<"daily" | "weekly">("daily")
  const [howOpen, setHowOpen] = useState(false)
  const [now, setNow] = useState(Date.now())

  const [flights, setFlights] = useState<readonly RewardFlightSpec[]>([])
  const nextFlightIdRef = useRef(0)

  const spawnFlights = (currency: FlightCurrency, count: number, srcEl: HTMLElement | null) => {
    const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`)
    if (!target || !srcEl) return
    const srcRect = srcEl.getBoundingClientRect()
    const dstRect = target.getBoundingClientRect()
    const startX = srcRect.left + srcRect.width / 2
    const startY = srcRect.top + srcRect.height / 2
    const endX = dstRect.left + dstRect.width / 2
    const endY = dstRect.top + dstRect.height / 2
    const additions: RewardFlightSpec[] = []
    for (let i = 0; i < count; i++) {
      additions.push({
        id: nextFlightIdRef.current++,
        currency,
        startX: startX + (Math.random() - 0.5) * 30,
        startY: startY + (Math.random() - 0.5) * 30,
        endX,
        endY,
        delayMs: i * 70,
        durationMs: 850,
      })
    }
    setFlights((prev) => [...prev, ...additions])
  }
  const removeFlight = (id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id))
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !claimingMissionId && !rerollingMissionId) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose, claimingMissionId, rerollingMissionId])

  const missionsList = state?.missions ?? createEmptyArray<Mission>()
  const dailies = useMemo(() => missionsList.filter((m) => m.period === "daily"), [missionsList])
  const orderedDailies = useMemo(() => [...dailies].sort((a, b) => Number(b.id === rerolledTopId) - Number(a.id === rerolledTopId)), [dailies, rerolledTopId])
  const weeklies = useMemo(() => missionsList.filter((m) => m.period === "weekly").slice(0, 2), [missionsList])
  const claimableCount = useMemo(() => dailies.filter((m) => m.completed_at && !m.claimed_at).length, [dailies])
  const weeklyClaimable = useMemo(() => weeklies.some((m) => m.completed_at && !m.claimed_at), [weeklies])

  const [scale, setScale] = useState(1)
  useEffect(() => {
    const update = () => {
      const s = Math.min(1, (window.innerWidth * 0.98) / DESIGN_W, (window.innerHeight * 0.96) / DESIGN_H)
      setScale(s)
    }
    update()
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("resize", update)
    }
  }, [])

  const countdownMs = useMemo(() => {
    void now
    return nextResetMs(state)
  }, [state, now])

  const rerollsLeft = state ? Math.max(0, state.reroll.daily_cap - state.reroll.rerolls_today) : 0
  const canRerollAny = rerollsLeft > 0
  const rerollCost = state?.reroll.next_cost ?? null

  const handleClaim = async (missionId: string, srcEl: HTMLElement | null) => {
    setClaimingMissionId(missionId)
    setActionError(null)
    const mission = missionsList.find((m) => m.id === missionId)
    try {
      if (!userId) {
        setActionError("Sign in to claim mission rewards.")
        return
      }
      const credited = await claimMission({
        missionId,
        userId,
      }).unwrap()
      if (credited?.credited_coins) spawnFlights("coins", Math.min(8, Math.max(3, Math.ceil(credited.credited_coins / 75))), srcEl)
      if (credited?.credited_gems) spawnFlights("gems", Math.min(6, Math.max(2, credited.credited_gems)), srcEl)
      if (credited?.credited_xp) spawnFlights("xp", Math.min(5, Math.max(2, credited.credited_xp)), srcEl)
      if (!credited?.credited_coins && !credited?.credited_gems && !credited?.credited_xp && mission) {
        for (const r of mission.rewards) {
          if (r.reward_kind !== "currency" || !r.currency_code) continue
          if (r.currency_code === "coins") spawnFlights("coins", Math.min(8, Math.max(3, Math.ceil(r.amount / 75))), srcEl); else if (r.currency_code === "gems") spawnFlights("gems", Math.min(6, Math.max(2, r.amount)), srcEl); else if (r.currency_code === "xp") spawnFlights("xp", Math.min(5, Math.max(2, r.amount)), srcEl)
        }
      }
      // claimMission invalidates the aggregate missions tag, and the
      // endpoint's Realtime channel patches follow-ups — the modal's
      // list and streak panels refresh through the query subscription.
    }
    catch (e) {
      setActionError(extractErrorMessage(e))
    }
    finally {
      setClaimingMissionId(null)
    }
  }

  const handleClaimAll = async () => {
    const claimables = dailies.filter((m) => m.completed_at && !m.claimed_at)
    for (const m of claimables) {
      const btn = document.querySelector<HTMLElement>("[data-claim-all-btn]")
      await handleClaim(m.id, btn)
    }
  }

  const handleReroll = async (missionId: string) => {
    setRerollingMissionId(missionId)
    setActionError(null)
    try {
      if (!userId) {
        setActionError("Sign in to reroll missions.")
        return
      }
      await rerollMission({
        missionId,
        userId,
      }).unwrap()
      setRerolledTopId(missionId)
      setRerollConfirmId(null)
    }
    catch (e) {
      setActionError(extractErrorMessage(e))
    }
    finally {
      setRerollingMissionId(null)
    }
  }

  const handleClaimStreak = async () => {
    setActionError(null)
    try {
      if (!userId) {
        setActionError("Sign in to claim the streak chest.")
        return
      }
      await claimStreakChest({userId}).unwrap()
    }
    catch (e) {
      setActionError(extractErrorMessage(e))
    }
  }

  const daysDone = Math.min(7, state?.streak.current_streak_days ?? 0)
  const streakClaimable = (state?.streak.current_streak_days ?? 0) >= 7

  return (<>
    <ScaleInModal
      closeOnBackdropClick={false}
      closeOnEscape={false}>
      <div
        className={styles.root}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center",
        }}>
        <main
          aria-label="Daily Missions"
          className={styles.screen}>
          <header className={styles.topbar}>
            <div className={styles.brandMark}>
              <img
                alt=""
                draggable={false}
                src="/lobby/missions/dice-icon.webp"
                onError={hideImg}/>
            </div>
            <div className={styles.brandCopy}>
              <h1 className={styles.brandTitle}>Daily Missions</h1>
              <p className={styles.brandSubtitle}>Complete missions to earn epic rewards!</p>
            </div>
            <div className={styles.headerSpacer}/>
            <section className={styles.refreshBox}>
              <div>
                <div className={styles.refreshLabel}>Refreshes in</div>
                <div className={styles.refreshTime}>{formatCountdown(countdownMs)}</div>
              </div>
            </section>
            <button
              aria-label="Close"
              className={styles.closeButton}
              type="button"
              onClick={onClose}>
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2.7"/>
              </svg>
            </button>
          </header>

          {isLoading && !state ? (<div className={styles.status}>Loading missions…</div>) : error ? (
            <div className={`${styles.status} ${styles.statusError}`}>{error}</div>) : !state ? (
            <div className={styles.status}>No missions today.</div>) : (<section className={styles.content}>
            <section className={`${styles.panel} ${styles.missionsPanel}`}>
              <div className={styles.missionList}>
                {orderedDailies.map((m) => (<MissionCard
                  key={m.id}
                  canReroll={canRerollAny}
                  isClaiming={claimingMissionId === m.id}
                  mission={m}
                  rerollCost={rerollCost}
                  onClaim={(el) => handleClaim(m.id, el)}
                  onGo={onClose}
                  onRerollClick={() => {
                    setRerollConfirmId(m.id)
                  }}/>))}
                {dailies.length === 0 && (
                  <div className={styles.empty}>No active missions. Come back at midnight UTC.</div>)}
              </div>
              {actionError && <div className={styles.actionError}>{actionError}</div>}
              <div className={styles.missionsFooter}>
                <span className={`${styles.compactButton} ${styles.compactButtonRerolls}`}>
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="17"
                    viewBox="0 0 24 24"
                    width="17">
                    <path
                      d="M20 12a8 8 0 1 1-2.3-5.6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2.4"/>
                    <path
                      d="M20 4v6h-6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.4"/>
                  </svg>
                  <span>{rerollsLeft} left</span>
                </span>
                <button
                  data-claim-all-btn
                  className={`${styles.compactButton} ${styles.compactButtonClaimAll}`}
                  disabled={claimableCount === 0 || claimingMissionId !== null}
                  type="button"
                  onClick={handleClaimAll}>
                  {claimableCount > 0 ? `Claim All (${claimableCount})` : "Claim All"}
                </button>
              </div>
            </section>

            <aside className={`${styles.panel} ${styles.tabsPanel}`}>
              <nav className={styles.tabs}>
                <button
                  className={`${styles.tabButton} ${tab === "daily" ? styles.tabButtonActive : ""}`}
                  type="button"
                  onClick={() => {
                    setTab("daily")
                  }}>
                  Daily
                </button>
                <button
                  className={`${styles.tabButton} ${tab === "weekly" ? styles.tabButtonActive : ""}`}
                  type="button"
                  onClick={() => {
                    setTab("weekly")
                  }}>
                  Weekly{weeklyClaimable && <i className={styles.tabDot}/>}
                </button>
              </nav>

              {tab === "daily" ? (<section className={styles.streakPanel}>
                <div className={styles.streakHeader}>
                  <h2 className={styles.streakTitle}>Daily Streak</h2>
                  <div className={styles.streakDays}>
                    {state.streak.current_streak_days} day{state.streak.current_streak_days === 1 ? "" : "s"}
                  </div>
                  <button
                    aria-expanded={howOpen}
                    aria-label="How it works"
                    className={styles.infoButton}
                    type="button"
                    onClick={() => {
                      setHowOpen((v) => !v)
                    }}>
                    i
                  </button>
                </div>
                <p className={styles.streakDescription}>
                  Complete all daily missions every day. Hit 7 days to open the streak chest.
                </p>

                <div className={styles.streakTrack}>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (<div
                    key={day}
                    className={styles.trackDay}>
                    <span>Day {day}</span>
                    {day === 7 ? (<div className={`${styles.chestNode} ${daysDone >= 7 ? styles.chestNodeLit : ""}`}>
                      <img
                        alt=""
                        draggable={false}
                        src="/lobby/missions/chest-3.webp"
                        onError={hideImg}/>
                    </div>) : (<div
                      className={`${styles.dayNode} ${day <= daysDone ? styles.dayNodeDone : ""} ${day === daysDone + 1 ? styles.dayNodeCurrent : ""}`}/>)}
                  </div>))}
                </div>

                <div className={styles.streakRewards}>
                  {state.streak_chest_rewards.map((r) => (<div
                    key={`${r.amount}-${r.currency_code ?? r.item_id ?? ""}`}
                    className={styles.streakRewardItem}>
                    <RewardIcon
                      reward={r}
                      size="lg"/>
                    <span>+{formatAmount(r.amount)}</span>
                  </div>))}
                  {streakClaimable ? (<button
                    className={styles.streakClaim}
                    type="button"
                    onClick={handleClaimStreak}>
                    Claim
                  </button>) : (<div className={styles.toGo}>{7 - daysDone} to go</div>)}
                </div>

                {howOpen && (<div
                  aria-label="How it works"
                  className={styles.howPopover}
                  role="dialog">
                  <button
                    aria-label="Close"
                    className={styles.howClose}
                    type="button"
                    onClick={() => {
                      setHowOpen(false)
                    }}>
                    <svg
                      aria-hidden="true"
                      fill="none"
                      viewBox="0 0 24 24">
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="2.6"/>
                    </svg>
                  </button>
                  <h3 className={styles.howTitle}>How it works</h3>
                  <div className={styles.howLine}>
                    <div className={styles.howIcon}>
                      <svg
                        aria-hidden="true"
                        fill="currentColor"
                        viewBox="0 0 24 24">
                        <path d="M12 3.2l2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.9 5.5-.8L12 3.2z"/>
                      </svg>
                    </div>
                    <div>Finish every daily mission to advance your streak and bank the chest.</div>
                  </div>
                  <div className={styles.howLine}>
                    <div className={styles.howIcon}>
                      <svg
                        aria-hidden="true"
                        fill="none"
                        viewBox="0 0 24 24">
                        <path
                          d="M20 12a8 8 0 1 1-2.4-5.7"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="2.4"/>
                        <path
                          d="M20 4v6h-6"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.4"/>
                      </svg>
                    </div>
                    <div>Don’t like a mission? Reroll it — the first one each day is free.</div>
                  </div>
                </div>)}
              </section>) : (<section className={`${styles.streakPanel} ${styles.weeklyTab}`}>
                {weeklies.length === 0 ? (<div className={styles.weeklyEmpty}>
                  <img
                    alt=""
                    draggable={false}
                    src="/lobby/missions/dice-icon.webp"
                    onError={hideImg}/>
                  <p>No weekly challenge active right now.</p>
                </div>) : (weeklies.map((m) => (<WeeklyCard
                  key={m.id}
                  isClaiming={claimingMissionId === m.id}
                  mission={m}
                  onClaim={(el) => handleClaim(m.id, el)}
                  onGo={onClose}/>)))}
              </section>)}
            </aside>
          </section>)}
        </main>
      </div>
    </ScaleInModal>

    {rerollConfirmId && state && (<RerollConfirmModal
      errorMessage={actionError}
      isBusy={rerollingMissionId !== null}
      priceGems={state.reroll.next_cost ?? 0}
      onCancel={() => {
        setRerollConfirmId(null)
        setActionError(null)
      }}
      onConfirm={() => handleReroll(rerollConfirmId)}/>)}

    {flights.map((spec) => (<RewardFlight
      key={spec.id}
      spec={spec}
      onLanded={removeFlight}/>))}
  </>)
}
