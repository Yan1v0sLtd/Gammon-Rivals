import type { Database } from '../types/database';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type LevelConfig = Database['public']['Tables']['level_configs']['Row'];

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
}

const DEFAULT_LEVEL_SPAN = 100;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function fallbackLevelXp(level: number): number {
  return Math.max(0, (level - 1) * DEFAULT_LEVEL_SPAN);
}

export function getProfileProgression(
  profile: ProfileRow | null,
  levelConfigs: readonly LevelConfig[] = []
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

  return {
    level,
    xp,
    statusLabel: currentConfig?.status_label || 'Rookie',
    currentLevelXp,
    nextLevelXp: nextConfig ? nextLevelXp : null,
    xpIntoLevel: Math.max(0, xp - currentLevelXp),
    xpNeededForNext: nextConfig ? Math.max(0, nextLevelXp - xp) : 0,
    progress,
    progressPercent,
    progressLabel: `${progressPercent}%`,
  };
}
