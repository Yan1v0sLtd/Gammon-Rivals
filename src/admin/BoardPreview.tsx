import { useMemo, useState } from 'react';
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
// The preview MUST render at the same aspect the gameplay canvas uses —
// .game-board-column in index.css forces 4:3 on every viewport. Checker
// radius derives from canvas WIDTH while point depth / stack spacing derive
// from HEIGHT, so the same layout values produce different geometry at a
// different aspect: the old 2:1 preview stretched the art and showed stacks
// ~50% taller relative to the felt than the game (papered over by a 0.75
// checker-size fudge). At 4:3 the preview is geometry-identical to gameplay
// — what the operator tunes here is exactly what players see.
const GAMEPLAY_BOARD_ASPECT = '4 / 3';

export default function BoardPreview({
  gameplayImage,
  whiteChecker,
  blackChecker,
  metadata,
}: Props) {
  // Theme is memoised on ASSETS only so a metadata nudge doesn't bump
  // the reference and force BoardCanvas to tear down + rebuild the
  // Pixi app (which would otherwise replay the deal animation every
  // time the admin nudges a value).
  const draftTheme: Theme | null = useMemo(() => {
    if (!gameplayImage.trim()) return null;
    return {
      ...premiumTheme,
      name: 'preview',
      assets: {
        ...premiumTheme.assets,
        board: normalizeAsset(gameplayImage) ?? premiumTheme.assets?.board,
        whiteChecker: normalizeAsset(whiteChecker) ?? premiumTheme.assets?.whiteChecker,
        blackChecker: normalizeAsset(blackChecker) ?? premiumTheme.assets?.blackChecker,
      },
    };
  }, [gameplayImage, whiteChecker, blackChecker]);

  // Layout is the part that changes on every tuning nudge. Passing it
  // through layoutOverride lets BoardCanvas hot-swap it without
  // recreating the renderer. Merged over premiumTheme.layout EXACTLY like
  // remote.ts themeFromBoardConfig does for gameplay — no preview-only
  // scaling, so the values render identically in both places.
  const layoutOverride = useMemo<ThemeLayout>(() => {
    return {
      ...premiumTheme.layout,
      ...layoutFromMetadataString(metadata),
    };
  }, [metadata]);

  // Seed a few borne-off checkers into the DEFAULT preview so BOTH trays
  // are always populated. The true opening position has 0 off, which left
  // the trays empty — so tray alignment was blind unless you found the
  // toggle. The board still shows the opening layout for on-board tuning.
  const initialState = useMemo(() => {
    const base = initialBoard();
    return { ...base, off: { white: 8, black: 8 } };
  }, []);
  // "Bear-off only" view: empty board, full trays (15 each) so the operator
  // can verify the whole stack fits the tray height + spacing without the
  // on-board checkers in the way.
  const bearOffState = useMemo(() => {
    const base = initialBoard();
    return {
      ...base,
      points: base.points.map((p) => ({ ...p, owner: null, count: 0 })),
      bar: { white: 0, black: 0 },
      off: { white: 15, black: 15 },
    };
  }, []);
  const [showBearOff, setShowBearOff] = useState(false);

  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="mb-1.5 flex items-center justify-between">
        <span>Live preview</span>
        <button
          type="button"
          onClick={() => setShowBearOff((v) => !v)}
          className={`rounded px-2 py-1 text-[10px] font-bold normal-case tracking-normal transition ${
            showBearOff
              ? 'bg-amber-300/90 text-black'
              : 'bg-slate-800 text-white/70 hover:bg-slate-700'
          }`}
        >
          {showBearOff ? 'Bear-off only ✓' : 'Bear-off only'}
        </button>
      </div>
      <div
        className="relative w-full overflow-visible rounded-lg border border-white/10 bg-black/40"
        style={{ aspectRatio: GAMEPLAY_BOARD_ASPECT }}
      >
        {draftTheme ? (
          <div className="absolute inset-0">
            <BoardCanvas state={showBearOff ? bearOffState : initialState} theme={draftTheme} layoutOverride={layoutOverride} />
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
