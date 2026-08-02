import {useEffect, useMemo, useRef, useState} from 'react';
import type {AlignmentDebugSelection} from '../../../../packages/board-renderer/src/pixi/BoardRenderer';
import type {ThemeLayout} from '../../../../packages/board-renderer/src/theme/types';

type RatioKey = | 'topPointCenterXRatios' | 'bottomPointCenterXRatios' | 'topPointTipXRatios' | 'bottomPointTipXRatios';
type OffsetKey = 'topCheckerOffsetXRatios' | 'bottomCheckerOffsetXRatios';
type EdgeKey = 'topPointYRatio' | 'bottomPointYRatio';

const EDGE_MIN = 0;
const EDGE_MAX = 1;
const PADDING_MIN = -0.5;
const PADDING_MAX = 2.5;
const POINT_HEIGHT_MIN = 0.08;
const POINT_HEIGHT_MAX = 0.6;
const SPACING_MIN = 0.55;
const SPACING_MAX = 1.45;
const OFF_X_MIN = 0;
const OFF_X_MAX = 1;
const OFF_TOP_MIN = 0;
const OFF_TOP_MAX = 1;
const OFF_HEIGHT_MIN = 0.05;
const OFF_HEIGHT_MAX = 0.7;
const OFF_SPACING_MIN = 0.2;
const OFF_SPACING_MAX = 1.2;
const OFF_TILT_MIN = -45;
const OFF_TILT_MAX = 45;

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
  return Array.from({length: 12}, (_, idx) => Number(source[idx] ?? 0));
}

function offsetsFor(layout: ThemeLayout, key: OffsetKey): number[] {
  const source = layout[key] ?? [];
  return Array.from({length: 12}, (_, idx) => Number(source[idx] ?? 0));
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
  // Drag position override. When non-null, the panel is positioned
  // absolutely at (x, y) and the panelSide default is ignored.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    opLeft: number;
    opTop: number;
    maxX: number;
    maxY: number;
    margin: number;
    lastLocalX: number;
    lastLocalY: number;
    pointerId: number;
    captureTarget: HTMLElement | null;
  } | null>(null);
  const panelEl = useRef<HTMLDivElement | null>(null);

  // Window-level pointer handlers. Every pointermove only stashes the
  // latest (clientX, clientY) and schedules a single rAF write — so
  // even at 240Hz event rates we touch the DOM at most once per frame.
  // We also avoid layout reads (getBoundingClientRect / offsetWidth) in
  // the hot path: clamp bounds and offsetParent rect are snapshotted
  // once at drag start, since the panel size doesn't change mid-drag.
  useEffect(() => {
    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;
    let pending = false;

    const flush = () => {
      rafId = 0;
      if (!pending) return;
      pending = false;
      const ref = dragRef.current;
      if (!ref) return;
      const dx = pendingX - ref.startMouseX;
      const dy = pendingY - ref.startMouseY;
      const x = Math.min(ref.maxX, Math.max(ref.margin, ref.startX + dx));
      const y = Math.min(ref.maxY, Math.max(ref.margin, ref.startY + dy));
      const localX = x - ref.opLeft;
      const localY = y - ref.opTop;
      ref.lastLocalX = localX;
      ref.lastLocalY = localY;
      const el = panelEl.current;
      if (el) {
        el.style.left = `${localX}px`;
        el.style.top = `${localY}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      // Stop the browser from treating the gesture as a scroll/swipe
      // (which would fire pointercancel and end the drag mid-stride).
      event.preventDefault();
      pendingX = event.clientX;
      pendingY = event.clientY;
      pending = true;
      if (!rafId) rafId = requestAnimationFrame(flush);
    };
    const onUp = (event: PointerEvent) => {
      const ref = dragRef.current;
      if (!ref) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      // Flush any pending move so the committed position matches the
      // last pointer location, not whatever was last rendered.
      if (pending) {
        pending = false;
        const dx = pendingX - ref.startMouseX;
        const dy = pendingY - ref.startMouseY;
        const x = Math.min(ref.maxX, Math.max(ref.margin, ref.startX + dx));
        const y = Math.min(ref.maxY, Math.max(ref.margin, ref.startY + dy));
        ref.lastLocalX = x - ref.opLeft;
        ref.lastLocalY = y - ref.opTop;
      }
      setDragPos({
        x: ref.lastLocalX,
        y: ref.lastLocalY
      });
      if (ref.captureTarget) {
        try {
          ref.captureTarget.releasePointerCapture(event.pointerId);
        }
        catch {
          // pointer already released
        }
      }
      dragRef.current = null;
      document.body.style.userSelect = '';
    };
    // passive: false so preventDefault inside onMove is honored.
    window.addEventListener('pointermove', onMove, {passive: false});
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // When the user snaps back to a corner (dragPos -> null), the inline
  // left/top/right/bottom we wrote imperatively during drag would
  // otherwise persist and keep the panel stuck where it was. Clear
  // them whenever dragPos becomes null so the Tailwind corner anchors
  // (top-3 + left-3/right-3) take over again.
  useEffect(() => {
    if (dragPos !== null) return;
    const el = panelEl.current;
    if (!el) return;
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
  }, [dragPos]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = panelEl.current;
    if (!el) return;
    // Ignore drags that start on buttons / inputs inside the header
    // (so the "Move panel" / close affordances still click).
    if ((event.target as HTMLElement).closest('button, input, textarea')) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const op = el.offsetParent as HTMLElement | null;
    const opRect = op?.getBoundingClientRect();
    const opLeft = opRect?.left ?? 0;
    const opTop = opRect?.top ?? 0;
    const seedLocalX = rect.left - opLeft;
    const seedLocalY = rect.top - opTop;
    const margin = 4;
    // Cache clamp bounds — panel size doesn't change during a drag so
    // we don't want to read offsetWidth/offsetHeight on every move.
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const captureTarget = event.currentTarget as HTMLElement;
    try {
      captureTarget.setPointerCapture(event.pointerId);
    }
    catch {
      // pointer capture not supported; fall back to window listeners
    }
    dragRef.current = {
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startX: rect.left,
      startY: rect.top,
      opLeft,
      opTop,
      maxX,
      maxY,
      margin,
      lastLocalX: seedLocalX,
      lastLocalY: seedLocalY,
      pointerId: event.pointerId,
      captureTarget,
    };
    // Seed dragPos so the panel switches from corner-anchored to
    // absolute-positioned (so a click without movement still works).
    setDragPos({
      x: seedLocalX,
      y: seedLocalY
    });
    document.body.style.userSelect = 'none';
  };
  const key = ratioKey(debug.side, debug.anchor === 'tip' ? 'tip' : 'base');
  const checkerOffsetKey = offsetKey(debug.side);
  const currentRatios = ratiosFor(layout, key);
  const currentOffsets = offsetsFor(layout, checkerOffsetKey);
  const currentValue = debug.anchor === 'topChecker' ? currentOffsets[debug.column] ?? 0 : currentRatios[debug.column] ?? 0;
  const sidePaddingKey = debug.side === 'top' ? 'topCheckerPaddingRatio' : 'bottomCheckerPaddingRatio';
  const sidePaddingValue = layout[sidePaddingKey] ?? 1;
  const sideEdgeKey: EdgeKey = debug.side === 'top' ? 'topPointYRatio' : 'bottomPointYRatio';
  const sideEdgeValue = layout[sideEdgeKey] ?? (debug.side === 'top' ? 0 : 1);
  // Per-row point depth / stack spacing — fall back to the shared
  // legacy fields when the per-row override isn't set yet.
  const sharedPointHeight = layout.pointHeightRatio ?? 0.44;
  const sharedSpacing = layout.checkerStackSpacingRatio ?? 1;
  const pointHeightKey = debug.side === 'top' ? 'topPointHeightRatio' : 'bottomPointHeightRatio';
  const spacingKey = debug.side === 'top' ? 'topCheckerStackSpacingRatio' : 'bottomCheckerStackSpacingRatio';
  const pointHeightValue = layout[pointHeightKey] ?? sharedPointHeight;
  const spacingValue = layout[spacingKey] ?? sharedSpacing;

  const exportText = useMemo(() => JSON.stringify({
    topPointCenterXRatios: layout.topPointCenterXRatios,
    topPointTipXRatios: layout.topPointTipXRatios,
    bottomPointCenterXRatios: layout.bottomPointCenterXRatios,
    bottomPointTipXRatios: layout.bottomPointTipXRatios,
    topCheckerOffsetXRatios: layout.topCheckerOffsetXRatios,
    bottomCheckerOffsetXRatios: layout.bottomCheckerOffsetXRatios,
    pointHeightRatio: layout.pointHeightRatio,
    topPointHeightRatio: layout.topPointHeightRatio,
    bottomPointHeightRatio: layout.bottomPointHeightRatio,
    topPointYRatio: layout.topPointYRatio,
    bottomPointYRatio: layout.bottomPointYRatio,
    checkerStackSpacingRatio: layout.checkerStackSpacingRatio,
    topCheckerStackSpacingRatio: layout.topCheckerStackSpacingRatio,
    bottomCheckerStackSpacingRatio: layout.bottomCheckerStackSpacingRatio,
    topCheckerPaddingRatio: layout.topCheckerPaddingRatio,
    bottomCheckerPaddingRatio: layout.bottomCheckerPaddingRatio,
    blackOffTrayXRatio: layout.blackOffTrayXRatio,
    blackOffTrayTopRatio: layout.blackOffTrayTopRatio,
    blackOffTrayHeightRatio: layout.blackOffTrayHeightRatio,
    whiteOffTrayXRatio: layout.whiteOffTrayXRatio,
    whiteOffTrayTopRatio: layout.whiteOffTrayTopRatio,
    whiteOffTrayHeightRatio: layout.whiteOffTrayHeightRatio,
    offCheckerStackSpacingRatio: layout.offCheckerStackSpacingRatio,
    blackOffTrayTiltDeg: layout.blackOffTrayTiltDeg,
    whiteOffTrayTiltDeg: layout.whiteOffTrayTiltDeg,
  }, null, 2), [layout.bottomPointCenterXRatios, layout.bottomPointTipXRatios, layout.bottomCheckerOffsetXRatios, layout.bottomPointYRatio, layout.bottomCheckerPaddingRatio, layout.checkerStackSpacingRatio, layout.topCheckerStackSpacingRatio, layout.bottomCheckerStackSpacingRatio, layout.pointHeightRatio, layout.topPointHeightRatio, layout.bottomPointHeightRatio, layout.topCheckerOffsetXRatios, layout.topPointCenterXRatios, layout.topPointTipXRatios, layout.topPointYRatio, layout.topCheckerPaddingRatio, layout.blackOffTrayXRatio, layout.blackOffTrayTopRatio, layout.blackOffTrayHeightRatio, layout.whiteOffTrayXRatio, layout.whiteOffTrayTopRatio, layout.whiteOffTrayHeightRatio, layout.offCheckerStackSpacingRatio, layout.blackOffTrayTiltDeg, layout.whiteOffTrayTiltDeg,]);

  const updateDebug = (patch: Partial<AlignmentDebugSelection>) => {
    setCopyState('');
    onDebugChange({
      ...debug, ...patch,
      enabled: true
    });
  };

  const setSelectedX = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    if (debug.anchor === 'topChecker') {
      const nextOffsets = [...currentOffsets];
      nextOffsets[debug.column] = roundRatio(clamp(value, -0.25, 0.25));
      onLayoutChange({
        ...layout,
        [checkerOffsetKey]: nextOffsets
      });
      return;
    }

    const nextRatios = [...currentRatios];
    nextRatios[debug.column] = roundRatio(value);
    onLayoutChange({
      ...layout,
      [key]: nextRatios
    });
  };

  const nudge = (delta: number) => {
    setCopyState('');
    if (debug.anchor === 'topChecker') {
      const nextOffsets = [...currentOffsets];
      nextOffsets[debug.column] = roundRatio(clamp((currentOffsets[debug.column] ?? 0) + delta, -0.25, 0.25));
      onLayoutChange({
        ...layout,
        [checkerOffsetKey]: nextOffsets
      });
      return;
    }

    const nextRatios = [...currentRatios];
    nextRatios[debug.column] = roundRatio(currentValue + delta);
    onLayoutChange({
      ...layout,
      [key]: nextRatios
    });
  };

  const nudgePadding = (delta: number) => {
    setCopyState('');
    onLayoutChange({
      ...layout,
      [sidePaddingKey]: roundRatio(clamp(sidePaddingValue + delta, PADDING_MIN, PADDING_MAX)),
    });
  };

  const setPadding = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    onLayoutChange({
      ...layout,
      [sidePaddingKey]: roundRatio(clamp(value, PADDING_MIN, PADDING_MAX)),
    });
  };

  const nudgeEdge = (delta: number) => {
    setCopyState('');
    onLayoutChange({
      ...layout,
      [sideEdgeKey]: roundRatio(clamp(sideEdgeValue + delta, EDGE_MIN, EDGE_MAX)),
    });
  };

  const setEdge = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    onLayoutChange({
      ...layout,
      [sideEdgeKey]: roundRatio(clamp(value, EDGE_MIN, EDGE_MAX)),
    });
  };

  const nudgePointHeight = (delta: number) => {
    setCopyState('');
    onLayoutChange({
      ...layout,
      [pointHeightKey]: roundRatio(clamp(pointHeightValue + delta, POINT_HEIGHT_MIN, POINT_HEIGHT_MAX)),
    });
  };

  const setPointHeight = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    onLayoutChange({
      ...layout,
      [pointHeightKey]: roundRatio(clamp(value, POINT_HEIGHT_MIN, POINT_HEIGHT_MAX)),
    });
  };

  const nudgeSpacing = (delta: number) => {
    setCopyState('');
    onLayoutChange({
      ...layout,
      [spacingKey]: roundRatio(clamp(spacingValue + delta, SPACING_MIN, SPACING_MAX)),
    });
  };

  const setSpacing = (value: number) => {
    if (!Number.isFinite(value)) return;
    setCopyState('');
    onLayoutChange({
      ...layout,
      [spacingKey]: roundRatio(clamp(value, SPACING_MIN, SPACING_MAX)),
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyState('Copied');
    }
    catch {
      setCopyState('Select the text below');
    }
  };

  const panelPosition = panelSide === 'left' ? 'left-3' : 'right-3';
  // While the user has manually dragged the panel, anchor it to (x, y)
  // via inline styles. Otherwise let the Tailwind corner classes pin it.
  const dragStyle: React.CSSProperties | undefined = dragPos ? {
    left: dragPos.x,
    top: dragPos.y,
    right: 'auto',
    bottom: 'auto'
  } : undefined;

  return (<div
    ref={panelEl}
    style={dragStyle}
    className={`fixed top-3 ${panelPosition} z-50 max-h-[calc(100dvh-1.5rem)] w-[min(92vw,430px)] overflow-auto rounded-lg border border-cyan-300/30 bg-[#07111f]/95 p-3 text-sm text-slate-100 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur`}
  >
    <div
      onPointerDown={startDrag}
      className="mb-2 flex cursor-grab items-center justify-between gap-3 active:cursor-grabbing select-none"
      style={{touchAction: 'none'}}
      title="Drag to move"
    >
      <div className="font-semibold text-cyan-100">⋮⋮ Alignment mode</div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // "Reset to corner" if the panel was dragged; otherwise
          // flip the corner side.
          if (dragPos) setDragPos(null); else setPanelSide(panelSide === 'left' ? 'right' : 'left');
        }}
        className="rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-100"
      >
        {dragPos ? 'Snap corner' : 'Move panel'}
      </button>
    </div>
    <div className="mb-2 text-xs text-cyan-200/70">
      {(debug.target ?? 'point') === 'point' ? `${debug.side} ${debug.column + 1} · ${debug.anchor === 'topChecker' ? 'top checker' : debug.anchor}` : `${debug.target === 'offWhite' ? 'white' : 'black'} off-tray`}
    </div>

    <div className="mb-3">
      <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Target</div>
      <div className="grid grid-cols-3 gap-1">
        {([['point', 'Point'], ['offWhite', 'Off (white)'], ['offBlack', 'Off (black)'],] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => updateDebug({target: value})}
            className={`rounded border px-2 py-1 text-xs ${(debug.target ?? 'point') === value ? 'border-emerald-300 bg-emerald-300 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200'}`}
          >
            {label}
          </button>))}
      </div>
    </div>

    {(debug.target ?? 'point') !== 'point' ? (<OffTrayControls
      owner={debug.target === 'offWhite' ? 'white' : 'black'}
      layout={layout}
      onLayoutChange={(next) => {
        setCopyState('');
        onLayoutChange(next);
      }}
    />) : (<>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Row</div>
          <div className="grid grid-cols-2 gap-1">
            {(['bottom', 'top'] as const).map((side) => (<button
              key={side}
              type="button"
              onClick={() => updateDebug({side})}
              className={`rounded border px-2 py-1 ${debug.side === side ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200'}`}
            >
              {side}
            </button>))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Anchor</div>
          <div className="grid grid-cols-3 gap-1">
            {(['base', 'tip', 'topChecker'] as const).map((anchor) => (<button
              key={anchor}
              type="button"
              onClick={() => updateDebug({anchor})}
              className={`rounded border px-2 py-1 ${debug.anchor === anchor ? 'border-fuchsia-300 bg-fuchsia-300 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200'}`}
            >
              {anchor === 'topChecker' ? 'top checker' : anchor}
            </button>))}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Point</div>
        <div className="grid grid-cols-12 gap-1">
          {Array.from({length: 12}, (_, idx) => (<button
            key={idx}
            type="button"
            onClick={() => updateDebug({column: idx})}
            className={`h-7 rounded border text-xs ${debug.column === idx ? 'border-amber-300 bg-amber-300 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200'}`}
          >
            {idx + 1}
          </button>))}
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

      <div
        className="mt-2 grid grid-cols-[1fr_8rem] items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-300">
        <span>{debug.anchor === 'topChecker' ? `${checkerOffsetKey}[${debug.column}]` : `${key}[${debug.column}]`}</span>
        <input
          type="number"
          min={debug.anchor === 'topChecker' ? -0.25 : 0}
          max={debug.anchor === 'topChecker' ? 0.25 : 1}
          step={0.001}
          value={currentValue.toFixed(4)}
          onChange={(event) => setSelectedX(Number(event.target.value))}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-100"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Row edge</div>
          <div className="grid grid-cols-4 gap-1">
            <button type="button" onClick={() => nudgeEdge(-0.02)} className="rounded bg-slate-800 px-2 py-2">
              ↑ big
            </button>
            <button type="button" onClick={() => nudgeEdge(-0.005)} className="rounded bg-slate-800 px-2 py-2">
              ↑
            </button>
            <button type="button" onClick={() => nudgeEdge(0.005)} className="rounded bg-slate-800 px-2 py-2">
              ↓
            </button>
            <button type="button" onClick={() => nudgeEdge(0.02)} className="rounded bg-slate-800 px-2 py-2">
              big ↓
            </button>
          </div>
          <input
            type="number"
            min={EDGE_MIN}
            max={EDGE_MAX}
            step={0.001}
            value={sideEdgeValue.toFixed(4)}
            onChange={(event) => setEdge(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            aria-label={sideEdgeKey}
          />
        </div>

        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
            Point depth ({debug.side})
          </div>
          <div className="grid grid-cols-4 gap-1">
            <button type="button" onClick={() => nudgePointHeight(-0.03)}
                    className="rounded bg-slate-800 px-2 py-2">
              -big
            </button>
            <button type="button" onClick={() => nudgePointHeight(-0.006)}
                    className="rounded bg-slate-800 px-2 py-2">
              -
            </button>
            <button type="button" onClick={() => nudgePointHeight(0.006)}
                    className="rounded bg-slate-800 px-2 py-2">
              +
            </button>
            <button type="button" onClick={() => nudgePointHeight(0.03)} className="rounded bg-slate-800 px-2 py-2">
              big+
            </button>
          </div>
          <input
            type="number"
            min={POINT_HEIGHT_MIN}
            max={POINT_HEIGHT_MAX}
            step={0.001}
            value={pointHeightValue.toFixed(4)}
            onChange={(event) => setPointHeight(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            aria-label={pointHeightKey}
          />
        </div>
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
            min={PADDING_MIN}
            max={PADDING_MAX}
            step={0.01}
            value={sidePaddingValue.toFixed(2)}
            onChange={(event) => setPadding(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            aria-label={sidePaddingKey}
          />
        </div>

        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
            Checker spacing ({debug.side})
          </div>
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
            min={SPACING_MIN}
            max={SPACING_MAX}
            step={0.01}
            value={spacingValue.toFixed(2)}
            onChange={(event) => setSpacing(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            aria-label={spacingKey}
          />
        </div>
      </div>

    </>)}

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
  </div>);
}

type OffOwner = 'white' | 'black';
type OffXKey = 'whiteOffTrayXRatio' | 'blackOffTrayXRatio';
type OffTopKey = 'whiteOffTrayTopRatio' | 'blackOffTrayTopRatio';
type OffHeightKey = 'whiteOffTrayHeightRatio' | 'blackOffTrayHeightRatio';
type OffTiltKey = 'whiteOffTrayTiltDeg' | 'blackOffTrayTiltDeg';

interface OffTrayProps {
  owner: OffOwner;
  layout: ThemeLayout;
  onLayoutChange: (next: ThemeLayout) => void;
}

function OffTrayControls({
  owner,
  layout,
  onLayoutChange
}: OffTrayProps) {
  const xKey: OffXKey = owner === 'white' ? 'whiteOffTrayXRatio' : 'blackOffTrayXRatio';
  const topKey: OffTopKey = owner === 'white' ? 'whiteOffTrayTopRatio' : 'blackOffTrayTopRatio';
  const heightKey: OffHeightKey = owner === 'white' ? 'whiteOffTrayHeightRatio' : 'blackOffTrayHeightRatio';
  const tiltKey: OffTiltKey = owner === 'white' ? 'whiteOffTrayTiltDeg' : 'blackOffTrayTiltDeg';

  const x = layout[xKey] ?? 0.925;
  const top = layout[topKey] ?? (owner === 'white' ? 0.61 : 0.145);
  const height = layout[heightKey] ?? 0.255;
  const spacing = layout.offCheckerStackSpacingRatio ?? 0.56;
  const tilt = layout[tiltKey] ?? 0;

  const update = (patch: Partial<ThemeLayout>) => onLayoutChange({...layout, ...patch});
  const setX = (value: number) => update({[xKey]: roundRatio(clamp(value, OFF_X_MIN, OFF_X_MAX))});
  const nudgeX = (delta: number) => setX(x + delta);
  const setTop = (value: number) => update({[topKey]: roundRatio(clamp(value, OFF_TOP_MIN, OFF_TOP_MAX))});
  const nudgeTop = (delta: number) => setTop(top + delta);
  const setHeight = (value: number) => update({[heightKey]: roundRatio(clamp(value, OFF_HEIGHT_MIN, OFF_HEIGHT_MAX))});
  const nudgeHeight = (delta: number) => setHeight(height + delta);
  const setSpacing = (value: number) => update({offCheckerStackSpacingRatio: roundRatio(clamp(value, OFF_SPACING_MIN, OFF_SPACING_MAX))});
  const nudgeSpacing = (delta: number) => setSpacing(spacing + delta);
  const setTilt = (value: number) => update({[tiltKey]: Math.round(clamp(value, OFF_TILT_MIN, OFF_TILT_MAX) * 10) / 10});
  const nudgeTilt = (delta: number) => setTilt(tilt + delta);

  const row = (label: string, value: number, onNudge: (d: number) => void, onSet: (v: number) => void, bigStep: number, smallStep: number, min: number, max: number, decimals = 4) => (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="grid grid-cols-4 gap-1">
        <button type="button" onClick={() => onNudge(-bigStep)} className="rounded bg-slate-800 px-2 py-2">
          -big
        </button>
        <button type="button" onClick={() => onNudge(-smallStep)} className="rounded bg-slate-800 px-2 py-2">
          -
        </button>
        <button type="button" onClick={() => onNudge(smallStep)} className="rounded bg-slate-800 px-2 py-2">
          +
        </button>
        <button type="button" onClick={() => onNudge(bigStep)} className="rounded bg-slate-800 px-2 py-2">
          big+
        </button>
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={smallStep}
        value={value.toFixed(decimals)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onSet(next);
        }}
        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
        aria-label={label}
      />
    </div>);

  return (<div className="grid grid-cols-2 gap-2">
    {row('Tray X', x, nudgeX, setX, 0.02, 0.004, OFF_X_MIN, OFF_X_MAX)}
    {row('Tray top', top, nudgeTop, setTop, 0.02, 0.004, OFF_TOP_MIN, OFF_TOP_MAX)}
    {row('Tray height', height, nudgeHeight, setHeight, 0.02, 0.004, OFF_HEIGHT_MIN, OFF_HEIGHT_MAX)}
    {row('Stack spacing', spacing, nudgeSpacing, setSpacing, 0.08, 0.02, OFF_SPACING_MIN, OFF_SPACING_MAX, 2)}
    {row('Stack tilt (°)', tilt, nudgeTilt, setTilt, 5, 0.5, OFF_TILT_MIN, OFF_TILT_MAX, 1)}
  </div>);
}
