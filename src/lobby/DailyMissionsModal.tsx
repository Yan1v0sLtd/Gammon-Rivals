import { useEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { supabase } from '../lib/supabase';
import { extractErrorMessage } from '../lib/errors';
import { RewardFlight, type FlightCurrency, type RewardFlightSpec } from './RewardFlight';
import { ScaleInModal } from '../components/ScaleInModal';
import {
  formatCountdown,
  nextResetMs,
  type Mission,
  type MissionsResult,
  type RewardItem,
} from './useDailyMissions';

interface Props {
  readonly result: MissionsResult;
  readonly onClose: () => void;
}

/**
 * Daily Missions modal — restyle v2 (game-ready mockup).
 *
 * The visual design is ported from the operator's CSS mockup; the styling
 * lives in a single scoped <style> block (every selector prefixed with the
 * `.dmx` root so nothing leaks into the global/Tailwind cascade). The mockup's
 * inline SVGs are swapped for our REAL webp art — mission-type rarity badges,
 * the chest, coin/gem, and the header dice — per the existing asset set.
 * Mission Points + the chest-milestone track stay gated behind CHESTS_ENABLED.
 *
 * Data + behaviour (claim / claim-all / reroll / streak / countdown / reward
 * flights) are unchanged — only the markup + CSS are new.
 */
const DESIGN_W = 1536;
const DESIGN_H = 812;

export function DailyMissionsModal({ result, onClose }: Props) {
  const { state, isLoading, error, refetch } = result;
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimingMissionId, setClaimingMissionId] = useState<string | null>(null);
  const [rerollingMissionId, setRerollingMissionId] = useState<string | null>(null);
  const [rerollConfirmId, setRerollConfirmId] = useState<string | null>(null);
  // The most-recently-rerolled mission floats to the top of the list so the
  // replacement is always visible up top (not buried mid-list). reroll_mission
  // updates the row in place, so the id is stable across the refetch.
  const [rerolledTopId, setRerolledTopId] = useState<string | null>(null);
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  const [howOpen, setHowOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [flights, setFlights] = useState<readonly RewardFlightSpec[]>([]);
  const nextFlightIdRef = useRef(0);

  const spawnFlights = (currency: FlightCurrency, count: number, srcEl: HTMLElement | null) => {
    const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`);
    if (!target || !srcEl) return;
    const srcRect = srcEl.getBoundingClientRect();
    const dstRect = target.getBoundingClientRect();
    const startX = srcRect.left + srcRect.width / 2;
    const startY = srcRect.top + srcRect.height / 2;
    const endX = dstRect.left + dstRect.width / 2;
    const endY = dstRect.top + dstRect.height / 2;
    const additions: RewardFlightSpec[] = [];
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
      });
    }
    setFlights((prev) => [...prev, ...additions]);
  };
  const removeFlight = (id: number) => setFlights((prev) => prev.filter((f) => f.id !== id));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !claimingMissionId && !rerollingMissionId) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, claimingMissionId, rerollingMissionId]);

  const missionsList = state?.missions ?? [];
  const dailies = useMemo(() => missionsList.filter((m) => m.period === 'daily'), [missionsList]);
  const orderedDailies = useMemo(
    () => [...dailies].sort((a, b) => Number(b.id === rerolledTopId) - Number(a.id === rerolledTopId)),
    [dailies, rerolledTopId],
  );
  const weeklies = useMemo(() => missionsList.filter((m) => m.period === 'weekly').slice(0, 2), [missionsList]);
  const claimableCount = useMemo(
    () => dailies.filter((m) => m.completed_at && !m.claimed_at).length,
    [dailies],
  );
  const weeklyClaimable = useMemo(
    () => weeklies.some((m) => m.completed_at && !m.claimed_at),
    [weeklies],
  );

  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const s = Math.min(1, (window.innerWidth * 0.98) / DESIGN_W, (window.innerHeight * 0.96) / DESIGN_H);
      setScale(s);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const countdownMs = useMemo(() => {
    void now;
    return nextResetMs(state);
  }, [state, now]);

  const rerollsLeft = state ? Math.max(0, state.reroll.daily_cap - state.reroll.rerolls_today) : 0;
  const canRerollAny = rerollsLeft > 0;
  const rerollCost = state?.reroll.next_cost ?? null;

  const handleClaim = async (missionId: string, srcEl: HTMLElement | null) => {
    setClaimingMissionId(missionId);
    setActionError(null);
    const mission = missionsList.find((m) => m.id === missionId);
    try {
      const { data, error: rpcErr } = await supabase.rpc('claim_mission', { p_mission_id: missionId });
      if (rpcErr) {
        setActionError(extractErrorMessage(rpcErr));
        return;
      }
      const credited = data as { credited_coins?: number; credited_gems?: number; credited_xp?: number };
      if (credited?.credited_coins) spawnFlights('coins', Math.min(8, Math.max(3, Math.ceil(credited.credited_coins / 75))), srcEl);
      if (credited?.credited_gems) spawnFlights('gems', Math.min(6, Math.max(2, credited.credited_gems)), srcEl);
      if (credited?.credited_xp) spawnFlights('xp', Math.min(5, Math.max(2, credited.credited_xp)), srcEl);
      if (!credited?.credited_coins && !credited?.credited_gems && !credited?.credited_xp && mission) {
        for (const r of mission.rewards) {
          if (r.reward_kind !== 'currency' || !r.currency_code) continue;
          if (r.currency_code === 'coins') spawnFlights('coins', Math.min(8, Math.max(3, Math.ceil(r.amount / 75))), srcEl);
          else if (r.currency_code === 'gems') spawnFlights('gems', Math.min(6, Math.max(2, r.amount)), srcEl);
          else if (r.currency_code === 'xp') spawnFlights('xp', Math.min(5, Math.max(2, r.amount)), srcEl);
        }
      }
      refetch();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setClaimingMissionId(null);
    }
  };

  const handleClaimAll = async () => {
    const claimables = dailies.filter((m) => m.completed_at && !m.claimed_at);
    for (const m of claimables) {
      const btn = document.querySelector<HTMLElement>('[data-claim-all-btn]');
      await handleClaim(m.id, btn);
    }
  };

  const handleReroll = async (missionId: string) => {
    setRerollingMissionId(missionId);
    setActionError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('reroll_mission', { p_mission_id: missionId });
      if (rpcErr) setActionError(extractErrorMessage(rpcErr));
      else {
        setRerolledTopId(missionId);
        setRerollConfirmId(null);
        refetch();
      }
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setRerollingMissionId(null);
    }
  };

  const handleClaimStreak = async () => {
    setActionError(null);
    const { error: rpcErr } = await supabase.rpc('claim_streak_chest');
    if (rpcErr) setActionError(extractErrorMessage(rpcErr));
    else refetch();
  };

  const daysDone = Math.min(7, state?.streak.current_streak_days ?? 0);
  const streakClaimable = (state?.streak.current_streak_days ?? 0) >= 7;

  return (
    <>
      <ScaleInModal closeOnBackdropClick={false} closeOnEscape={false}>
        <div className="dmx" style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
          <style>{DM_STYLES}</style>
          <main className="screen" aria-label="Daily Missions">
            <header className="topbar">
              <div className="brand-mark">
                <img src="/lobby/missions/dice-icon.webp" alt="" draggable={false} onError={hideImg} />
              </div>
              <div className="brand-copy">
                <h1 className="brand-title">Daily Missions</h1>
                <p className="brand-subtitle">Complete missions to earn epic rewards!</p>
              </div>
              <div className="header-spacer" />
              <section className="refresh-box">
                <div>
                  <div className="refresh-label">Refreshes in</div>
                  <div className="refresh-time">{formatCountdown(countdownMs)}</div>
                </div>
              </section>
              <button className="close-button" type="button" aria-label="Close" onClick={onClose}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            {isLoading && !state ? (
              <div className="dmx-status">Loading missions…</div>
            ) : error ? (
              <div className="dmx-status dmx-error">{error}</div>
            ) : !state ? (
              <div className="dmx-status">No missions today.</div>
            ) : (
              <section className="content">
                <section className="panel missions-panel">
                  <div className="mission-list">
                    {orderedDailies.map((m) => (
                      <MissionCard
                        key={m.id}
                        mission={m}
                        isClaiming={claimingMissionId === m.id}
                        canReroll={canRerollAny}
                        rerollCost={rerollCost}
                        onRerollClick={() => setRerollConfirmId(m.id)}
                        onClaim={(el) => handleClaim(m.id, el)}
                        onGo={onClose}
                      />
                    ))}
                    {dailies.length === 0 && (
                      <div className="dmx-empty">No active missions. Come back at midnight UTC.</div>
                    )}
                  </div>
                  {actionError && <div className="dmx-action-error">{actionError}</div>}
                  <div className="missions-footer">
                    <span className="compact-button rerolls">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M20 12a8 8 0 1 1-2.3-5.6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                        <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{rerollsLeft} left</span>
                    </span>
                    <button
                      className="compact-button claim-all"
                      type="button"
                      data-claim-all-btn
                      disabled={claimableCount === 0 || claimingMissionId !== null}
                      onClick={handleClaimAll}
                    >
                      {claimableCount > 0 ? `Claim All (${claimableCount})` : 'Claim All'}
                    </button>
                  </div>
                </section>

                <aside className="panel tabs-panel">
                  <nav className="tabs">
                    <button
                      className={`tab-button ${tab === 'daily' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setTab('daily')}
                    >
                      Daily
                    </button>
                    <button
                      className={`tab-button ${tab === 'weekly' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setTab('weekly')}
                    >
                      Weekly{weeklyClaimable && <i className="tab-dot" />}
                    </button>
                  </nav>

                  {tab === 'daily' ? (
                    <section className="streak-panel">
                      <div className="streak-header">
                        <h2 className="streak-title">Daily Streak</h2>
                        <div className="streak-days">
                          {state.streak.current_streak_days} day{state.streak.current_streak_days === 1 ? '' : 's'}
                        </div>
                        <button
                          className="dm-info-btn"
                          type="button"
                          aria-label="How it works"
                          aria-expanded={howOpen}
                          onClick={() => setHowOpen((v) => !v)}
                        >
                          i
                        </button>
                      </div>
                      <p className="streak-description">
                        Complete all daily missions every day. Hit 7 days to open the streak chest.
                      </p>

                      <div className="streak-track">
                        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                          <div className="track-day" key={day}>
                            <span>Day {day}</span>
                            {day === 7 ? (
                              <div className={`chest-node ${daysDone >= 7 ? 'is-lit' : ''}`}>
                                <img src="/lobby/missions/chest-3.webp" alt="" draggable={false} onError={hideImg} />
                              </div>
                            ) : (
                              <div
                                className={`day-node ${day <= daysDone ? 'is-done' : ''} ${day === daysDone + 1 ? 'is-current' : ''}`}
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="streak-rewards">
                        {state.streak_chest_rewards.map((r, i) => (
                          <div className="streak-reward-item" key={i}>
                            <RewardIcon reward={r} size="lg" />
                            <span>+{formatAmount(r.amount)}</span>
                          </div>
                        ))}
                        {streakClaimable ? (
                          <button className="streak-claim" type="button" onClick={handleClaimStreak}>
                            Claim
                          </button>
                        ) : (
                          <div className="to-go">{7 - daysDone} to go</div>
                        )}
                      </div>

                      {howOpen && (
                        <div className="dm-how-popover" role="dialog" aria-label="How it works">
                          <button className="dm-how-close" type="button" aria-label="Close" onClick={() => setHowOpen(false)}>
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                            </svg>
                          </button>
                          <h3 className="how-title">How it works</h3>
                          <div className="how-line">
                            <div className="how-icon">
                              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M12 3.2l2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.9 5.5-.8L12 3.2z" />
                              </svg>
                            </div>
                            <div>Finish every daily mission to advance your streak and bank the chest.</div>
                          </div>
                          <div className="how-line">
                            <div className="how-icon">
                              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M20 12a8 8 0 1 1-2.4-5.7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                                <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                            <div>Don’t like a mission? Reroll it — the first one each day is free.</div>
                          </div>
                        </div>
                      )}
                    </section>
                  ) : (
                    <section className="streak-panel weekly-tab">
                      {weeklies.length === 0 ? (
                        <div className="weekly-empty">
                          <img src="/lobby/missions/dice-icon.webp" alt="" draggable={false} onError={hideImg} />
                          <p>No weekly challenge active right now.</p>
                        </div>
                      ) : (
                        weeklies.map((m) => (
                          <WeeklyCard
                            key={m.id}
                            mission={m}
                            isClaiming={claimingMissionId === m.id}
                            onClaim={(el) => handleClaim(m.id, el)}
                            onGo={onClose}
                          />
                        ))
                      )}
                    </section>
                  )}
                </aside>
              </section>
            )}
          </main>
        </div>
      </ScaleInModal>

      {rerollConfirmId && state && (
        <RerollConfirmModal
          priceGems={state.reroll.next_cost ?? 0}
          isBusy={rerollingMissionId !== null}
          errorMessage={actionError}
          onConfirm={() => handleReroll(rerollConfirmId)}
          onCancel={() => {
            setRerollConfirmId(null);
            setActionError(null);
          }}
        />
      )}

      {flights.map((spec) => (
        <RewardFlight key={spec.id} spec={spec} onLanded={removeFlight} />
      ))}
    </>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function hideImg(e: SyntheticEvent<HTMLImageElement>) {
  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
}

/** Reroll confirmation popup — carnival/gold style matching BoardPurchaseModal,
 *  asking the player to confirm spending gems (or a free reroll). */
function RerollConfirmModal({
  priceGems,
  isBusy,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  readonly priceGems: number;
  readonly isBusy: boolean;
  readonly errorMessage: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const free = priceGems <= 0;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{
        background: 'radial-gradient(circle at center, rgba(92,48,14,0.35), rgba(0,0,0,0.78))',
        backdropFilter: 'blur(4px)',
        opacity: entered ? 1 : 0,
        transition: 'opacity 220ms ease',
      }}
    >
      <div
        className="relative text-center"
        style={{
          width: 'min(92vw, 26rem)',
          padding: 'clamp(1.6rem,5vmin,2.3rem) clamp(1.5rem,5vmin,2.6rem) clamp(1.4rem,4.5vmin,2rem)',
          borderRadius: '22px',
          background:
            'linear-gradient(rgba(255,255,255,0.22), transparent 26%), radial-gradient(circle at 50% 12%, #fff7bc 0%, #f7d374 34%, #dfa045 72%, #b96b1f 100%)',
          border: '5px solid #ffd057',
          color: '#4b2108',
          boxShadow:
            '0 0 0 2px #8a3d08, 0 0 0 6px #ffb321, 0 18px 36px rgba(0,0,0,0.6), inset 0 4px 0 rgba(255,255,255,0.7), inset 0 -8px 0 rgba(89,38,9,0.25), inset 0 0 45px rgba(95,43,8,0.22)',
          transformOrigin: 'center',
          transform: entered ? 'scale(1)' : 'scale(0.16)',
          opacity: entered ? 1 : 0,
          transition: 'transform 460ms cubic-bezier(0.2, 0.9, 0.2, 1.12), opacity 220ms ease',
          transitionDelay: entered ? '120ms' : '0ms',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          aria-label="Cancel"
          className="absolute z-10 grid place-items-center transition active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            right: '-1.1rem',
            top: '-1.1rem',
            width: '3.2rem',
            height: '3.2rem',
            borderRadius: '50%',
            border: '4px solid #ffe06c',
            background:
              'radial-gradient(circle at 35% 25%, #fff18b 0% 12%, #ffb229 13% 32%, #ef4c17 60%, #921707 100%)',
            color: '#fff2a5',
            fontSize: '2rem',
            fontWeight: 900,
            lineHeight: 1,
            textShadow: '0 3px 0 #8a1608',
            boxShadow:
              '0 6px 0 #6b2106, 0 12px 18px rgba(0,0,0,0.45), inset 0 3px 0 rgba(255,255,255,0.55)',
          }}
        >
          ×
        </button>

        <h2
          className="relative font-display whitespace-nowrap"
          style={{
            margin: 0,
            marginBottom: 'clamp(1rem,2.5vmin,1.4rem)',
            fontSize: 'clamp(1.2rem,4.2vmin,1.8rem)',
            fontWeight: 900,
            letterSpacing: '0.03em',
            color: '#5d3208',
            textShadow: '0 1px 0 rgba(255,251,222,0.8), 0 2px 2px rgba(255,247,200,0.3), 0 -1px 1px rgba(35,14,2,0.45)',
          }}
        >
          <span style={{ fontSize: '0.6em', margin: '0 0.5rem', color: '#8a5410' }}>✦</span>
          REROLL MISSION
          <span style={{ fontSize: '0.6em', margin: '0 0.5rem', color: '#8a5410' }}>✦</span>
        </h2>

        {!free && (
          <div
            className="relative mx-auto flex items-center justify-center"
            style={{
              width: 'min(82%, 18rem)',
              height: 'clamp(4.4rem,12vmin,6rem)',
              marginBottom: 'clamp(1rem,3vmin,1.5rem)',
              borderRadius: '18px',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.55), transparent 38%), radial-gradient(circle at center, #fff0a5 0%, #f6ca62 60%, #c88022 100%)',
              border: '4px solid #e39a19',
              boxShadow:
                '0 0 0 2px #ffdc60, 0 8px 14px rgba(0,0,0,0.35), inset 0 3px 0 rgba(255,255,255,0.65), inset 0 -5px 0 rgba(107,48,8,0.22)',
              gap: 'clamp(0.8rem,2.5vmin,1.5rem)',
            }}
          >
            <img
              src="/lobby/carousel/gem.webp"
              alt=""
              draggable={false}
              style={{
                width: 'clamp(2.6rem,7vmin,3.8rem)',
                height: 'clamp(2.6rem,7vmin,3.8rem)',
                objectFit: 'contain',
                filter: 'drop-shadow(0 6px 4px rgba(0,0,0,0.35)) drop-shadow(0 0 10px rgba(0,210,255,0.5))',
              }}
            />
            <span
              className="font-display tabular-nums"
              style={{
                fontSize: 'clamp(2.2rem,7vmin,3.4rem)',
                fontWeight: 900,
                color: '#3c1704',
                lineHeight: 1,
                textShadow: '0 2px 0 #fff3ad, 0 5px 6px rgba(0,0,0,0.28)',
              }}
            >
              {priceGems.toLocaleString()}
            </span>
          </div>
        )}

        <p
          className="relative font-bold"
          style={{
            margin: 0,
            marginBottom: 'clamp(1rem,2.5vmin,1.4rem)',
            fontSize: 'clamp(0.95rem,2.8vmin,1.25rem)',
            color: '#572607',
            textShadow: '0 1px 0 rgba(255,255,255,0.35)',
          }}
        >
          {free ? (
            'Reroll this mission for free?'
          ) : (
            <>
              Reroll this mission for{' '}
              <strong style={{ fontWeight: 900 }}>{priceGems.toLocaleString()} Gems?</strong>
            </>
          )}
        </p>

        {errorMessage ? (
          <div
            className="relative mx-auto"
            style={{
              maxWidth: '85%',
              marginBottom: 'clamp(0.8rem,2vmin,1.2rem)',
              borderRadius: '8px',
              border: '1px solid rgba(190,18,60,0.4)',
              background: '#fff1f1',
              padding: '0.5rem 0.75rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#9f1239',
            }}
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="relative flex justify-center" style={{ gap: 'clamp(1.5rem,5vmin,2.6rem)' }}>
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className="font-display transition active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              width: 'clamp(7rem,22vmin,9rem)',
              height: 'clamp(2.8rem,7vmin,3.4rem)',
              borderRadius: '9999px',
              border: '2px solid rgba(224,255,143,0.95)',
              color: '#132109',
              fontSize: 'clamp(1.2rem,3.6vmin,1.7rem)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textShadow: '0 1px 0 rgba(255,255,255,0.28)',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.74) 0%, rgba(191,255,88,0.86) 13%, transparent 39%), linear-gradient(180deg, #d6ff73 0%, #8cf244 40%, #20bd1f 68%, #07810d 100%)',
              boxShadow:
                '0 5px 0 #06450a, 0 13px 22px rgba(0,0,0,0.34), inset 0 2px 0 rgba(255,255,255,0.74), inset 0 -5px 0 rgba(0,78,5,0.34), 0 0 0 2px rgba(7,27,11,0.85)',
            }}
          >
            {isBusy ? '…' : 'Yes'}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="font-display transition active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              width: 'clamp(7rem,22vmin,9rem)',
              height: 'clamp(2.8rem,7vmin,3.4rem)',
              borderRadius: '9999px',
              border: '2px solid rgba(220,220,220,0.95)',
              color: '#1a1a1a',
              fontSize: 'clamp(1.2rem,3.6vmin,1.7rem)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textShadow: '0 1px 0 rgba(255,255,255,0.4)',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(210,210,210,0.86) 13%, transparent 39%), linear-gradient(180deg, #e2e2e2 0%, #a8a8a8 40%, #6a6a6a 68%, #3a3a3a 100%)',
              boxShadow:
                '0 5px 0 #1f1f1f, 0 13px 22px rgba(0,0,0,0.34), inset 0 2px 0 rgba(255,255,255,0.7), inset 0 -5px 0 rgba(0,0,0,0.28), 0 0 0 2px rgba(15,15,15,0.85)',
            }}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}

function MissionCard({
  mission,
  isClaiming,
  canReroll,
  rerollCost,
  onRerollClick,
  onClaim,
  onGo,
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly canReroll: boolean;
  readonly rerollCost: number | null;
  readonly onRerollClick: () => void;
  readonly onClaim: (el: HTMLElement | null) => void;
  readonly onGo: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const isActive = !isCompleted && !isClaimed;
  const pct = Math.min(100, Math.round((mission.progress / Math.max(1, mission.resolved_goal)) * 100));
  // Only COMMON missions can be rerolled — rare/epic are fixed.
  const showReroll = isActive && canReroll && rerollCost !== null && mission.rarity === 'common';
  const rerollFree = rerollCost === 0;

  return (
    <article className={`mission-card is-${mission.rarity} ${isCompleted ? 'is-complete' : ''}`}>
      <div className="mission-badge">
        <img src={`/lobby/missions/badge-${mission.rarity}.webp`} alt={`${mission.rarity} mission`} draggable={false} onError={hideImg} />
      </div>

      <div className="mission-copy">
        <p className="mission-description">{mission.subtitle || mission.title}</p>
        <div className="progress-line">
          <div className="progress-track">
            <div className="progress-fill" style={{ '--progress': pct } as CSSProperties} />
          </div>
          <div className="progress-count">
            {mission.progress.toLocaleString()} / {mission.resolved_goal.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="mission-separator" aria-hidden="true" />

      <div className="mission-reward">
        <div>
          <div className="reward-title">Reward</div>
          <div className="reward-icons">
            {mission.rewards.map((r, i) => (
              <div className="reward-item" key={i}>
                <RewardIcon reward={r} size="md" />
                <div className="reward-amount">+{formatAmount(r.amount)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mission-controls">
          {isActive ? (
            <button className="go-button" type="button" onClick={onGo}>
              Go
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : isClaimed ? (
            <button className="go-button is-claimed" type="button" disabled>
              Claimed
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12.5l4.4 4.4L19 7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <button
              ref={btnRef}
              className="go-button"
              type="button"
              disabled={isClaiming}
              onClick={() => onClaim(btnRef.current)}
            >
              {isClaiming ? '…' : 'Claim'}
            </button>
          )}

          {showReroll && (
            <button type="button" className="reroll-note" onClick={onRerollClick}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.4-5.7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{rerollFree ? 'Reroll free' : `Reroll · ${rerollCost}💎`}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function WeeklyCard({
  mission,
  isClaiming,
  onClaim,
  onGo,
}: {
  readonly mission: Mission;
  readonly isClaiming: boolean;
  readonly onClaim: (el: HTMLElement | null) => void;
  readonly onGo: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const isCompleted = !!mission.completed_at && !mission.claimed_at;
  const isClaimed = !!mission.claimed_at;
  const isActive = !isCompleted && !isClaimed;
  const pct = Math.min(100, Math.round((mission.progress / Math.max(1, mission.resolved_goal)) * 100));
  return (
    <article className={`weekly-card is-${mission.rarity} ${isCompleted ? 'is-complete' : ''}`}>
      <div className="wk-badge">
        <img src={`/lobby/missions/badge-${mission.rarity}.webp`} alt={`${mission.rarity} mission`} draggable={false} onError={hideImg} />
      </div>
      <h3 className="wk-title">{mission.title}</h3>
      {mission.subtitle && <p className="wk-desc">{mission.subtitle}</p>}
      <div className="wk-progress">
        <div className="progress-track">
          <div className="progress-fill" style={{ '--progress': pct } as CSSProperties} />
        </div>
        <div className="progress-count">
          {mission.progress.toLocaleString()} / {mission.resolved_goal.toLocaleString()}
        </div>
      </div>
      <div className="wk-rewards">
        {mission.rewards.map((r, i) => (
          <div className="streak-reward-item" key={i}>
            <RewardIcon reward={r} size="lg" />
            <span>+{formatAmount(r.amount)}</span>
          </div>
        ))}
      </div>
      {isActive ? (
        <button className="go-button wk-go" type="button" onClick={onGo}>
          Go
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : isClaimed ? (
        <button className="go-button is-claimed wk-go" type="button" disabled>
          Claimed
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12.5l4.4 4.4L19 7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <button ref={btnRef} className="go-button wk-go" type="button" disabled={isClaiming} onClick={() => onClaim(btnRef.current)}>
          {isClaiming ? '…' : 'Claim'}
        </button>
      )}
    </article>
  );
}

function XpHex({ size }: { readonly size: 'md' | 'lg' }) {
  const h = size === 'lg' ? 48 : 38;
  return (
    <svg viewBox="0 0 100 110" style={{ height: h, width: 'auto', filter: 'drop-shadow(0 4px 5px rgba(0,0,0,0.4))' }} aria-hidden="true">
      <defs>
        <linearGradient id="dm-xp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#581c87" />
        </linearGradient>
        <linearGradient id="dm-xp-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <polygon points="50,3 96,28 96,82 50,107 4,82 4,28" fill="url(#dm-xp-rim)" />
      <polygon points="50,11 88,33 88,77 50,99 12,77 12,33" fill="url(#dm-xp-fill)" />
      <text x="50" y="68" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="34" fill="white" stroke="rgba(0,0,0,0.35)" strokeWidth="1">XP</text>
    </svg>
  );
}

function RewardIcon({ reward, size }: { readonly reward: RewardItem; readonly size: 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'ri ri-lg' : 'ri';
  if (reward.reward_kind === 'currency') {
    if (reward.currency_code === 'xp') return <XpHex size={size} />;
    const src =
      reward.currency_code === 'coins'
        ? '/lobby/icons/gold-coin.webp'
        : reward.currency_code === 'gems'
          ? '/lobby/icons/gem.webp'
          : null;
    if (src) return <img className={cls} src={src} alt="" draggable={false} onError={hideImg} />;
  }
  return <div className={`xp-token ${cls}`}>?</div>;
}

function formatAmount(n: number): string {
  // Full number with thousands separators (e.g. 11100 -> "11,100"). Easier to
  // read than K-abbreviation for the larger cashback coin rewards.
  return n.toLocaleString('en-US');
}

/* ───────────────────────── scoped styles ───────────────────────── */
// Ported from the operator's mockup. Every selector is prefixed with `.dmx`
// so it never leaks into the global / Tailwind cascade. Inline SVG art from the
// mockup is replaced by our webp <img> in the markup above; sizing rules here
// target those images. The MP / chest-milestone strip is intentionally NOT
// rendered in this design (chests stay hidden, per the product decision).

const DM_STYLES = `
.dmx { --gold:#ffd864; --green:#80e45d; --blue:#32baff; --purple:#b85cff; --muted:#b8c2e4;
  font-synthesis:none; color:#f7f8ff;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
.dmx *{ box-sizing:border-box; }
.dmx button{ font:inherit; color:inherit; border:0; cursor:pointer; }
.dmx .screen{ position:relative; width:${DESIGN_W}px; height:${DESIGN_H}px; border-radius:24px; overflow:hidden;
  padding:26px 28px 28px;
  background:linear-gradient(rgba(10,26,51,.55),rgba(10,26,51,.55)),radial-gradient(38% 48% at 18% 22%,rgba(56,189,248,.55),transparent 70%),radial-gradient(42% 52% at 84% 16%,rgba(250,204,21,.45),transparent 70%),radial-gradient(48% 58% at 78% 86%,rgba(139,92,246,.5),transparent 70%),radial-gradient(44% 54% at 22% 88%,rgba(16,185,129,.48),transparent 70%),#03070d;
  border:1px solid rgba(116,168,255,.38);
  box-shadow:0 30px 90px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.045),inset 0 0 90px rgba(54,104,255,.16);
  isolation:isolate; }
.dmx .screen::before{ display:none; }
.dmx .topbar{ height:84px; display:flex; align-items:center; gap:18px; margin-bottom:12px; }
.dmx .brand-mark{ flex:0 0 auto; display:grid; place-items:center; }
.dmx .brand-mark img{ width:72px; height:72px; object-fit:contain; filter:drop-shadow(0 6px 10px rgba(0,0,0,.5)); }
.dmx .brand-copy{ min-width:0; }
.dmx .brand-title{ margin:0; font-family:inherit; font-size:42px;
  line-height:.92; letter-spacing:.03em; color:#fff7dc; text-transform:uppercase;
  text-shadow:0 2px 0 rgba(69,40,8,.85),0 7px 18px rgba(0,0,0,.48); }
.dmx .brand-subtitle{ margin:6px 0 0; color:#cbd4fa; font-size:17px; letter-spacing:.01em; }
.dmx .header-spacer{ flex:1; }
.dmx .refresh-box{ width:214px; height:72px; display:grid; place-items:center; border-radius:14px;
  background:linear-gradient(180deg,rgba(17,35,83,.96),rgba(8,16,42,.92));
  border:1px solid rgba(124,168,255,.42); box-shadow:inset 0 0 18px rgba(50,115,255,.12),0 12px 24px rgba(0,0,0,.22); }
.dmx .refresh-label{ color:var(--gold); font-size:14px; font-weight:900; letter-spacing:.04em; text-transform:uppercase; }
.dmx .refresh-time{ margin-top:4px; color:#fff; font-size:22px; font-weight:900; letter-spacing:.03em; font-variant-numeric:tabular-nums; }
.dmx .close-button{ width:68px; height:68px; border-radius:50%; display:grid; place-items:center;
  background:radial-gradient(circle at 34% 26%,rgba(255,255,255,.2),transparent 22%),linear-gradient(180deg,#24283a,#070913 68%);
  border:2px solid rgba(255,211,91,.88); color:#ffe084;
  box-shadow:0 12px 22px rgba(0,0,0,.4),inset 0 0 0 1px rgba(255,255,255,.08); transition:filter .12s ease, transform .12s ease; }
.dmx .close-button:hover{ filter:brightness(1.1); } .dmx .close-button:active{ transform:scale(.95); }
.dmx .close-button svg{ width:32px; height:32px; }
.dmx .dmx-status{ padding:60px 0; text-align:center; color:rgba(255,228,160,.7); font-size:18px; }
.dmx .dmx-error{ color:#ffb3b3; }
.dmx .content{ height:calc(100% - 96px); display:grid; grid-template-columns:minmax(760px,1.52fr) minmax(500px,1fr); gap:20px; }
.dmx .panel{ min-width:0; min-height:0; border-radius:22px;
  background:linear-gradient(180deg,rgba(8,21,56,.78),rgba(3,10,29,.82));
  border:1px solid rgba(121,161,255,.24); box-shadow:inset 0 0 0 1px rgba(255,255,255,.026),0 20px 42px rgba(0,0,0,.24); }
.dmx .missions-panel{ padding:20px 20px 16px; display:flex; flex-direction:column; min-height:0; }
.dmx .missions-footer{ margin-top:auto; display:flex; align-items:center; justify-content:flex-end; gap:14px; padding-top:12px; }
.dmx .panel-heading{ height:44px; display:flex; align-items:center; gap:14px; margin-bottom:14px; flex:0 0 auto; }
.dmx .panel-title{ margin:0; font-size:25px; line-height:1; font-weight:950; letter-spacing:.035em; text-transform:uppercase; text-shadow:0 3px 8px rgba(0,0,0,.42); }
.dmx .panel-actions{ margin-left:auto; display:flex; gap:14px; align-items:center; }
.dmx .compact-button{ height:36px; min-width:96px; padding:0 16px; border-radius:9px; font-size:16px; font-weight:950;
  letter-spacing:.02em; display:inline-flex; align-items:center; justify-content:center; gap:7px;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 8px 16px rgba(0,0,0,.24); }
.dmx .compact-button.rerolls{ background:linear-gradient(180deg,#11571f,#082f12); border:1px solid rgba(95,255,115,.55); color:#a8ff88; }
.dmx .compact-button.claim-all{ background:linear-gradient(180deg,#4f5668,#2d3342); border:1px solid rgba(179,190,219,.34); color:#cbd2e5; transition:filter .12s ease; }
.dmx .compact-button.claim-all:not(:disabled):hover{ filter:brightness(1.12); }
.dmx .compact-button.claim-all:disabled{ opacity:.5; cursor:not-allowed; }
.dmx .mission-list{ display:grid; gap:8px; align-content:start; min-height:0; }
.dmx .mission-card{ --accent:var(--green); --accent-rgb:128,228,93; --fill:#7ef043; --fill-b:#c9ff7d;
  --card-start:#071f17; --card-mid:#0d3a24; --card-end:#071812;
  position:relative; height:134px; border-radius:16px; display:grid;
  grid-template-columns:138px minmax(160px,1fr) 1px 318px; align-items:center; padding:6px 20px 6px 14px;
  background:radial-gradient(circle at 12% 50%,rgba(var(--accent-rgb),.18),transparent 42%),
    linear-gradient(90deg,var(--card-start),var(--card-mid) 48%,var(--card-end));
  border:1px solid rgba(var(--accent-rgb),.82);
  box-shadow:0 10px 22px rgba(0,0,0,.25),inset 0 0 18px rgba(var(--accent-rgb),.07),inset 0 1px 0 rgba(255,255,255,.09);
  overflow:hidden; }
.dmx .mission-card::before{ content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.09),transparent 34%,rgba(0,0,0,.10)),
    linear-gradient(115deg,transparent 0 45%,rgba(255,255,255,.055) 50%,transparent 57%); opacity:.9; }
.dmx .mission-card>*{ position:relative; z-index:1; }
.dmx .mission-card.is-common{ --accent:#80e45d; --accent-rgb:128,228,93; --fill:#7ef043; --fill-b:#c9ff7d; --card-start:#061f16; --card-mid:#0d3a25; --card-end:#081b14; }
.dmx .mission-card.is-rare{ --accent:#2abfff; --accent-rgb:42,191,255; --fill:#23c4ff; --fill-b:#7be7ff; --card-start:#061a33; --card-mid:#0a345d; --card-end:#07172c; }
.dmx .mission-card.is-epic{ --accent:#bd59ff; --accent-rgb:189,89,255; --fill:#b445ff; --fill-b:#ef71ff; --card-start:#23103e; --card-mid:#3b1762; --card-end:#170927; }
.dmx .mission-badge{ width:116px; height:122px; justify-self:center; display:grid; place-items:center; }
.dmx .mission-badge img{ width:116px; height:122px; object-fit:contain; filter:drop-shadow(0 6px 8px rgba(0,0,0,.5)); }
.dmx .mission-copy{ min-width:0; padding:0 18px 0 10px; display:flex; flex-direction:column; justify-content:center; }
.dmx .mission-description{ margin:0 0 16px; font-size:24px; line-height:1.2; font-weight:600; color:#eef1ff;
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.dmx .progress-line{ display:flex; align-items:center; gap:14px; max-width:300px; }
.dmx .progress-track{ position:relative; flex:1; height:15px; border-radius:999px; background:rgba(2,6,15,.72);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.11),0 4px 8px rgba(0,0,0,.18); overflow:hidden; }
.dmx .progress-fill{ position:absolute; inset:2px auto 2px 2px; width:calc(var(--progress) * 1%); border-radius:inherit;
  background:linear-gradient(180deg,rgba(255,255,255,.45),transparent 45%),linear-gradient(90deg,var(--fill),var(--fill-b));
  box-shadow:0 0 11px rgba(var(--accent-rgb),.66),inset 0 -2px 0 rgba(0,0,0,.18); transition:width .4s ease; }
.dmx .progress-count{ min-width:62px; display:inline-flex; justify-content:center; padding:4px 9px; border-radius:8px;
  background:rgba(0,0,0,.25); color:#fff; font-weight:950; font-size:16px; letter-spacing:.02em; font-variant-numeric:tabular-nums; }
.dmx .mission-card.is-complete .progress-count{ color:#9cff75; }
.dmx .mission-separator{ height:84px; background:linear-gradient(180deg,transparent,rgba(255,255,255,.22),transparent); }
.dmx .mission-reward{ padding-left:20px; display:grid; grid-template-columns:minmax(110px,1fr) 124px; gap:26px; align-items:center; }
.dmx .reward-title{ margin-bottom:8px; color:#c9d3f4; font-size:13px; font-weight:850; letter-spacing:.06em; text-transform:uppercase; }
.dmx .reward-icons{ display:flex; align-items:center; gap:18px; }
.dmx .reward-item{ display:grid; justify-items:center; gap:3px; min-width:45px; }
.dmx .ri{ width:38px; height:38px; object-fit:contain; filter:drop-shadow(0 5px 5px rgba(0,0,0,.35)); }
.dmx .reward-amount{ font-size:17px; font-weight:950; color:#fff; letter-spacing:.02em; }
.dmx .mission-controls{ display:grid; justify-items:center; gap:8px; }
.dmx .go-button{ width:122px; height:52px; border-radius:12px; display:inline-flex; align-items:center; justify-content:center; gap:8px;
  background:linear-gradient(180deg,#27db74,#079044); border:0;
  box-shadow:inset 0 2px 0 rgba(255,255,255,.22),0 8px 18px rgba(0,0,0,.35);
  font-family:"Segoe UI",Inter,system-ui,sans-serif; color:#fff; font-size:24px; font-weight:900; letter-spacing:.02em; text-transform:uppercase;
  text-shadow:0 2px 3px rgba(0,0,0,.55); transition:transform .12s ease,filter .12s ease; }
.dmx .go-button:not(:disabled):hover{ filter:brightness(1.1); }
.dmx .go-button:not(:disabled):active{ transform:translateY(1px); }
.dmx .go-button svg{ width:19px; height:19px; }
.dmx .go-button.is-purple{ background:linear-gradient(180deg,rgba(255,255,255,.22),transparent 36%),linear-gradient(180deg,#bc61ff,#6b24c5); border-color:rgba(223,152,255,.92); }
.dmx .go-button.is-claimed{ background:linear-gradient(180deg,rgba(255,255,255,.13),transparent 36%),linear-gradient(180deg,#386db8,#1c3a67);
  border-color:rgba(108,164,255,.62); color:#dce9ff; font-family:inherit; font-size:18px; letter-spacing:.02em;
  box-shadow:0 7px 12px rgba(0,0,0,.27),inset 0 1px 0 rgba(255,255,255,.18); cursor:default; }
.dmx .go-button.is-claimed svg{ width:21px; height:21px; color:#46e6ff; filter:drop-shadow(0 0 4px rgba(70,230,255,.55)); }
.dmx .reroll-note{ display:inline-flex; align-items:center; gap:6px; color:#c6cfed; font-size:14px; font-weight:700; white-space:nowrap; background:none; transition:color .12s ease; }
.dmx .reroll-note:hover{ color:var(--gold); } .dmx .reroll-note svg{ width:16px; height:16px; color:var(--gold); }
.dmx .reroll-confirm{ display:inline-flex; align-items:center; gap:6px; }
.dmx .reroll-confirm .rc-no{ width:26px; height:26px; border-radius:7px; background:#2a1230; color:#e59ab8; border:1px solid rgba(217,76,255,.4); font-size:13px; }
.dmx .reroll-confirm .rc-yes{ height:26px; padding:0 10px; border-radius:7px; background:linear-gradient(180deg,#5be52a,#1d8300); color:#fff; font-size:12px; font-weight:900; border:1px solid rgba(177,255,135,.7); }
.dmx .dmx-empty,.dmx .dmx-action-error{ border-radius:10px; padding:14px; text-align:center; font-size:14px; }
.dmx .dmx-empty{ background:rgba(29,36,96,.6); color:#c6b7d8; }
.dmx .dmx-action-error{ margin-top:10px; background:rgba(80,20,20,.5); color:#ffb3b3; }
.dmx .tabs-panel{ padding:0 16px 16px; display:grid; grid-template-rows:62px 1fr; }
.dmx .tabs{ display:grid; grid-template-columns:1fr 1fr; gap:10px; align-self:end; }
.dmx .tab-button{ position:relative; height:56px; border-radius:15px 15px 0 0; background:rgba(5,12,35,.74);
  border:1px solid rgba(116,160,255,.24); border-bottom:0; color:rgba(222,228,252,.56); font-size:22px; font-weight:950;
  letter-spacing:.05em; text-transform:uppercase; box-shadow:inset 0 1px 0 rgba(255,255,255,.04); }
.dmx .tab-button.is-active{ color:#fff; background:linear-gradient(180deg,rgba(43,120,255,.96),rgba(23,55,171,.94));
  border-color:rgba(94,168,255,.85); box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 0 20px rgba(50,120,255,.24); }
.dmx .tab-dot{ position:absolute; top:10px; right:18px; width:11px; height:11px; border-radius:50%; background:#e9482f; border:1px solid #ff9d6a; box-shadow:0 0 8px rgba(255,75,45,.7); }
.dmx .streak-panel{ position:relative; border-radius:0 0 18px 18px; border:1px solid rgba(116,160,255,.33);
  background:radial-gradient(circle at 82% 16%,rgba(41,92,203,.22),transparent 42%),linear-gradient(180deg,rgba(8,19,52,.92),rgba(2,8,25,.9));
  box-shadow:0 18px 42px rgba(0,0,0,.42),inset 0 0 0 1px rgba(255,255,255,.025); padding:28px 30px 26px; min-height:0; display:flex; flex-direction:column; gap:22px; }
.dmx .streak-header{ display:flex; align-items:center; gap:16px; }
.dmx .streak-title{ margin:0; font-size:31px; line-height:1; font-weight:950; letter-spacing:.035em; text-transform:uppercase; text-shadow:0 3px 8px rgba(0,0,0,.42); }
.dmx .streak-days{ height:38px; display:inline-flex; align-items:center; padding:0 14px; border-radius:9px;
  background:rgba(12,37,95,.78); border:1px solid rgba(50,129,255,.64); color:#5db4ff; font-size:20px; font-weight:950; white-space:nowrap; }
.dmx .dm-info-btn{ margin-left:auto; width:36px; height:36px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center;
  background:rgba(12,37,95,.82); border:1px solid rgba(50,129,255,.64); color:#5db4ff; font-family:Georgia,serif; font-style:italic; font-size:22px; font-weight:900; line-height:1; transition:filter .12s ease; }
.dmx .dm-info-btn:hover{ filter:brightness(1.25); }
.dmx .dm-how-popover{ position:absolute; top:74px; right:24px; z-index:6; width:380px; max-width:82%;
  border-radius:14px; padding:18px 18px 18px; background:linear-gradient(180deg,#11214f,#070f29);
  border:1px solid rgba(119,155,238,.45); box-shadow:0 22px 46px rgba(0,0,0,.62); }
.dmx .dm-how-popover .how-line{ font-size:16px; }
.dmx .dm-how-popover .how-line + .how-line{ margin-top:12px; }
.dmx .dm-how-close{ position:absolute; top:8px; right:9px; width:28px; height:28px; display:grid; place-items:center; background:none; color:#9fb0d8; }
.dmx .dm-how-close svg{ width:18px; height:18px; }
.dmx .streak-description{ margin:-2px 0 0; color:#dde4ff; font-size:20px; line-height:1.4; }
.dmx .streak-track{ position:relative; display:grid; grid-template-columns:repeat(7,1fr); align-items:start; height:120px; flex:0 0 120px; }
.dmx .streak-track::before{ content:""; position:absolute; left:7%; right:7%; top:56px; height:5px; border-radius:999px;
  background:linear-gradient(90deg,rgba(72,97,142,.9),rgba(107,114,137,.78)); box-shadow:inset 0 1px 0 rgba(255,255,255,.08); }
.dmx .track-day{ position:relative; z-index:1; display:grid; justify-items:center; gap:10px; color:#dce3ff; font-size:14px; font-weight:900; letter-spacing:.035em; text-transform:uppercase; }
.dmx .day-node{ width:48px; height:48px; border-radius:50%;
  background:radial-gradient(circle at 40% 32%,rgba(255,255,255,.13),transparent 24%),linear-gradient(180deg,#17223c,#0a1021);
  border:4px solid rgba(116,121,139,.82); box-shadow:0 6px 10px rgba(0,0,0,.28),inset 0 0 0 1px rgba(255,255,255,.035); }
.dmx .day-node.is-done{ border-color:#5ee27a; background:radial-gradient(circle at 40% 32%,rgba(255,255,255,.2),transparent 26%),linear-gradient(180deg,#39c45a,#15772f);
  box-shadow:0 0 14px rgba(73,255,55,.4),inset 0 0 0 1px rgba(255,255,255,.1); }
.dmx .day-node.is-current{ border-color:#2fc9ff; box-shadow:0 0 0 4px rgba(47,201,255,.13),0 0 22px rgba(47,201,255,.72),inset 0 0 12px rgba(47,201,255,.18); }
@media (prefers-reduced-motion: no-preference){ .dmx .day-node.is-current{ animation:dmxDayPulse 2.2s ease-in-out infinite; } }
@keyframes dmxDayPulse{
  0%,100%{ box-shadow:0 0 0 4px rgba(47,201,255,.13),0 0 20px rgba(47,201,255,.72),inset 0 0 12px rgba(47,201,255,.18); }
  50%{ box-shadow:0 0 0 8px rgba(47,201,255,.10),0 0 34px rgba(47,201,255,1),inset 0 0 15px rgba(47,201,255,.28); } }
.dmx .chest-node{ width:58px; height:58px; border-radius:12px; display:grid; place-items:center;
  background:radial-gradient(circle at 50% 0%,rgba(255,216,100,.18),transparent 44%),linear-gradient(180deg,#241032,#12091c);
  border:2px solid rgba(255,216,100,.92); box-shadow:0 0 18px rgba(255,177,42,.32),inset 0 0 12px rgba(178,87,255,.22); }
.dmx .chest-node.is-lit{ animation:dmxPulse 1.6s ease-in-out infinite; }
@keyframes dmxPulse{ 0%,100%{ box-shadow:0 0 18px rgba(255,177,42,.32),inset 0 0 12px rgba(178,87,255,.22); } 50%{ box-shadow:0 0 28px rgba(255,200,70,.7),inset 0 0 14px rgba(178,87,255,.3); } }
.dmx .chest-node img{ width:50px; height:50px; object-fit:contain; }
.dmx .streak-rewards{ height:118px; flex:0 0 118px; border-radius:16px; display:flex; align-items:center; gap:36px; padding:0 28px;
  background:radial-gradient(circle at 18% 30%,rgba(54,118,255,.18),transparent 46%),linear-gradient(180deg,rgba(22,39,88,.86),rgba(11,20,49,.9));
  border:1px solid rgba(119,155,238,.34); box-shadow:inset 0 0 0 1px rgba(255,255,255,.035),0 10px 20px rgba(0,0,0,.18); }
.dmx .streak-reward-item{ min-width:58px; display:grid; justify-items:center; gap:5px; font-weight:950; color:#fff; }
.dmx .ri-lg{ width:54px; height:54px; filter:drop-shadow(0 6px 6px rgba(0,0,0,.36)); }
.dmx .streak-reward-item span{ font-size:22px; }
.dmx .to-go{ margin-left:auto; color:#55b0ff; font-size:18px; font-weight:950; white-space:nowrap; }
.dmx .streak-claim{ margin-left:auto; height:44px; padding:0 22px; border-radius:11px; font-size:18px; font-weight:950; text-transform:uppercase;
  background:linear-gradient(180deg,#ffd864,#bf8124); color:#3a1f08; border:1px solid rgba(255,230,140,.8); box-shadow:0 8px 14px rgba(0,0,0,.3); }
.dmx .how-panel{ align-self:stretch; margin-top:auto; border-radius:16px; padding:17px 22px; background:rgba(2,9,27,.44); border:1px solid rgba(119,155,238,.22); box-shadow:inset 0 0 0 1px rgba(255,255,255,.02); }
.dmx .how-title{ margin:0 0 12px; font-size:17px; font-weight:950; letter-spacing:.07em; text-transform:uppercase; }
.dmx .how-line{ display:grid; grid-template-columns:28px 1fr; gap:12px; align-items:center; color:#d3d9f1; font-size:15px; line-height:1.35; }
.dmx .how-line + .how-line{ margin-top:10px; }
.dmx .how-icon{ width:28px; height:28px; border-radius:50%; display:grid; place-items:center;
  background:radial-gradient(circle at 40% 28%,rgba(255,255,255,.28),transparent 24%),linear-gradient(180deg,#548cff,#1658d6);
  box-shadow:0 5px 10px rgba(0,0,0,.26),inset 0 0 0 1px rgba(255,255,255,.16); }
.dmx .how-icon svg{ width:16px; height:16px; color:#fff; }
.dmx .xp-token{ display:grid; place-items:center; border-radius:9px;
  background:linear-gradient(180deg,rgba(255,255,255,.18),transparent 30%),linear-gradient(180deg,#b466ff,#7430d0);
  border:1px solid rgba(226,178,255,.72); box-shadow:inset 0 -4px 0 rgba(0,0,0,.16); color:#fff; font-weight:950; font-size:14px; letter-spacing:.02em; }
.dmx .ri-lg.xp-token{ font-size:17px; }
.dmx .weekly-tab{ border-radius:0 0 18px 18px; }
.dmx .weekly-card{ flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;
  gap:18px; border-radius:18px; padding:26px; position:relative; overflow:hidden;
  --accent-rgb:128,228,93; --fill:#7ef043; --fill-b:#c9ff7d; --card-mid:#0d3a25; --card-end:#081b14;
  background:radial-gradient(circle at 50% 0%,rgba(var(--accent-rgb),.22),transparent 54%),linear-gradient(180deg,var(--card-mid),var(--card-end));
  border:1px solid rgba(var(--accent-rgb),.82);
  box-shadow:0 14px 30px rgba(0,0,0,.32),inset 0 0 26px rgba(var(--accent-rgb),.08),inset 0 1px 0 rgba(255,255,255,.1); }
.dmx .weekly-card.is-rare{ --accent-rgb:42,191,255; --fill:#23c4ff; --fill-b:#7be7ff; --card-mid:#0a345d; --card-end:#07172c; }
.dmx .weekly-card.is-epic{ --accent-rgb:189,89,255; --fill:#b445ff; --fill-b:#ef71ff; --card-mid:#3b1762; --card-end:#170927; }
.dmx .wk-badge{ width:128px; height:138px; display:grid; place-items:center; }
.dmx .wk-badge img{ width:128px; height:138px; object-fit:contain; filter:drop-shadow(0 8px 10px rgba(0,0,0,.5)); }
.dmx .wk-title{ margin:0; font-family:inherit; font-size:30px; font-weight:800; line-height:1.12; color:#fffaf0; text-shadow:0 3px 8px rgba(0,0,0,.42); }
.dmx .wk-desc{ margin:0; font-size:17px; color:#d4daf1; max-width:86%; line-height:1.4; }
.dmx .wk-progress{ display:flex; align-items:center; gap:14px; width:min(440px,88%); }
.dmx .wk-rewards{ display:flex; align-items:center; justify-content:center; gap:44px; }
.dmx .wk-go{ width:210px; height:58px; margin-top:4px; }
.dmx .weekly-empty{ margin:auto; text-align:center; color:#c6cfed; }
.dmx .weekly-empty img{ width:60px; height:60px; object-fit:contain; opacity:.7; margin-bottom:10px; }
`;
