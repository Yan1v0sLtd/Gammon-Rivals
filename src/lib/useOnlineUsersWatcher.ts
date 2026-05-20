import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Counts derived from the live `online-users` presence channel,
 * de-duplicated by profile_id. Multiple tabs from the same user
 * still count as one. Updates within a few seconds of any join/leave.
 */
export interface OnlineUserCounts {
  readonly total: number;
  readonly registered: number;
  readonly guests: number;
  /** Set of unique profile_ids currently announced as online. Exposed
   *  in case a caller wants to render per-user dots / a leaderboard. */
  readonly profileIds: ReadonlySet<string>;
}

const EMPTY: OnlineUserCounts = {
  total: 0,
  registered: 0,
  guests: 0,
  profileIds: new Set(),
};

/**
 * Subscribes to the shared `online-users` presence channel and exposes
 * de-duplicated counts. Used by the BO to render a live "X online"
 * widget — no polling, no extra DB calls.
 *
 * Pass `enabled = false` (default) to keep the subscription dormant
 * when the host UI isn't mounted; pass true while the operator is
 * looking at the relevant section.
 */
export function useOnlineUsersWatcher(enabled: boolean): OnlineUserCounts {
  const [counts, setCounts] = useState<OnlineUserCounts>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setCounts(EMPTY);
      return;
    }
    if (!isSupabaseConfigured) return;

    const channel = supabase.channel('online-users', {
      config: {
        presence: {
          // Watcher uses a random key so we don't clash with a real
          // user's presence row — and so the BO doesn't accidentally
          // self-count. The channel still surfaces everyone else's
          // tracked state.
          key: `watcher-${Math.random().toString(36).slice(2, 10)}`,
        },
      },
    });

    const recompute = () => {
      const state = channel.presenceState() as Record<
        string,
        Array<{ profile_id?: string; is_guest?: boolean }>
      >;
      const seen = new Map<string, boolean>(); // profile_id -> is_guest
      for (const presences of Object.values(state)) {
        for (const p of presences) {
          if (!p.profile_id) continue;
          // Keep the first sighting of a profile; if any tab is
          // signed-in (is_guest=false) treat the player as registered
          // — beats the corner case of a Google-signed-in user opening
          // an extra incognito guest tab.
          if (seen.has(p.profile_id) && seen.get(p.profile_id) === false) continue;
          seen.set(p.profile_id, p.is_guest ?? true);
        }
      }
      let registered = 0;
      let guests = 0;
      for (const isGuest of seen.values()) {
        if (isGuest) guests += 1;
        else registered += 1;
      }
      setCounts({
        total: seen.size,
        registered,
        guests,
        profileIds: new Set(seen.keys()),
      });
    };

    channel
      .on('presence', { event: 'sync' }, recompute)
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return counts;
}
