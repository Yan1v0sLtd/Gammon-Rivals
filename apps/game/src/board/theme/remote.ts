import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { Database, Json } from '@shared/database';
import { getBoardTheme } from '@board-renderer/theme/boardThemes';
import { premiumTheme } from '@board-renderer/theme/premium';
import { getPersistedBoardId } from './selectedBoard';
import { isJsonObject, layoutFromMetadata } from '@board-renderer/theme/metadata';
import type { Theme } from '@board-renderer/theme/types';

export { layoutFromMetadata } from '@board-renderer/theme/metadata';

export type BoardThemeConfig = Database['public']['Tables']['board_theme_configs']['Row'];

function metadataText(metadata: Json, key: string): string | undefined {
  if (!isJsonObject(metadata)) return undefined;
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function normalizePublicAssetPath(path: string | null | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) return undefined;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function themeFromBoardConfig(config: BoardThemeConfig): Theme {
  return {
    ...premiumTheme,
    name: config.id,
    assets: {
      ...premiumTheme.assets,
      board: normalizePublicAssetPath(config.gameplay_image) ?? premiumTheme.assets?.board,
      whiteChecker:
        normalizePublicAssetPath(config.white_checker_image) ?? premiumTheme.assets?.whiteChecker,
      blackChecker:
        normalizePublicAssetPath(config.black_checker_image) ?? premiumTheme.assets?.blackChecker,
    },
    backgroundImage:
      normalizePublicAssetPath(config.lobby_background_image) ?? premiumTheme.backgroundImage,
    gameplayBackgroundImage:
      normalizePublicAssetPath(metadataText(config.metadata, 'gameplayBackgroundImage')) ??
      normalizePublicAssetPath(config.lobby_background_image) ??
      premiumTheme.gameplayBackgroundImage ??
      premiumTheme.backgroundImage,
    layout: {
      ...premiumTheme.layout,
      ...layoutFromMetadata(config.metadata),
    },
    // Dice sprite — when present in the BO config, DiceTray
    // renders the 3×2 sprite per face instead of the default
    // CSS-pip cube. See Theme interface comment for the layout
    // contract.
    diceImage: normalizePublicAssetPath(config.dice_image),
  };
}

export interface BoardThemeConfigResult {
  readonly theme: Theme;
  /** True while the Supabase fetch for this board's remote config is
   *  in flight. Callers that mount expensive renderers (e.g. the Pixi
   *  board) should wait for `false` before mounting — otherwise the
   *  renderer initialises with the fallback theme, then has to tear
   *  itself down and re-init when the remote theme arrives, which
   *  flashes an empty board area during the gap. */
  readonly isLoading: boolean;
}

export function useBoardThemeConfig(boardId: string | null | undefined): BoardThemeConfigResult {
  // Generic placeholder (premiumTheme). LAST resort only — once any real board
  // resolves below it is never shown. Kept so there is always *something* to
  // draw if Supabase is unconfigured or the DB has zero enabled boards.
  const placeholderTheme = useMemo(() => getBoardTheme(boardId), [boardId]);
  const [resolved, setResolved] = useState<Theme | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => isSupabaseConfigured);

  // Which board to load: the explicit `?board=` param wins; otherwise fall
  // back to the player's persisted lobby pick. Entry points like invite links,
  // public/queue matches and cold loads omit `?board=` BY DESIGN — reading the
  // persisted pick keeps the player on THEIR board (per-client, no coupling to
  // matchmaking). If neither exists, the effect resolves the first enabled
  // board from the back office. This is what prevents the generic placeholder
  // board from ever reaching a player.
  const requestedId = (boardId && boardId.trim()) || getPersistedBoardId() || null;

  useEffect(() => {
    let cancelled = false;

    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setResolved(null);

    void (async () => {
      // 1. The specific board the player asked for (URL param or persisted pick).
      if (requestedId) {
        const { data } = await supabase
          .from('board_theme_configs')
          .select('*')
          .eq('id', requestedId)
          .eq('is_enabled', true)
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          setResolved(themeFromBoardConfig(data));
          setIsLoading(false);
          return;
        }
      }

      // 2. No board requested, or it is missing / disabled / failed to load:
      //    use the first ENABLED board in the back-office order as a REAL
      //    default, so the player always lands on a legitimate themed board.
      const { data: defaultRow } = await supabase
        .from('board_theme_configs')
        .select('*')
        .eq('is_enabled', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (defaultRow) setResolved(themeFromBoardConfig(defaultRow));
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedId]);

  return { theme: resolved ?? placeholderTheme, isLoading };
}
