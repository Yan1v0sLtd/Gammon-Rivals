import { useEffect } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Tracks the current authenticated session as "online" via a shared
 * Supabase Realtime presence channel. Anyone subscribed to the channel
 * sees the live count + per-user metadata (profile_id, is_guest). The
 * BO uses this to render a live online-users widget; future surfaces
 * (friends online, lobby count) can hook into the same channel.
 *
 * Lifecycle:
 *   - Mount with a non-null userId/isGuest → join channel, broadcast presence.
 *   - userId changes → leave the previous track + rejoin under the new id.
 *   - Unmount or signed-out userId → leave the channel. The server
 *     side picks up the WebSocket close and updates everyone else's
 *     presenceState within a few seconds.
 *
 * Multiple tabs from the same profile_id will each register a presence
 * entry. The BO de-duplicates by profile_id when counting, so a single
 * user with three tabs still counts as one.
 */
export function useOnlinePresence(args: {
  readonly profileId: string | null;
  readonly isGuest: boolean;
}): void {
  const { profileId, isGuest } = args;

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!profileId) return;

    const channel = supabase.channel('online-users', {
      config: {
        presence: {
          // Presence key controls how the server groups joins. Using
          // profile_id here means even a tab-reload race lands in the
          // same "slot" rather than creating a transient ghost.
          key: profileId,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        // No-op for trackers — the BO subscriber consumes this. We
        // still attach so the Realtime broker treats this client as
        // an active member of the channel.
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            profile_id: profileId,
            is_guest: isGuest,
            joined_at: Date.now(),
          });
        }
      });

    return () => {
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [profileId, isGuest]);
}
