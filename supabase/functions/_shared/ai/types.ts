// GENERATED FILE — DO NOT EDIT.
// Deno mirror of apps/game/src/ai for Supabase edge functions
// (server-authored AI turns). apps/game/src/ai is the source of truth;
// regenerate with:  npm run build:shared-ai

export type AILevel = 'easy' | 'medium' | 'hard';

export const AI_LEVELS: readonly AILevel[] = ['easy', 'medium', 'hard'] as const;

export const AI_LEVEL_LABEL: Readonly<Record<AILevel, string>> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};
