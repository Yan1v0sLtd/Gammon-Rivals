import type { BoardThemeConfig, BoardThemeId } from '../board/theme';
import type { Json } from '../types/database';

export type LobbyBoardId = BoardThemeId;

export interface LobbyBoard {
  readonly id: LobbyBoardId;
  readonly name: string;
  readonly subtitle: string;
  readonly image: string;
  /** Per-board podium / "holder" image (the stand under the board in the
   *  lobby carousel). When set it OVERRIDES the global active podium; when
   *  null the global podium (useActivePodium) is the fallback. */
  readonly holderImage: string | null;
  readonly accent: string;
  readonly background: string;
  readonly backgroundTone: string;
  readonly unlockLevel: number;
  readonly priceGems: number;
}

function isObject(value: Json): value is Record<string, Json> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function metadataText(metadata: Json, key: string): string | null {
  return isObject(metadata) && typeof metadata[key] === 'string' ? metadata[key] : null;
}

function toneForAccent(accent: string): string {
  return `linear-gradient(180deg,rgba(3,13,29,0.40),rgba(3,13,29,0.12)_42%,rgba(2,8,18,0.70)),radial-gradient(circle_at_58%_45%,${accent}38,transparent_54%)`;
}

function normalizePublicAssetPath(path: string | null | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) return undefined;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function lobbyBoardFromConfig(config: BoardThemeConfig): LobbyBoard {
  const accent = metadataText(config.metadata, 'accent') ?? '#ffd35d';
  return {
    id: config.id,
    name: config.display_name,
    subtitle: metadataText(config.metadata, 'subtitle') ?? `Unlocks at level ${config.unlock_level}`,
    image: normalizePublicAssetPath(config.preview_image) ?? '/lobby/board-previews/classic-green.webp',
    holderImage: normalizePublicAssetPath(config.holder_image) ?? null,
    accent,
    background: normalizePublicAssetPath(config.lobby_background_image) ?? '/lobby/backgrounds/classic-green.webp',
    backgroundTone: metadataText(config.metadata, 'backgroundTone') ?? toneForAccent(accent),
    unlockLevel: config.unlock_level,
    priceGems: config.price_gems ?? 0,
  };
}

export interface LobbyOffer {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly tone: string;
  readonly badge?: string;
  readonly symbol: string;
  readonly image?: string;
  readonly aspectRatio?: string;
}

export interface LobbyNavItem {
  readonly id: string;
  readonly label: string;
  /** Pre-rendered icon+label asset for the new wood-bar nav. When
   *  omitted the slot renders as an empty placeholder (used for the
   *  middle slot until we decide what goes there). */
  readonly image?: string;
  readonly badge?: string;
  readonly featured?: boolean;
}

// All boards are managed through the Back Office (board_theme_configs
// table) — this array is intentionally empty so the lobby only shows
// DB-managed boards.
export const lobbyBoards: readonly LobbyBoard[] = [];

/**
 * Side-rail offer cards (left column of the lobby). Each card is
 * a 200x200 source image now — the wide horizontal layouts from
 * earlier rounds were replaced with square icon-style assets per
 * operator direction:
 *
 *   - 'coins'   → "Special Offers" badge (treasure + chest + dice)
 *   - 'daily'   → "Daily Bonus" circular badge
 *   - 'connect' → "How to Play" circular badge (was the Google-
 *                 linking Connect tile; the id stays for click-
 *                 routing compat, the visible image + title shift)
 *
 * Click routing in LobbyScreen still keys off `id`, so a future
 * round wiring "how to play" to a modal can branch on
 * id === 'connect' without renaming. Aspect ratio is now 1/1 so
 * the square icons fit cleanly in the side-rail column.
 */
export const lobbyOffers: readonly LobbyOffer[] = [
  {
    id: 'coins',
    title: 'Special Offers',
    subtitle: 'Limited deals',
    tone: 'from-[#8f18ff] via-[#bd23d7] to-[#6110a8]',
    symbol: '$',
    image: '/lobby/cards/special-offers.webp',
    aspectRatio: '1 / 1',
  },
  {
    id: 'daily',
    title: 'Daily Bonus',
    subtitle: 'Claim your reward',
    tone: 'from-[#075dbf] via-[#1176d7] to-[#073d86]',
    badge: '1',
    symbol: '*',
    image: '/lobby/cards/daily-bonus-icon.webp',
    aspectRatio: '1 / 1',
  },
  {
    id: 'connect',
    title: 'How to Play',
    subtitle: 'Learn the basics',
    tone: 'from-[#146b25] via-[#1d8d38] to-[#0c4b1c]',
    symbol: 'f',
    image: '/lobby/cards/how-to-play.webp',
    aspectRatio: '1 / 1',
  },
];

/**
 * Feature gate for the Mission Chests sub-feature inside the Daily
 * Missions modal. When `false` we hide:
 *   - The Chest Track Strip in the modal header (the 4 chest icons +
 *     the MP progress line that runs through them).
 *   - The "+X MP" indicators on each mission card (those points feed
 *     the chest threshold, which is now hidden).
 *
 * Everything else in Daily Missions stays ON: daily mission list,
 * Weekly Challenge, Daily Streak (and its OWN streak chest — that is
 * a separate feature from the weekly Mission Chests), reroll.
 *
 * Server-side: cron jobs continue to accrue mp_earned, so when this
 * flag flips back to `true` players see a populated bar with no data
 * loss. Re-enable in one place by setting this to `true`.
 */
export const CHESTS_ENABLED = false;

export const lobbyNavItems: readonly LobbyNavItem[] = [
  { id: 'missions', label: 'Missions', image: '/lobby/nav/missions.webp' },
  { id: 'events', label: 'Events', image: '/lobby/nav/events.webp' },
  // Middle slot reserved — leave empty for now.
  { id: 'placeholder', label: '' },
  { id: 'tournaments', label: 'Tournaments', image: '/lobby/nav/tournaments.webp' },
  { id: 'vip-club', label: 'VIP Club', image: '/lobby/nav/vip-club.webp' },
];
