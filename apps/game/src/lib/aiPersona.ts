/**
 * Derive a plausible level + coin count for an AI opponent from a seed
 * (typically the matchId). Without this, the opponent card always read
 * as the same static "Level 40 / MEDIUM / 22.7K gold" bot; now each AI
 * looks like a different player while staying deterministic per match
 * (no shifting numbers across re-renders). Values are display-only —
 * they don't affect difficulty or rewards.
 *
 * Bands mirror what a real player at that skill floor would carry:
 *
 *   easy   → level 8–25,   coins 1.0K–8K
 *   medium → level 25–55,  coins 5K–40K
 *   hard   → level 55–95,  coins 15K–150K
 *
 * If you change a band, check against level_configs.xp_required so the
 * persona can't claim a level the economy doesn't support.
 */

import type {AILevel} from '../../../../packages/ai/src/types';

/** Cheap 32-bit djb2 hash for seeding; not cryptographic, but distinct
 *  matchIds (even by one hex digit) yield uncorrelated seeds. */
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
  easy: {
    levelMin: 8,
    levelMax: 25,
    coinsMin: 1_000,
    coinsMax: 8_000
  },
  medium: {
    levelMin: 25,
    levelMax: 55,
    coinsMin: 5_000,
    coinsMax: 40_000
  },
  hard: {
    levelMin: 55,
    levelMax: 95,
    coinsMin: 15_000,
    coinsMax: 150_000
  },
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
 * @param seed       Stable per match (match id); "no-seed" fallback for the
 *                   one-frame window before the id resolves.
 * @param difficulty AI tier — picks the band to sample from.
 */
export function generateAIPersona(seed: string | null, difficulty: AILevel): AIPersona {
  const band = BANDS[difficulty];
  const rng = mulberry32(hashSeed(seed && seed.length > 0 ? seed : 'no-seed'));
  const level = band.levelMin + Math.floor(rng() * (band.levelMax - band.levelMin + 1));
  // Jitter coins within the band so players don't see suspiciously
  // clean round numbers every match.
  const coinsRaw = band.coinsMin + rng() * (band.coinsMax - band.coinsMin);
  // Round to nearest 100 so the K-suffix formatter shows 12.4K, not 12387.
  const coins = Math.round(coinsRaw / 100) * 100;
  return {
    level,
    coins
  };
}
