import {isSupabaseConfigured} from '../lib/supabase';
import {useGetLobbyFeatureConfigsQuery} from '../features/lobby/lobbyApi';
import type {LobbyFeatureConfigMap} from '../features/lobby/lobbyData';

/**
 * Per-feature unlock levels for the bottom-nav (table: lobby_feature_configs),
 * keyed by feature_key (missions / events / tournaments / vip-club).
 *
 * On any error, missing row, or unconfigured Supabase this returns an empty
 * map, which the lobby reads as "no gating" (everything open) — a fetch hiccup
 * must never lock a player out of a feature.
 */
export function useLobbyFeatureConfigs(): LobbyFeatureConfigMap {
  const {data} = useGetLobbyFeatureConfigsQuery(undefined, {
    skip: !isSupabaseConfigured,
  });
  return data ?? {};
}
