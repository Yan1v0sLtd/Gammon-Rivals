import type { BoardThemeConfig, BoardThemeId } from '../board/theme';
import type { Json } from '../types/database';

export type LobbyBoardId = BoardThemeId;

export interface LobbyBoard {
  readonly id: LobbyBoardId;
  readonly name: string;
  readonly subtitle: string;
  readonly image: string;
  readonly accent: string;
  readonly background: string;
  readonly backgroundTone: string;
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
    accent,
    background: normalizePublicAssetPath(config.lobby_background_image) ?? '/lobby/backgrounds/classic-green.webp',
    backgroundTone: metadataText(config.metadata, 'backgroundTone') ?? toneForAccent(accent),
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

export const lobbyOffers: readonly LobbyOffer[] = [
  {
    id: 'coins',
    title: 'Coins Offer',
    subtitle: 'Limited bundle',
    tone: 'from-[#8f18ff] via-[#bd23d7] to-[#6110a8]',
    badge: '2',
    symbol: '$',
    image: '/lobby/cards/coins-offer.webp',
    aspectRatio: '650 / 261',
  },
  {
    id: 'daily',
    title: 'Daily Bonus',
    subtitle: 'Claim your reward',
    tone: 'from-[#075dbf] via-[#1176d7] to-[#073d86]',
    badge: '1',
    symbol: '*',
    image: '/lobby/cards/daily-bonus.webp',
    aspectRatio: '650 / 275',
  },
  {
    id: 'connect',
    title: 'Connect',
    subtitle: 'Save progress',
    tone: 'from-[#146b25] via-[#1d8d38] to-[#0c4b1c]',
    symbol: 'f',
  },
];

export const lobbyNavItems: readonly LobbyNavItem[] = [
  { id: 'missions', label: 'Missions', image: '/lobby/nav/missions.webp' },
  { id: 'events', label: 'Events', image: '/lobby/nav/events.webp' },
  // Middle slot reserved — leave empty for now.
  { id: 'placeholder', label: '' },
  { id: 'tournaments', label: 'Tournaments', image: '/lobby/nav/tournaments.webp' },
  { id: 'vip-club', label: 'VIP Club', image: '/lobby/nav/vip-club.webp' },
];
