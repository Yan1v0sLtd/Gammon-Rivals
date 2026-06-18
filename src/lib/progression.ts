import type { Database } from '../types/database';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type LevelConfig = Database['public']['Tables']['level_configs']['Row'];
export type LevelStatusTier = Database['public']['Tables']['level_status_tiers']['Row'];

export interface ProfileProgression {
  readonly level: number;
  readonly xp: number;
  readonly statusLabel: string;
  readonly currentLevelXp: number;
  readonly nextLevelXp: number | null;
  readonly xpIntoLevel: number;
  readonly xpNeededForNext: number;
  readonly progress: number;
  readonly progressPercent: number;
  readonly progressLabel: string;
  /**
   * Canonical "X / Y XP" text for the XP progress bar — the SINGLE source of
   * truth so the lobby card and profile page never drift. Per-level semantics:
   * `<xp into this level> / <this level's span>`; `<total> XP` at max level.
   */
  readonly xpBarLabel: string;
  /**
   * Coin / gem reward grant attached to the next level-up. Read from
   * the level_configs row for `level + 1` so the lobby's profile
   * card can surface the "Next Reward" line. `null` when there's no
   * next level configured (player at the top of the ladder).
   */
  readonly nextLevelReward: {
    readonly level: number;
    readonly coins: number;
    readonly gems: number;
  } | null;
}

const DEFAULT_LEVEL_SPAN = 100;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function fallbackLevelXp(level: number): number {
  return Math.max(0, (level - 1) * DEFAULT_LEVEL_SPAN);
}

/**
 * The subset of a status tier that {@link resolveStatusLabel} needs.
 * Accepts both full `level_status_tiers` rows and lightweight in-memory
 * drafts (e.g. the Back Office editor) without forcing the caller to
 * supply id / timestamps.
 */
export type StatusTierRange = Pick<
  LevelStatusTier,
  'level_from' | 'level_to' | 'label' | 'sort_order' | 'is_enabled'
>;

/**
 * Derive the status / rank label for a given level from the
 * `level_status_tiers` config. Picks the first enabled tier (lowest
 * sort_order, then level_from) whose [level_from, level_to] range
 * contains the level.
 *
 * Falls back to:
 *   1. The legacy per-row `level_configs.status_label`
 *   2. `'Rookie'` if nothing else matches
 *
 * The fallback chain lets us roll this change out without backfilling
 * status_label on every existing level_configs row — anywhere a tier
 * is missing, the old column still wins.
 *
 * Exported so the Back Office's Level list can show the SAME derived
 * status the lobby does, instead of the non-existent legacy column.
 */
export function resolveStatusLabel(
  level: number,
  levelStatusTiers: readonly StatusTierRange[],
  legacyLabel: string | null | undefined
): string {
  if (levelStatusTiers.length > 0) {
    const ordered = levelStatusTiers
      .filter((t) => t.is_enabled)
      .slice()
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.level_from - b.level_from;
      });
    const match = ordered.find(
      (t) => level >= t.level_from && level <= t.level_to
    );
    if (match) return match.label;
  }
  return (legacyLabel ?? '').trim() || 'Rookie';
}

export function getProfileProgression(
  profile: ProfileRow | null,
  levelConfigs: readonly LevelConfig[] = [],
  levelStatusTiers: readonly LevelStatusTier[] = []
): ProfileProgression {
  const level = Math.max(1, profile?.level ?? 1);
  const xp = Math.max(0, profile?.xp ?? 0);
  const enabledLevels = levelConfigs
    .filter((row) => row.is_enabled)
    .slice()
    .sort((a, b) => a.level - b.level);

  const currentConfig =
    enabledLevels
      .filter((row) => row.level <= level)
      .at(-1) ?? enabledLevels.find((row) => row.level === level) ?? null;
  const nextConfig = enabledLevels.find((row) => row.level > level) ?? null;
  const currentLevelXp = currentConfig?.xp_required ?? fallbackLevelXp(level);
  const nextLevelXp = nextConfig?.xp_required ?? currentLevelXp + DEFAULT_LEVEL_SPAN;
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const progress = nextConfig === null && enabledLevels.length > 0 ? 1 : clamp01((xp - currentLevelXp) / span);
  const progressPercent = Math.round(progress * 100);

  const nextLevelReward = nextConfig
    ? {
        level: nextConfig.level,
        coins: nextConfig.reward_coins ?? 0,
        gems: nextConfig.reward_gems ?? 0,
      }
    : null;

  return {
    level,
    xp,
    statusLabel: resolveStatusLabel(level, levelStatusTiers, currentConfig?.status_label),
    currentLevelXp,
    nextLevelXp: nextConfig ? nextLevelXp : null,
    xpIntoLevel: Math.max(0, xp - currentLevelXp),
    xpNeededForNext: nextConfig ? Math.max(0, nextLevelXp - xp) : 0,
    progress,
    progressPercent,
    progressLabel: `${progressPercent}%`,
    xpBarLabel: nextConfig === null
      ? `${xp.toLocaleString()} XP`
      : `${Math.max(0, xp - currentLevelXp).toLocaleString()} / ${span.toLocaleString()} XP`,
    nextLevelReward,
  };
}
