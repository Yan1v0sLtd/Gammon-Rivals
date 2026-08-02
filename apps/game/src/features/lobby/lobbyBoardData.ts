import type {BoardThemeId} from '../../../../../packages/board-renderer/src/theme/boardThemes';
import type {Json} from '../../../../../packages/shared/src/database';
import type {BoardThemeConfigRow} from './lobbyData';

export type LobbyBoardId = BoardThemeId;
export interface LobbyBoard { readonly id: LobbyBoardId; readonly name: string; readonly subtitle: string; readonly image: string; readonly holderImage: string | null; readonly accent: string; readonly background: string; readonly backgroundTone: string; readonly unlockLevel: number; readonly priceGems: number; }
function isObject(value: Json): value is Record<string, Json> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function metadataText(metadata: Json, key: string): string | null { return isObject(metadata) && typeof metadata[key] === 'string' ? metadata[key] : null; }
function toneForAccent(accent: string): string { return `linear-gradient(180deg,rgba(3,13,29,0.40),rgba(3,13,29,0.12)_42%,rgba(2,8,18,0.70)),radial-gradient(circle_at_58%_45%,${accent}38,transparent_54%)`; }
function normalizePublicAssetPath(path: string | null | undefined): string | undefined { const trimmed = path?.trim(); if (!trimmed) return undefined; if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed; return trimmed.startsWith('/') ? trimmed : `/${trimmed}`; }
export function lobbyBoardFromConfig(config: BoardThemeConfigRow): LobbyBoard { const accent = metadataText(config.metadata, 'accent') ?? '#ffd35d'; return {id: config.id, name: config.display_name, subtitle: metadataText(config.metadata, 'subtitle') ?? `Unlocks at level ${config.unlock_level}`, image: normalizePublicAssetPath(config.preview_image) ?? '/lobby/board-previews/classic-green.webp', holderImage: normalizePublicAssetPath(config.holder_image) ?? null, accent, background: normalizePublicAssetPath(config.lobby_background_image) ?? '/lobby/backgrounds/classic-green.webp', backgroundTone: metadataText(config.metadata, 'backgroundTone') ?? toneForAccent(accent), unlockLevel: config.unlock_level, priceGems: config.price_gems ?? 0}; }
export const lobbyBoards: readonly LobbyBoard[] = [];
