// Random display names + avatar seeds for new players and AI opponents.
// Avatars are rendered by DiceBear (https://www.dicebear.com) — same seed
// always produces the same SVG so we don't need to store an image.

const FIRST_NAMES = ['Alex', 'Riley', 'Jordan', 'Casey', 'Morgan', 'Quinn', 'Avery', 'Emerson', 'Reese', 'Sage', 'River', 'Rowan', 'Skyler', 'Tatum', 'Drew', 'Phoenix', 'Cameron', 'Hayden', 'Charlie', 'Eden', 'Finley', 'Frankie', 'Harper', 'Hunter', 'Jamie', 'Jesse', 'Kai', 'Logan', 'Marlowe', 'Nico', 'Parker', 'Peyton', 'Remy', 'Robin', 'Ryan', 'Shay', 'Sky', 'Sutton', 'Taylor', 'Wren', 'Adrian', 'Ari', 'Bailey', 'Blair', 'Blake', 'Brett', 'Devon', 'Dylan', 'Ellis', 'Evan', 'Gray', 'Hollis', 'Indigo', 'Jules', 'Kendall', 'Kenzie', 'Kit', 'Lane', 'Lennon', 'Lior', 'Maren', 'Mika', 'Noa', 'Oakley', 'Ocean', 'Onyx', 'Quincy', 'Ramsey', 'Rio', 'Rory', 'Sasha', 'Shiloh', 'Sloan', 'Tristan', 'Val', 'Vesper', 'Wells', 'Winter', 'Zion',] as const;

const AI_TITLE_BY_LEVEL: Record<string, string> = {
  easy: 'Rookie',
  medium: 'Pro',
  hard: 'Master',
};

/** A short, URL-safe random string suitable for use as a DiceBear seed. */
export function randomAvatarSeed(): string {
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => n.toString(36)).join('').slice(0, 12);
}

/** Pick a random first name from the bundled list. */
export function randomDisplayName(): string {
  const idx = Math.floor(Math.random() * FIRST_NAMES.length);
  return FIRST_NAMES[idx]!;
}

/** AI opponent name — a plain first name, like a real player's, so the
 *  difficulty never leaks through it (the tier shows as a rank via aiRankLabel). */
export function aiDisplayName(): string {
  return randomDisplayName();
}

/** Human-looking rank for an AI's status line ("Rookie"/"Pro"/"Master"),
 *  never the raw difficulty, so the opponent reads as a real player. */
export function aiRankLabel(level: string): string {
  return AI_TITLE_BY_LEVEL[level] ?? 'Player';
}

/** DiceBear URL for an avatar — `personas` style (flat portraits like the
 *  reference apps) with a warm gradient background that reads on the dark
 *  wood UI. */
export function avatarUrl(seed: string, size = 128): string {
  const params = new URLSearchParams({
    seed,
    backgroundType: 'gradientLinear',
    backgroundColor: 'b6e3f4,c0aede,ffd5dc,ffdfbf,d1d4f9',
    size: String(size),
    radius: '50',
  });
  return `https://api.dicebear.com/7.x/personas/svg?${params.toString()}`;
}

/** Player identity used by the UI to render an avatar + name. */
export interface PlayerIdentity {
  readonly name: string;
  readonly avatarSeed: string;
  readonly avatarUrl?: string | null;
  /** Optional small badge — e.g. AI level pill, or a country flag later. */
  readonly badge?: string;
}

/** Fresh AI opponent identity — a plain random name + avatar, no badge or
 *  tier, deliberately indistinguishable from a human player. */
export function makeAIIdentity(): PlayerIdentity {
  return {
    name: aiDisplayName(),
    avatarSeed: randomAvatarSeed(),
  };
}

/** Deterministic AI identity from a stable seed (the matchId): same seed →
 *  same name + avatar, so a server-bot reads as one consistent "human"
 *  across reloads (PlayOnline re-mounts mid-match). djb2 hash picks the
 *  name; the seed itself is the avatar seed. */
export function aiIdentityFromSeed(seed: string): PlayerIdentity {
  let h = 5381 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return {
    name: FIRST_NAMES[h % FIRST_NAMES.length]!,
    avatarSeed: seed || 'no-seed'
  };
}

/** Local fallback identity when there's no server profile yet. */
export function makeGuestIdentity(): PlayerIdentity {
  return {
    name: randomDisplayName(),
    avatarSeed: randomAvatarSeed(),
  };
}
