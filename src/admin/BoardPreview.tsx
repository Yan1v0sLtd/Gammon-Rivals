import { useMemo } from 'react';
import BoardCanvas from '../board/BoardCanvas';
import { initialBoard } from '../engine/board';
import { premiumTheme } from '../board/theme/premium';
import type { Theme, ThemeLayout } from '../board/theme';

interface Props {
  gameplayImage: string;
  whiteChecker: string;
  blackChecker: string;
  metadata: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeAsset(path: string | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) return undefined;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function layoutFromMetadataString(metadata: string): Partial<ThemeLayout> {
  if (!metadata.trim()) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!isObject(parsed) || !isObject(parsed.layout)) return {};
    // Pass the layout fields through without strict typing — anything
    // the engine doesn't recognize is harmlessly ignored.
    return parsed.layout as Partial<ThemeLayout>;
  } catch {
    return {};
  }
}

/**
 * Live mini-game preview of the back-office board draft. Renders an
 * actual BoardCanvas using the draft's gameplay/checker images and
 * metadata.layout, populated with the initial backgammon starting
 * position. Updates instantly as the user nudges felt corners /
 * point depth / stack spacing / checker radius.
 */
export default function BoardPreview({
  gameplayImage,
  whiteChecker,
  blackChecker,
  metadata,
}: Props) {
  const draftTheme: Theme | null = useMemo(() => {
    if (!gameplayImage.trim()) return null;
    const layoutOverride = layoutFromMetadataString(metadata);
    return {
      ...premiumTheme,
      name: 'preview',
      assets: {
        ...premiumTheme.assets,
        board: normalizeAsset(gameplayImage) ?? premiumTheme.assets?.board,
        whiteChecker: normalizeAsset(whiteChecker) ?? premiumTheme.assets?.whiteChecker,
        blackChecker: normalizeAsset(blackChecker) ?? premiumTheme.assets?.blackChecker,
      },
      layout: {
        ...premiumTheme.layout,
        ...layoutOverride,
      },
    };
  }, [gameplayImage, whiteChecker, blackChecker, metadata]);

  const initialState = useMemo(() => initialBoard(), []);

  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="mb-1.5 flex items-center justify-between">
        <span>Live preview</span>
        <span className="text-[10px] normal-case tracking-normal text-white/35">
          Initial position rendered with the current tuning
        </span>
      </div>
      <div
        className="relative w-full overflow-visible rounded-lg border border-white/10 bg-black/40"
        style={{ aspectRatio: '2 / 1' }}
      >
        {draftTheme ? (
          <div className="absolute inset-0">
            <BoardCanvas state={initialState} theme={draftTheme} />
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[10px] font-bold normal-case tracking-normal text-white/40">
            Upload the Gameplay image above to see the live preview.
          </div>
        )}
      </div>
    </div>
  );
}
