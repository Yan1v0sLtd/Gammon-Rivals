import { useCallback } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import type { Database } from '../../../../packages/shared/src/database';
import {
  useGetDailyBonusConfigsQuery,
  useGetDailyBonusStateQuery,
} from '../features/lobby/lobbyApi';

export type DailyBonusConfig = Database['public']['Tables']['daily_bonus_configs']['Row'];
export type UserDailyBonus = Database['public']['Tables']['user_daily_bonuses']['Row'];

export interface DailyBonusState {
  /** Sorted 1..7. May be empty before the fetch resolves. */
  readonly configs: readonly DailyBonusConfig[];
  /** Player's per-row state. null until fetched (or if guest / not signed in). */
  readonly userState: UserDailyBonus | null;
  /** True if a claim is available right now (in ET). */
  readonly canClaim: boolean;
  /** Which day the player will receive when they next claim (1..7). */
  readonly upcomingDay: number;
  /**
   * How many days the player has claimed in the CURRENT 7-day cycle.
   * 0 when the cycle is fresh (never claimed, or streak just reset).
   * 1..6 mid-streak. 7 only briefly — right after claiming day 7,
   * before the row's current_day rolls back to 1 and last_claim_date
   * stays "today". The modal uses this to render the green "Claimed"
   * ribbon on every day the player has already completed.
   */
  readonly daysClaimedInCurrentStreak: number;
  /** True while the initial fetch is in flight. */
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

/** Today's date in America/New_York as YYYY-MM-DD, computed in the browser. */
function todayET(): string {
  // sv-SE gives the ISO YYYY-MM-DD shape; the timeZone option does the
  // actual ET conversion. This matches the DB-side
  // `(now() at time zone 'America/New_York')::date`.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isYesterdayET(dateEt: string | null, today: string): boolean {
  if (!dateEt) return false;
  // Compare via Date math; both strings are YYYY-MM-DD which Date parses as UTC.
  // Adding/subtracting one day in UTC is safe since both anchors share the same TZ.
  const last = new Date(dateEt + 'T00:00:00Z').getTime();
  const todayMs = new Date(today + 'T00:00:00Z').getTime();
  return todayMs - last === 24 * 60 * 60 * 1000;
}

/** Mirror of the server-side streak logic so the modal can preview the day
 * the player is about to claim. The server is still authoritative — this is
 * just for UI highlighting. */
export function computeUpcomingDay(state: UserDailyBonus | null, today: string): number {
  if (!state) return 1;
  if (state.last_claim_date_et === today) return state.current_day; // already claimed today
  if (state.last_claim_date_et === null) return 1;
  if (isYesterdayET(state.last_claim_date_et, today)) return state.current_day;
  // Gap of 2+ days: streak resets.
  return 1;
}

/**
 * How many days has the player completed in the CURRENT cycle? Used
 * by the modal to render the green "Claimed" ribbon on previous-day
 * cards. Distinguishes between "current_day = 1 because they JUST
 * completed a 7-day cycle" (returns 7) and "current_day = 1 because
 * they're starting fresh / a new cycle" (returns 0).
 */
export function computeDaysClaimedInCurrentStreak(
  state: UserDailyBonus | null,
  today: string,
): number {
  if (!state || !state.last_claim_date_et) return 0;
  if (state.last_claim_date_et === today) {
    // They claimed today. The day they just received was the OLD
    // current_day; the server already rolled current_day forward
    // (or back to 1 if they just finished day 7).
    return state.current_day === 1 ? 7 : state.current_day - 1;
  }
  if (isYesterdayET(state.last_claim_date_et, today)) {
    // Streak alive. current_day is what they'll claim today;
    // current_day - 1 are the days already claimed this cycle.
    // current_day === 1 here means yesterday's claim completed a
    // cycle and today is the start of a fresh one — 0 days
    // claimed in this NEW cycle.
    return state.current_day - 1;
  }
  // Gap of 2+ days: streak reset, no days claimed in current cycle.
  return 0;
}

export function useDailyBonus(): DailyBonusState {
  const { user } = useAuth();

  const configsQuery = useGetDailyBonusConfigsQuery(undefined, {
    skip: !isSupabaseConfigured,
  });
  const stateQuery = useGetDailyBonusStateQuery(user?.id ?? skipToken, {
    skip: !isSupabaseConfigured,
  });

  const configs = configsQuery.data ?? [];
  const userState = stateQuery.data ?? null;

  const today = todayET();
  const canClaim = userState !== null && userState.last_claim_date_et !== today;
  const upcomingDay = computeUpcomingDay(userState, today);
  const daysClaimedInCurrentStreak = computeDaysClaimedInCurrentStreak(userState, today);

  const { refetch: refetchConfigs, isUninitialized: configsNotStarted } = configsQuery;
  const { refetch: refetchState, isUninitialized: stateNotStarted } = stateQuery;
  const refetch = useCallback(() => {
    // RTK Query throws when refetching an entry that was never started
    // (skipped for an unconfigured client or a missing user id), so only
    // request the entries that are actually live.
    if (!configsNotStarted) void refetchConfigs();
    if (!stateNotStarted) void refetchState();
  }, [configsNotStarted, refetchConfigs, refetchState, stateNotStarted]);

  return {
    configs,
    userState,
    canClaim,
    upcomingDay,
    daysClaimedInCurrentStreak,
    // Active queries report isLoading from the first frame until the first
    // result settles; skipped ones report false, so this reads "the initial
    // fetch is in flight" without ever hanging on a skipped entry.
    isLoading: configsQuery.isLoading || stateQuery.isLoading,
    refetch,
  };
}
