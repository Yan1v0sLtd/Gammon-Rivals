import { useMemo, useState } from 'react';
import type { AlignmentDebugSelection } from '../board/pixi/BoardRenderer';
import type { ThemeLayout } from '../board/theme';

type RatioKey =
  | 'topPointCenterXRatios'
  | 'bottomPointCenterXRatios'
  | 'topPointTipXRatios'
  | 'bottomPointTipXRatios';
type OffsetKey = 'topCheckerOffsetXRatios' | 'bottomCheckerOffsetXRatios';

interface Props {
  layout: ThemeLayout;
  debug: AlignmentDebugSelection;
  stackCount: number;
  onDebugChange: (next: AlignmentDebugSelection) => void;
  onLayoutChange: (next: ThemeLayout) => void;
  onReset: () => void;
}

function ratioKey(side: AlignmentDebugSelection['side'], anchor: 'base' | 'tip'): RatioKey {
  if (side === 'top') return anchor === 'base' ? 'topPointCenterXRatios' : 'topPointTipXRatios';
  return anchor === 'base' ? 'bottomPointCenterXRatios' : 'bottomPointTipXRatios';
}

function offsetKey(side: AlignmentDebugSelection['side']): OffsetKey {
  return side === 'top' ? 'topCheckerOffsetXRatios' : 'bottomCheckerOffsetXRatios';
}

function ratiosFor(layout: ThemeLayout, key: RatioKey): number[] {
  const source = layout[key] ?? [];
  return Array.from({ length: 12 }, (_, idx) => Number(source[idx] ?? 0));
}

function offsetsFor(layout: ThemeLayout, key: OffsetKey): number[] {
  const source = layout[key] ?? [];
  return Array.from({ length: 12 }, (_, idx) => Number(source[idx] ?? 0));
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function AlignmentPanel({
  layout,
  debug,
  onDebugChange,
  onLayoutChange,
  onReset,
}: Props) {
  const [copyState, setCopyState] = useState('');
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('right');
  const key = ratioKey(debug.side, debug.anchor === 'tip' ? 'tip' : 'base');
  const checkerOffsetKey = offsetKey(debug.side);
  const currentRatios = ratiosFor(layout, key);
  const currentOffsets = offsetsFor(layout, checkerOffsetKey);
  const currentValue =
    debug.anchor === 'topChecker'
      ? currentOffsets[debug.column] ?? 0
      : currentRatios[debug.column] ?? 0;
  const sidePaddingKey =
    debug.side === 'top' ? 'topCheckerPaddingRatio' : 'bottomCheckerPaddingRatio';
  const sidePaddingValue = layout[sidePaddingKey] ?? 1;
  const spacingValue = layout.checkerStackSpacingRatio ?? 1;

  const exportText = useMemo(
    () =>
      JSON.stringify(
        {
          topPointCenterXRatios: layout.topPointCenterXRatios,
          topPointTipXRatios: layout.topPointTipXRatios,
          bottomPointCenterXRatios: layout.bottomPointCenterXRatios,
          bottomPointTipXRatios: layout.bottomPointTipXRatios,
          topCheckerOffsetXRatios: layout.topCheckerOffsetXRatios,
          bottomCheckerOffsetXRatios: layout.bottomCheckerOffsetXRatios,
          checkerStackSpacingRatio: layout.checkerStackSpacingRatio,
          topCheckerPaddingRatio: layout.topCheckerPaddingRatio,
          bottomCheckerPaddingRatio: layout.bottomCheckerPaddingRatio,
        },
        null,
        2
      ),
    [
      layout.bottomPointCenterXRatios,
      layout.bottomPointTipXRatios,
      layout.bottomCheckerOffsetXRatios,
      layout.bottomCheckerPaddingRatio,
      layout.checkerStackSpacingRatio,
      layout.topCheckerOffsetXRatios,
      layout.topPointCenterXRatios,
      layout.topPointTipXRatios,
      layout.topCheckerPaddingRatio,
    ]
  );

  const updateDebug = (patch: Partial<AlignmentDebugSelection>) => {
    setCopyState('');
    onDebugChange({ ...debug, ...patch, enabled: true });
  };

  const setSelectedX = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    if (debug.anchor === 'topChecker') {
      const nextOffsets = [...currentOffsets];
      nextOffsets[debug.column] = roundRatio(clamp(value, -0.15, 0.15));
      onLayoutChange({ ...layout, [checkerOffsetKey]: nextOffsets });
      return;
    }

    const nextRatios = [...currentRatios];
    nextRatios[debug.column] = roundRatio(value);
    onLayoutChange({ ...layout, [key]: nextRatios });
  };

  const nudge = (delta: number) => {
    setCopyState('');
    if (debug.anchor === 'topChecker') {
      const nextOffsets = [...currentOffsets];
      nextOffsets[debug.column] = roundRatio(clamp((currentOffsets[debug.column] ?? 0) + delta, -0.15, 0.15));
      onLayoutChange({ ...layout, [checkerOffsetKey]: nextOffsets });
      return;
    }

    const nextRatios = [...currentRatios];
    nextRatios[debug.column] = roundRatio(currentValue + delta);
    onLayoutChange({ ...layout, [key]: nextRatios });
  };

  const nudgePadding = (delta: number) => {
    setCopyState('');
    onLayoutChange({
      ...layout,
      [sidePaddingKey]: roundRatio(clamp(sidePaddingValue + delta, 0.2, 2.5)),
    });
  };

  const setPadding = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    onLayoutChange({
      ...layout,
      [sidePaddingKey]: roundRatio(clamp(value, 0.2, 2.5)),
    });
  };

  const nudgeSpacing = (delta: number) => {
    setCopyState('');
    onLayoutChange({
      ...layout,
      checkerStackSpacingRatio: roundRatio(clamp(spacingValue + delta, 0.55, 1.45)),
    });
  };

  const setSpacing = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    onLayoutChange({
      ...layout,
      checkerStackSpacingRatio: roundRatio(clamp(value, 0.55, 1.45)),
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyState('Copied');
    } catch {
      setCopyState('Select the text below');
    }
  };

  const panelPosition = panelSide === 'left' ? 'left-3' : 'right-3';

  return (
    <div className={`fixed bottom-3 ${panelPosition} z-50 w-[min(92vw,430px)] rounded-lg border border-cyan-300/30 bg-[#07111f]/95 p-3 text-sm text-slate-100 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-semibold text-cyan-100">Alignment mode</div>
        <button
          type="button"
          onClick={() => setPanelSide(panelSide === 'left' ? 'right' : 'left')}
          className="rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-100"
        >
          Move panel
        </button>
      </div>
      <div className="mb-2 text-xs text-cyan-200/70">
        {debug.side} {debug.column + 1} · {debug.anchor === 'topChecker' ? 'top checker' : debug.anchor}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Row</div>
          <div className="grid grid-cols-2 gap-1">
            {(['bottom', 'top'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => updateDebug({ side })}
                className={`rounded border px-2 py-1 ${
                  debug.side === side
                    ? 'border-cyan-300 bg-cyan-300 text-slate-950'
                    : 'border-slate-600 bg-slate-900 text-slate-200'
                }`}
              >
                {side}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Anchor</div>
          <div className="grid grid-cols-3 gap-1">
            {(['base', 'tip', 'topChecker'] as const).map((anchor) => (
              <button
                key={anchor}
                type="button"
                onClick={() => updateDebug({ anchor })}
                className={`rounded border px-2 py-1 ${
                  debug.anchor === anchor
                    ? 'border-fuchsia-300 bg-fuchsia-300 text-slate-950'
                    : 'border-slate-600 bg-slate-900 text-slate-200'
                }`}
              >
                {anchor === 'topChecker' ? 'top checker' : anchor}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Point</div>
        <div className="grid grid-cols-12 gap-1">
          {Array.from({ length: 12 }, (_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => updateDebug({ column: idx })}
              className={`h-7 rounded border text-xs ${
                debug.column === idx
                  ? 'border-amber-300 bg-amber-300 text-slate-950'
                  : 'border-slate-600 bg-slate-900 text-slate-200'
              }`}
            >
              {idx + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <button type="button" onClick={() => nudge(-0.008)} className="rounded bg-slate-800 px-2 py-2">
          ← 12px
        </button>
        <button type="button" onClick={() => nudge(-0.002)} className="rounded bg-slate-800 px-2 py-2">
          ← 3px
        </button>
        <button type="button" onClick={() => nudge(0.002)} className="rounded bg-slate-800 px-2 py-2">
          3px →
        </button>
        <button type="button" onClick={() => nudge(0.008)} className="rounded bg-slate-800 px-2 py-2">
          12px →
        </button>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_8rem] items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-300">
        <span>{debug.anchor === 'topChecker' ? `${checkerOffsetKey}[${debug.column}]` : `${key}[${debug.column}]`}</span>
        <input
          type="number"
          min={debug.anchor === 'topChecker' ? -0.15 : 0}
          max={debug.anchor === 'topChecker' ? 0.15 : 1}
          step={0.001}
          value={currentValue.toFixed(4)}
          onChange={(event) => setSelectedX(Number(event.target.value))}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-100"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Board padding</div>
          <div className="grid grid-cols-4 gap-1">
            <button type="button" onClick={() => nudgePadding(-0.3)} className="rounded bg-slate-800 px-2 py-2">
              -big
            </button>
            <button type="button" onClick={() => nudgePadding(-0.08)} className="rounded bg-slate-800 px-2 py-2">
              -
            </button>
            <button type="button" onClick={() => nudgePadding(0.08)} className="rounded bg-slate-800 px-2 py-2">
              +
            </button>
            <button type="button" onClick={() => nudgePadding(0.3)} className="rounded bg-slate-800 px-2 py-2">
              big+
            </button>
          </div>
          <input
            type="number"
            min={0.2}
            max={2.5}
            step={0.01}
            value={sidePaddingValue.toFixed(2)}
            onChange={(event) => setPadding(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            aria-label={sidePaddingKey}
          />
        </div>

        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Checker spacing</div>
          <div className="grid grid-cols-4 gap-1">
            <button type="button" onClick={() => nudgeSpacing(-0.16)} className="rounded bg-slate-800 px-2 py-2">
              -big
            </button>
            <button type="button" onClick={() => nudgeSpacing(-0.04)} className="rounded bg-slate-800 px-2 py-2">
              -
            </button>
            <button type="button" onClick={() => nudgeSpacing(0.04)} className="rounded bg-slate-800 px-2 py-2">
              +
            </button>
            <button type="button" onClick={() => nudgeSpacing(0.16)} className="rounded bg-slate-800 px-2 py-2">
              big+
            </button>
          </div>
          <input
            type="number"
            min={0.55}
            max={1.45}
            step={0.01}
            value={spacingValue.toFixed(2)}
            onChange={(event) => setSpacing(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            aria-label="checkerStackSpacingRatio"
          />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex-1 rounded bg-cyan-300 px-3 py-2 font-semibold text-slate-950"
        >
          Copy numbers
        </button>
        <button type="button" onClick={onReset} className="rounded border border-slate-600 px-3 py-2">
          Reset
        </button>
      </div>
      {copyState && <div className="mt-2 text-xs text-cyan-200">{copyState}</div>}

      <textarea
        readOnly
        value={exportText}
        className="mt-2 h-24 w-full resize-none rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-300"
      />
    </div>
  );
}
