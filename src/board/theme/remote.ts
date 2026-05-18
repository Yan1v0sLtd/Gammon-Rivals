import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { Database, Json } from '../../types/database';
import { getBoardTheme } from './boardThemes';
import { premiumTheme } from './premium';
import type { Theme, ThemeLayout } from './types';

export type BoardThemeConfig = Database['public']['Tables']['board_theme_configs']['Row'];

function isObject(value: Json | undefined): value is Record<string, Json> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNumberArray(value: Json | undefined): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function metadataText(metadata: Json, key: string): string | undefined {
  if (!isObject(metadata)) return undefined;
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function layoutFromMetadata(metadata: Json): ThemeLayout | undefined {
  if (!isObject(metadata) || !isObject(metadata.layout)) return undefined;
  const source = metadata.layout;
  const layout: ThemeLayout = {
    railWidthRatio: typeof source.railWidthRatio === 'number' ? source.railWidthRatio : undefined,
    barWidthRatio: typeof source.barWidthRatio === 'number' ? source.barWidthRatio : undefined,
    pointHeightRatio: typeof source.pointHeightRatio === 'number' ? source.pointHeightRatio : undefined,
    topPointHeightRatio:
      typeof source.topPointHeightRatio === 'number' ? source.topPointHeightRatio : undefined,
    bottomPointHeightRatio:
      typeof source.bottomPointHeightRatio === 'number'
        ? source.bottomPointHeightRatio
        : undefined,
    topPointYRatio: typeof source.topPointYRatio === 'number' ? source.topPointYRatio : undefined,
    bottomPointYRatio:
      typeof source.bottomPointYRatio === 'number' ? source.bottomPointYRatio : undefined,
    checkerRadiusRatio:
      typeof source.checkerRadiusRatio === 'number' ? source.checkerRadiusRatio : undefined,
    topPointWidthRatio:
      typeof source.topPointWidthRatio === 'number' ? source.topPointWidthRatio : undefined,
    bottomPointWidthRatio:
      typeof source.bottomPointWidthRatio === 'number' ? source.bottomPointWidthRatio : undefined,
    topPlayLeftRatio: typeof source.topPlayLeftRatio === 'number' ? source.topPlayLeftRatio : undefined,
    bottomPlayLeftRatio:
      typeof source.bottomPlayLeftRatio === 'number' ? source.bottomPlayLeftRatio : undefined,
    topBarWidthRatio: typeof source.topBarWidthRatio === 'number' ? source.topBarWidthRatio : undefined,
    bottomBarWidthRatio:
      typeof source.bottomBarWidthRatio === 'number' ? source.bottomBarWidthRatio : undefined,
    topPointCenterXRatios: isNumberArray(source.topPointCenterXRatios)
      ? source.topPointCenterXRatios
      : undefined,
    bottomPointCenterXRatios: isNumberArray(source.bottomPointCenterXRatios)
      ? source.bottomPointCenterXRatios
      : undefined,
    topPointTipXRatios: isNumberArray(source.topPointTipXRatios)
      ? source.topPointTipXRatios
      : undefined,
    bottomPointTipXRatios: isNumberArray(source.bottomPointTipXRatios)
      ? source.bottomPointTipXRatios
      : undefined,
    topCheckerOffsetXRatios: isNumberArray(source.topCheckerOffsetXRatios)
      ? source.topCheckerOffsetXRatios
      : undefined,
    bottomCheckerOffsetXRatios: isNumberArray(source.bottomCheckerOffsetXRatios)
      ? source.bottomCheckerOffsetXRatios
      : undefined,
    checkerScaleYRatio:
      typeof source.checkerScaleYRatio === 'number' ? source.checkerScaleYRatio : undefined,
    checkerStackSpacingRatio:
      typeof source.checkerStackSpacingRatio === 'number'
        ? source.checkerStackSpacingRatio
        : undefined,
    topCheckerStackSpacingRatio:
      typeof source.topCheckerStackSpacingRatio === 'number'
        ? source.topCheckerStackSpacingRatio
        : undefined,
    bottomCheckerStackSpacingRatio:
      typeof source.bottomCheckerStackSpacingRatio === 'number'
        ? source.bottomCheckerStackSpacingRatio
        : undefined,
    topCheckerPaddingRatio:
      typeof source.topCheckerPaddingRatio === 'number'
        ? source.topCheckerPaddingRatio
        : undefined,
    bottomCheckerPaddingRatio:
      typeof source.bottomCheckerPaddingRatio === 'number'
        ? source.bottomCheckerPaddingRatio
        : undefined,
    blackOffTrayXRatio:
      typeof source.blackOffTrayXRatio === 'number' ? source.blackOffTrayXRatio : undefined,
    blackOffTrayTopRatio:
      typeof source.blackOffTrayTopRatio === 'number' ? source.blackOffTrayTopRatio : undefined,
    blackOffTrayHeightRatio:
      typeof source.blackOffTrayHeightRatio === 'number'
        ? source.blackOffTrayHeightRatio
        : undefined,
    whiteOffTrayXRatio:
      typeof source.whiteOffTrayXRatio === 'number' ? source.whiteOffTrayXRatio : undefined,
    whiteOffTrayTopRatio:
      typeof source.whiteOffTrayTopRatio === 'number' ? source.whiteOffTrayTopRatio : undefined,
    whiteOffTrayHeightRatio:
      typeof source.whiteOffTrayHeightRatio === 'number'
        ? source.whiteOffTrayHeightRatio
        : undefined,
    offCheckerStackSpacingRatio:
      typeof source.offCheckerStackSpacingRatio === 'number'
        ? source.offCheckerStackSpacingRatio
        : undefined,
    blackOffTrayTiltDeg:
      typeof source.blackOffTrayTiltDeg === 'number' ? source.blackOffTrayTiltDeg : undefined,
    whiteOffTrayTiltDeg:
      typeof source.whiteOffTrayTiltDeg === 'number' ? source.whiteOffTrayTiltDeg : undefined,
    feltInnerTopLeftRatio: isPairOfNumbers(source.feltInnerTopLeftRatio)
      ? source.feltInnerTopLeftRatio
      : undefined,
    feltInnerTopRightRatio: isPairOfNumbers(source.feltInnerTopRightRatio)
      ? source.feltInnerTopRightRatio
      : undefined,
    feltInnerBottomLeftRatio: isPairOfNumbers(source.feltInnerBottomLeftRatio)
      ? source.feltInnerBottomLeftRatio
      : undefined,
    feltInnerBottomRightRatio: isPairOfNumbers(source.feltInnerBottomRightRatio)
      ? source.feltInnerBottomRightRatio
      : undefined,
    feltDepthScaleRatio:
      typeof source.feltDepthScaleRatio === 'number' ? source.feltDepthScaleRatio : undefined,
  };
  return layout;
}

function isPairOfNumbers(value: Json | undefined): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
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
  const fallbackTheme = useMemo(() => getBoardTheme(boardId), [boardId]);
  const [remoteTheme, setRemoteTheme] = useState<{ id: string; theme: Theme } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(
    () => isSupabaseConfigured && Boolean(boardId)
  );

  useEffect(() => {
    let cancelled = false;

    if (!isSupabaseConfigured || !boardId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void supabase
      .from('board_theme_configs')
      .select('*')
      .eq('id', boardId)
      .eq('is_enabled', true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setIsLoading(false);
        if (error || !data) return;
        setRemoteTheme({ id: boardId, theme: themeFromBoardConfig(data) });
      });

    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const theme =
    remoteTheme && remoteTheme.id === boardId ? remoteTheme.theme : fallbackTheme;
  return { theme, isLoading };
}
