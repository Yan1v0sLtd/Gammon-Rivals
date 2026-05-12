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
  readonly symbol: string;
  readonly badge?: string;
}

export const lobbyBoards: readonly LobbyBoard[] = [
  {
    id: 'classic-green',
    name: 'Classic Green',
    subtitle: 'Traditional felt',
    image: '/lobby/board-previews/classic-green.webp',
    accent: '#6dda72',
    background: '/lobby/backgrounds/classic-green.webp',
    backgroundTone:
      'linear-gradient(180deg,rgba(3,13,29,0.40),rgba(3,13,29,0.12)_42%,rgba(2,8,18,0.68)),radial-gradient(circle_at_58%_45%,rgba(48,160,86,0.22),transparent_52%)',
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    subtitle: 'Bright coastal wood',
    image: '/lobby/board-previews/ocean-blue.webp',
    accent: '#39d7ff',
    background: '/lobby/backgrounds/ocean-blue.webp',
    backgroundTone:
      'linear-gradient(180deg,rgba(3,14,34,0.34),rgba(2,76,111,0.10)_42%,rgba(2,8,18,0.70)),radial-gradient(circle_at_60%_43%,rgba(42,200,255,0.26),transparent_54%)',
  },
  {
    id: 'royal-purple',
    name: 'Royal Purple',
    subtitle: 'Gold tournament trim',
    image: '/lobby/board-previews/royal-purple.webp',
    accent: '#c174ff',
    background: '/lobby/backgrounds/royal-purple.webp',
    backgroundTone:
      'linear-gradient(180deg,rgba(9,8,36,0.38),rgba(56,18,83,0.16)_42%,rgba(2,8,18,0.72)),radial-gradient(circle_at_58%_44%,rgba(169,88,255,0.24),transparent_54%)',
  },
];

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
  { id: 'store', label: 'Store', symbol: '$' },
  { id: 'boards', label: 'Boards', symbol: 'B' },
  { id: 'missions', label: 'Missions', symbol: 'T', badge: '3' },
  { id: 'leaderboard', label: 'Leaders', symbol: '1' },
  { id: 'collection', label: 'Collection', symbol: 'D' },
  { id: 'vip', label: 'VIP Club', symbol: 'V' },
];
