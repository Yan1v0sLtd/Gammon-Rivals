import {type PointerEvent as ReactPointerEvent, useMemo, useRef, useState,} from 'react';

interface Props {
  gameplayImage: string;
  metadata: string;

  onMetadataChange(next: string): void;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type HalfId = 'left' | 'right';
type Pair = [number, number];

interface Corners {
  tl: Pair;
  tr: Pair;
  bl: Pair;
  br: Pair;
}

interface Halves {
  left: Corners;
  right: Corners;
}

const DEFAULT_CORNERS: Corners = {
  tl: [0.08, 0.08],
  tr: [0.92, 0.08],
  bl: [0.08, 0.92],
  br: [0.92, 0.92],
};

const HALF_KEYS: Record<HalfId, Record<Corner, string>> = {
  left: {
    tl: 'feltLeftHalfTopLeftRatio',
    tr: 'feltLeftHalfTopRightRatio',
    bl: 'feltLeftHalfBottomLeftRatio',
    br: 'feltLeftHalfBottomRightRatio',
  },
  right: {
    tl: 'feltRightHalfTopLeftRatio',
    tr: 'feltRightHalfTopRightRatio',
    bl: 'feltRightHalfBottomLeftRatio',
    br: 'feltRightHalfBottomRightRatio',
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';
}

function parseLayout(metadata: string): Record<string, unknown> {
  if (!metadata.trim()) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!isObject(parsed) || !isObject(parsed.layout)) return {};
    return parsed.layout;
  }
  catch {
    return {};
  }
}

function readCorners(metadata: string): Corners {
  const layout = parseLayout(metadata);
  const tl = isPair(layout.feltInnerTopLeftRatio) ? layout.feltInnerTopLeftRatio : DEFAULT_CORNERS.tl;
  const br = isPair(layout.feltInnerBottomRightRatio) ? layout.feltInnerBottomRightRatio : DEFAULT_CORNERS.br;
  // For TR / BL fall back to axis-aligned derivation so opening a
  // 2-corner board doesn't force the felt to look tilted before the
  // user has touched anything.
  const tr: Pair = isPair(layout.feltInnerTopRightRatio) ? layout.feltInnerTopRightRatio : [br[0], tl[1]];
  const bl: Pair = isPair(layout.feltInnerBottomLeftRatio) ? layout.feltInnerBottomLeftRatio : [tl[0], br[1]];
  return {
    tl,
    tr,
    bl,
    br
  };
}

/** Per-half quads. Present only when BOTH halves have TL + BR (the same
 *  activation rule the engine uses in computeLayout). TR / BL default
 *  axis-aligned per half. */
function readHalves(metadata: string): Halves | null {
  const layout = parseLayout(metadata);
  const half = (id: HalfId): Corners | null => {
    const keys = HALF_KEYS[id];
    const tl = layout[keys.tl];
    const br = layout[keys.br];
    if (!isPair(tl) || !isPair(br)) return null;
    const tr = layout[keys.tr];
    const bl = layout[keys.bl];
    return {
      tl,
      br,
      tr: isPair(tr) ? tr : [br[0], tl[1]],
      bl: isPair(bl) ? bl : [tl[0], br[1]],
    };
  };
  const left = half('left');
  const right = half('right');
  return left && right ? {
    left,
    right
  } : null;
}

function roundPair(value: Pair): Pair {
  return [Math.round(value[0] * 10000) / 10000, Math.round(value[1] * 10000) / 10000];
}

/** Generic metadata.layout patcher: merges `patch` in, removes `removeKeys`,
 *  preserves everything else in the metadata JSON. */
function writeLayoutPatch(metadata: string, patch: Record<string, unknown>, removeKeys: readonly string[] = []): string {
  let parsed: unknown = {};
  if (metadata.trim()) {
    try {
      parsed = JSON.parse(metadata);
    }
    catch {
      parsed = {};
    }
  }
  if (!isObject(parsed)) parsed = {};
  const root = parsed as Record<string, unknown>;
  const layout = isObject(root.layout) ? {...root.layout} : {};
  Object.assign(layout, patch);
  for (const key of removeKeys) delete layout[key];
  root.layout = layout;
  return JSON.stringify(root, null, 2);
}

function writeCorners(metadata: string, corners: Corners): string {
  return writeLayoutPatch(metadata, {
    feltInnerTopLeftRatio: roundPair(corners.tl),
    feltInnerTopRightRatio: roundPair(corners.tr),
    feltInnerBottomLeftRatio: roundPair(corners.bl),
    feltInnerBottomRightRatio: roundPair(corners.br),
  });
}

function writeHalves(metadata: string, halves: Halves): string {
  const patch: Record<string, unknown> = {};
  for (const id of ['left', 'right'] as const) {
    const keys = HALF_KEYS[id];
    const c = halves[id];
    patch[keys.tl] = roundPair(c.tl);
    patch[keys.tr] = roundPair(c.tr);
    patch[keys.bl] = roundPair(c.bl);
    patch[keys.br] = roundPair(c.br);
  }
  return writeLayoutPatch(metadata, patch);
}

function removeHalves(metadata: string): string {
  return writeLayoutPatch(metadata, {}, [...Object.values(HALF_KEYS.left), ...Object.values(HALF_KEYS.right)]);
}

/** Seed the two half quads from the current single quad: split it at the
 *  legacy assumed bar (barWidthRatio, default 0.08) so the starting dots
 *  land where the engine was already placing the points — the operator
 *  then drags them onto the painted halves. Axis-aligned on purpose:
 *  the boards are top-down renders, and per-half tilt stays available by
 *  dragging TR/BL afterwards. */
function splitFromSingle(corners: Corners, barWidthRatio: number): Halves {
  const left = corners.tl[0];
  const top = corners.tl[1];
  const right = corners.br[0];
  const bottom = corners.br[1];
  const playWidth = Math.max(0.01, right - left);
  const barWidth = playWidth * barWidthRatio;
  const pointWidth = (playWidth - barWidth) / 12;
  const mid1 = left + 6 * pointWidth;
  const mid2 = mid1 + barWidth;
  return {
    left: {
      tl: [left, top],
      tr: [mid1, top],
      bl: [left, bottom],
      br: [mid1, bottom]
    },
    right: {
      tl: [mid2, top],
      tr: [right, top],
      bl: [mid2, bottom],
      br: [right, bottom]
    },
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Inline RGB so Tailwind's JIT can't strip the dynamically-built
// class names (it would only ship CSS for classes it sees statically).
const CORNER_COLORS: Record<Corner, { color: string; label: string }> = {
  tl: {
    color: '#6ee7b7',
    label: 'Top-left'
  }, // emerald-300
  tr: {
    color: '#fcd34d',
    label: 'Top-right'
  }, // amber-300
  bl: {
    color: '#67e8f9',
    label: 'Bottom-left'
  }, // cyan-300
  br: {
    color: '#fda4af',
    label: 'Bottom-right'
  }, // rose-300
};

const HALF_STROKES: Record<HalfId, string> = {
  left: 'rgba(110,231,183,0.75)', // emerald
  right: 'rgba(253,164,175,0.75)', // rose
};

interface DragTarget {
  id: string;
  half: HalfId | null; // null = single-quad mode handle
  corner: Corner;
}

/**
 * Lets the admin mark the inner corners of the painted felt on the
 * gameplay image — either ONE quad for the whole play area (legacy:
 * the bar width is then assumed via barWidthRatio), or, after
 * "Split left / right", TWO quads — one per half. With two quads the
 * engine measures everything: each half divides its own width into 6
 * points and the bar is the gap between the quads, so a thick painted
 * bar, unequal halves or offset halves all position correctly with no
 * assumptions about the art.
 *
 * Saves to metadata.layout.feltInner*Ratio (single) or
 * metadata.layout.felt{Left,Right}Half*Ratio (per-half) so the
 * renderer reads it through remote.ts — the SAME parser the live
 * preview uses, so what's configured here is exactly what renders.
 */
export default function FeltCornersField({
  gameplayImage,
  metadata,
  onMetadataChange
}: Props) {
  const corners = useMemo(() => readCorners(metadata), [metadata]);
  const halves = useMemo(() => readHalves(metadata), [metadata]);
  const hasHalves = halves !== null;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const updateSingleCorner = (which: Corner, ratio: Pair) => {
    onMetadataChange(writeCorners(metadata, {
      ...corners,
      [which]: ratio
    }));
  };

  const updateHalfCorner = (half: HalfId, which: Corner, ratio: Pair) => {
    if (!halves) return;
    onMetadataChange(writeHalves(metadata, {
      ...halves,
      [half]: {
        ...halves[half],
        [which]: ratio
      }
    }));
  };

  const handlePointerDown = (target: DragTarget) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    dragRef.current = target;
    setDraggingId(target.id);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = dragRef.current;
    if (!target) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    if (target.half) updateHalfCorner(target.half, target.corner, [x, y]); else updateSingleCorner(target.corner, [x, y]);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
    setDraggingId(null);
  };

  const handleSplit = () => {
    const layout = parseLayout(metadata);
    const barWidthRatio = typeof layout.barWidthRatio === 'number' ? layout.barWidthRatio : 0.08;
    onMetadataChange(writeHalves(metadata, splitFromSingle(corners, barWidthRatio)));
  };

  const handleRemoveSplit = () => {
    onMetadataChange(removeHalves(metadata));
  };

  const quadPoints = (c: Corners) => `${c.tl[0] * 100},${c.tl[1] * 100} ${c.tr[0] * 100},${c.tr[1] * 100} ${c.br[0] * 100},${c.br[1] * 100} ${c.bl[0] * 100},${c.bl[1] * 100}`;

  const numberInput = (label: string, value: number, onChange: (next: number) => void) => (
    <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
      {label}
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={(value * 100).toFixed(1)}
        onChange={(event) => {
          const next = Number(event.target.value) / 100;
          if (Number.isFinite(next)) onChange(clamp01(next));
        }}
        className="w-16 rounded border border-white/15 bg-black/30 px-1.5 py-1 text-right font-mono text-[11px] normal-case tracking-normal text-white/85 outline-none focus:border-amber-200/60"
      />
    </label>);

  const cornerRow = (key: Corner, value: Pair, onChange: (next: Pair) => void) => {
    const palette = CORNER_COLORS[key];
    return (<div key={key} className="flex flex-wrap items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{backgroundColor: palette.color}}
        />
      <span className="text-[10px] normal-case tracking-normal text-white/55">{palette.label}</span>
      {numberInput('X%', value[0], (x) => onChange([x, value[1]]))}
      {numberInput('Y%', value[1], (y) => onChange([value[0], y]))}
    </div>);
  };

  const handles: Array<{ id: string; target: DragTarget; pos: Pair; shape: 'dot' | 'square'; label: string }> = [];
  if (hasHalves && halves) {
    for (const id of ['left', 'right'] as const) {
      for (const key of Object.keys(CORNER_COLORS) as Corner[]) {
        handles.push({
          id: `${id}-${key}`,
          target: {
            id: `${id}-${key}`,
            half: id,
            corner: key
          },
          pos: halves[id][key],
          shape: id === 'left' ? 'dot' : 'square',
          label: `${id === 'left' ? 'Left half' : 'Right half'} — ${CORNER_COLORS[key].label}`,
        });
      }
    }
  }
  else {
    for (const key of Object.keys(CORNER_COLORS) as Corner[]) {
      handles.push({
        id: key,
        target: {
          id: key,
          half: null,
          corner: key
        },
        pos: corners[key],
        shape: 'dot',
        label: CORNER_COLORS[key].label,
      });
    }
  }

  return (<div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span>Felt corners</span>
      <div className="flex items-center gap-2">
          <span className="text-[10px] normal-case tracking-normal text-white/35">
            {hasHalves ? 'Drag each half’s dots — the bar is the measured gap between the halves' : 'Drag the four dots to the inner corners of the painted felt'}
          </span>
        <button
          type="button"
          onClick={hasHalves ? handleRemoveSplit : handleSplit}
          title={hasHalves ? 'Back to a single quad (bar width becomes assumed again)' : 'Give each half its own four corners — measures the bar from the art instead of assuming its width'}
          className={`rounded px-2 py-1 text-[10px] font-bold normal-case tracking-normal transition ${hasHalves ? 'bg-slate-800 text-white/70 hover:bg-slate-700' : 'bg-amber-300/90 text-black hover:bg-amber-200'}`}
        >
          {hasHalves ? 'Remove split' : 'Split left / right'}
        </button>
      </div>
    </div>
    {/* GAMEPLAY projection: 4:3 (matching .game-board-column) with the
          image stretched to fill, exactly as BoardCanvas renders it in a
          match — one projection across editor, live preview and game. */}
    <div
      ref={wrapRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        aspectRatio: '4 / 3',
        touchAction: 'none'
      }}
      className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-black/40"
    >
      {gameplayImage ? (<img
        src={gameplayImage}
        alt=""
        className="absolute inset-0 h-full w-full"
        draggable={false}
      />) : (<div
        className="absolute inset-0 grid place-items-center text-[10px] font-bold normal-case tracking-normal text-white/40">
        Upload the Gameplay image above to position the felt corners.
      </div>)}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {hasHalves && halves ? (<>
          <polygon
            points={quadPoints(halves.left)}
            fill="rgba(110,231,183,0.06)"
            stroke={HALF_STROKES.left}
            strokeWidth={0.2}
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={quadPoints(halves.right)}
            fill="rgba(253,164,175,0.06)"
            stroke={HALF_STROKES.right}
            strokeWidth={0.2}
            vectorEffect="non-scaling-stroke"
          />
        </>) : (<polygon
          points={quadPoints(corners)}
          fill="rgba(255,212,128,0.07)"
          stroke="rgba(253,224,71,0.7)"
          strokeWidth={0.2}
          vectorEffect="non-scaling-stroke"
        />)}
      </svg>
      {handles.map((handle) => (<Handle
        key={handle.id}
        xPct={handle.pos[0] * 100}
        yPct={handle.pos[1] * 100}
        color={CORNER_COLORS[handle.target.corner].color}
        shape={handle.shape}
        title={handle.label}
        active={hover === handle.id || draggingId === handle.id}
        onPointerDown={handlePointerDown(handle.target)}
        onPointerEnter={() => setHover(handle.id)}
        onPointerLeave={() => setHover(null)}
      />))}
    </div>
    {hasHalves && halves ? (<div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
      {(['left', 'right'] as const).map((id) => (<div key={id} className="space-y-1.5">
        <div className="text-[10px] tracking-[0.14em] text-white/50">
          {id === 'left' ? 'Left half (round dots)' : 'Right half (square dots)'}
        </div>
        {(Object.keys(CORNER_COLORS) as Corner[]).map((key) => cornerRow(key, halves[id][key], (next) => updateHalfCorner(id, key, next)))}
      </div>))}
    </div>) : (<div className="mt-2 grid grid-cols-2 gap-3">
      {(Object.keys(CORNER_COLORS) as Corner[]).map((key) => cornerRow(key, corners[key], (next) => updateSingleCorner(key, next)))}
    </div>)}
  </div>);
}

interface HandleProps {
  xPct: number;
  yPct: number;
  color: string;
  shape: 'dot' | 'square';
  title: string;
  active: boolean;

  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;

  onPointerEnter(): void;

  onPointerLeave(): void;
}

function Handle({
  xPct,
  yPct,
  color,
  shape,
  title,
  active,
  onPointerDown,
  onPointerEnter,
  onPointerLeave
}: HandleProps) {
  return (<div
    onPointerDown={onPointerDown}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}
    title={title}
    style={{
      left: `${xPct}%`,
      top: `${yPct}%`,
      touchAction: 'none',
      backgroundColor: color,
      borderColor: color,
    }}
    className={`absolute -ml-2 -mt-2 h-4 w-4 cursor-grab border-2 shadow-[0_2px_8px_rgba(0,0,0,0.6)] transition active:cursor-grabbing ${shape === 'dot' ? 'rounded-full' : 'rounded-sm'} ${active ? 'scale-150' : 'scale-100'}`}
  />);
}
