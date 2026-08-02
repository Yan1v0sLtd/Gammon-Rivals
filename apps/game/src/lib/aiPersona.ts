/**
 * Per-match AI "persona" derivation.
 *
 * When the lobby's matchmaking times out and falls back to AI, the
 * gameplay view used to render the opponent as a static "Level 40 /
 * MEDIUM / 22.7K gold" card on every single match. The name and
 * avatar already vary via makeAIIdentity, but the rest read as
 * obviously-the-same-bot.
 *
 * This module derives a plausible level + coin count from a seed
 * (typically the matchId) so every AI opponent looks like a
 * different player, while staying deterministic per match — no
 * shifting numbers on re-renders or hot-reloads inside the same
 * match. The values are display-only; they don't influence
 * difficulty or rewards.
 *
 * Bands by AI difficulty mirror what a real grinder at that
 * skill-floor would plausibly be carrying:
 *
 *   easy   → level 8–25,   coins 1.0K–8K
 *   medium → level 25–55,  coins 5K–40K
 *   hard   → level 55–95,  coins 15K–150K
 *
 * If you change a band, also eyeball the resulting numbers against
 * level_configs.xp_required so the persona doesn't claim a level
 * the game's economy can't support.
 */

import type { AILevel } from '../../../../packages/ai/src/types';

/** Cheap, fast 32-bit hash for use as a seed. Not cryptographic.
 *  djb2-style — good enough that two matchIds differing by a single
 *  hex digit produce uncorrelated seeds. */
function hashSeed(input: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

/** Deterministic PRNG. Identical seed → identical sequence. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PersonaBand {
  readonly levelMin: number;
  readonly levelMax: number;
  readonly coinsMin: number;
  readonly coinsMax: number;
}

const BANDS: Record<AILevel, PersonaBand> = {
  easy: { levelMin: 8, levelMax: 25, coinsMin: 1_000, coinsMax: 8_000 },
  medium: { levelMin: 25, levelMax: 55, coinsMin: 5_000, coinsMax: 40_000 },
  hard: { levelMin: 55, levelMax: 95, coinsMin: 15_000, coinsMax: 150_000 },
};

export interface AIPersona {
  /** Display-only player level for the AI opponent card. */
  readonly level: number;
  /** Display-only coin balance for the AI opponent card. */
  readonly coins: number;
}

/**
 * Derive a stable persona for the AI opponent in a given match.
 *
 * @param seed Anything stable per match. Match id is the natural pick.
 *             Falls back to "no-seed" when called before the match id
 *             resolves (gives a fixed but still-plausible persona for
 *             that one-frame window).
 * @param difficulty AI strength tier — picks which band to sample from.
 */
export function generateAIPersona(seed: string | null, difficulty: AILevel): AIPersona {
  const band = BANDS[difficulty];
  const rng = mulberry32(hashSeed(seed && seed.length > 0 ? seed : 'no-seed'));
  const level = band.levelMin + Math.floor(rng() * (band.levelMax - band.levelMin + 1));
  // Coin count: pick a base in the band, then jitter it to a non-
  // round number so the player doesn't see suspiciously clean
  // 10000s / 25000s on every wedge.
  const coinsRaw = band.coinsMin + rng() * (band.coinsMax - band.coinsMin);
  // Round to nearest 100 so the formatter (K-suffix) lands on
  // friendly numbers like 12.4K / 38.7K rather than 12387.
  const coins = Math.round(coinsRaw / 100) * 100;
  return { level, coins };
}
