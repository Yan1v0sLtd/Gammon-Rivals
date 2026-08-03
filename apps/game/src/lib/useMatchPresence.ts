import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';

export interface MatchPresenceState {
  /**
   * True iff at least one other participant (not the local user) is
   * currently joined to the match-presence channel.
   *
   * null = we haven't received any presence sync yet — the channel
   * may still be subscribing. Callers should treat null as
   * "unknown, don't act on this".
   *
   * false = sync confirmed and no opponent present. Doesn't
   * necessarily mean they QUIT — they may not have loaded
   * PlayOnline yet (e.g. they're still on the lobby screen
   * or the app is still loading for them). Combine with
   * `opponentEverOnline` to distinguish "never showed up"
   * from "showed up then left".
   */
  readonly opponentOnline: boolean | null;

  /**
   * Goes true the FIRST time we observe an opponent in the
   * presence channel and stays true for the lifetime of the hook.
   * Lets callers treat the very first false as "still loading"
   * and any subsequent false-after-true as "they left".
   */
  readonly opponentEverOnline: boolean;
}

/**
 * Per-match Realtime presence. Each PlayOnline view joins a channel
 * keyed by matchId and tracks the local user's id. When the opponent
 * closes their tab, navigates to a different route, or drops their
 * network, Supabase's server-side socket close fires a 'leave' event
 * on every other subscriber — within a second for clean
 * disconnects, ~30s for hard network failures.
 *
 * useOnlineGame consumes this to fire an immediate auto-forfeit
 * instead of waiting for the inactivity-threshold heuristic to
 * elapse.
 */
export function useMatchPresence(
  matchId: string | undefined,
  localUserId: string | null,
): MatchPresenceState {
  const [opponentOnline, setOpponentOnline] = useState<boolean | null>(null);
  const [opponentEverOnline, setOpponentEverOnline] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!matchId || !localUserId) {
      setOpponentOnline(null);
      setOpponentEverOnline(false);
      return;
    }

    const channel = supabase.channel(`match-presence-${matchId}`, {
      config: {
        presence: {
          key: localUserId,
        },
      },
    });

    const handleSync = () => {
      const state = channel.presenceState();
      const keys = Object.keys(state);
      const opponentKeys = keys.filter((k) => k !== localUserId);
      const isOnline = opponentKeys.length > 0;
      setOpponentOnline(isOnline);
      if (isOnline) setOpponentEverOnline(true);
    };

    channel
      .on('presence', { event: 'sync' }, handleSync)
      .on('presence', { event: 'join' }, handleSync)
      .on('presence', { event: 'leave' }, handleSync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: localUserId,
            joined_at: Date.now(),
          });
        }
      });

    return () => {
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [matchId, localUserId]);

  return { opponentOnline, opponentEverOnline };
}
