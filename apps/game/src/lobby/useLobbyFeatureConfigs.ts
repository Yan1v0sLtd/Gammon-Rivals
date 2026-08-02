import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface LobbyFeatureConfig {
  readonly unlockLevel: number;
  readonly isEnabled: boolean;
  /** Operator-set tooltip override; null/blank → default "Reach level N…". */
  readonly tooltipText: string | null;
}

export type LobbyFeatureConfigMap = Readonly<Record<string, LobbyFeatureConfig>>;

/**
 * Per-feature unlock levels for the bottom-nav (table: lobby_feature_configs),
 * keyed by feature_key (missions / events / tournaments / vip-club).
 *
 * On any error, missing row, or unconfigured Supabase this returns an empty
 * map, which the lobby reads as "no gating" (everything open) — a fetch hiccup
 * must never lock a player out of a feature.
 */
export function useLobbyFeatureConfigs(): LobbyFeatureConfigMap {
  const [configs, setConfigs] = useState<LobbyFeatureConfigMap>({});

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void supabase
      .from('lobby_feature_configs')
      .select('feature_key, unlock_level, is_enabled, tooltip_text')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const map: Record<string, LobbyFeatureConfig> = {};
        for (const row of data) {
          map[row.feature_key] = {
            unlockLevel: row.unlock_level,
            isEnabled: row.is_enabled,
            tooltipText: row.tooltip_text,
          };
        }
        setConfigs(map);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return configs;
}
