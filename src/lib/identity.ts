// ─── Identity ───────────────────────────────────────────────────────────
// Random display names + avatar seeds for new players and AI opponents.
// Avatars are rendered by DiceBear (https://www.dicebear.com) — same seed
// always produces the same SVG so we don't need to store an image.

const FIRST_NAMES = [
  'Alex', 'Riley', 'Jordan', 'Casey', 'Morgan', 'Quinn', 'Avery', 'Emerson',
  'Reese', 'Sage', 'River', 'Rowan', 'Skyler', 'Tatum', 'Drew', 'Phoenix',
  'Cameron', 'Hayden', 'Charlie', 'Eden', 'Finley', 'Frankie', 'Harper',
  'Hunter', 'Jamie', 'Jesse', 'Kai', 'Logan', 'Marlowe', 'Nico', 'Parker',
  'Peyton', 'Remy', 'Robin', 'Ryan', 'Shay', 'Sky', 'Sutton', 'Taylor',
  'Wren', 'Adrian', 'Ari', 'Bailey', 'Blair', 'Blake', 'Brett', 'Devon',
  'Dylan', 'Ellis', 'Evan', 'Gray', 'Hollis', 'Indigo', 'Jules', 'Kendall',
  'Kenzie', 'Kit', 'Lane', 'Lennon', 'Lior', 'Maren', 'Mika', 'Noa',
  'Oakley', 'Ocean', 'Onyx', 'Quincy', 'Ramsey', 'Rio', 'Rory', 'Sasha',
  'Shiloh', 'Sloan', 'Tristan', 'Val', 'Vesper', 'Wells', 'Winter', 'Zion',
] as const;

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

/** Stable name for an AI opponent: "<Random first name> the <Tier>". */
export function aiDisplayName(level: string): string {
  const title = AI_TITLE_BY_LEVEL[level] ?? 'Bot';
  return `${randomDisplayName()} the ${title}`;
}

/**
 * Build the URL for a DiceBear avatar. We use the `personas` style — flat
 * cartoon portraits that look like the photo-style avatars in the reference
 * mobile games. Background is given a warm tone so the avatar reads on
 * the dark wood UI without us having to set it per-render.
 */
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

/** Make a fresh identity for an AI opponent at the given level. */
export function makeAIIdentity(level: string): PlayerIdentity {
  return {
    name: aiDisplayName(level),
    avatarSeed: randomAvatarSeed(),
    badge: level.toUpperCase(),
  };
}

/** Local fallback identity when there's no server profile yet. */
export function makeGuestIdentity(): PlayerIdentity {
  return {
    name: randomDisplayName(),
    avatarSeed: randomAvatarSeed(),
  };
}
