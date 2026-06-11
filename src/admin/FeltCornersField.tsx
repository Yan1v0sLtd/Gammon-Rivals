import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

interface Props {
  gameplayImage: string;
  metadata: string;
  onMetadataChange(next: string): void;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Pair = [number, number];

interface Corners {
  tl: Pair;
  tr: Pair;
  bl: Pair;
  br: Pair;
}

const DEFAULT_CORNERS: Corners = {
  tl: [0.08, 0.08],
  tr: [0.92, 0.08],
  bl: [0.08, 0.92],
  br: [0.92, 0.92],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';
}

function readCorners(metadata: string): Corners {
  if (!metadata.trim()) return DEFAULT_CORNERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return DEFAULT_CORNERS;
  }
  if (!isObject(parsed) || !isObject(parsed.layout)) return DEFAULT_CORNERS;
  const layout = parsed.layout as Record<string, unknown>;
  const tl = isPair(layout.feltInnerTopLeftRatio) ? layout.feltInnerTopLeftRatio : DEFAULT_CORNERS.tl;
  const br = isPair(layout.feltInnerBottomRightRatio) ? layout.feltInnerBottomRightRatio : DEFAULT_CORNERS.br;
  // For TR / BL fall back to axis-aligned derivation so opening a
  // 2-corner board doesn't force the felt to look tilted before the
  // user has touched anything.
  const tr: Pair = isPair(layout.feltInnerTopRightRatio)
    ? layout.feltInnerTopRightRatio
    : [br[0], tl[1]];
  const bl: Pair = isPair(layout.feltInnerBottomLeftRatio)
    ? layout.feltInnerBottomLeftRatio
    : [tl[0], br[1]];
  return { tl, tr, bl, br };
}

function writeCorners(metadata: string, corners: Corners): string {
  let parsed: unknown = {};
  if (metadata.trim()) {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      parsed = {};
    }
  }
  if (!isObject(parsed)) parsed = {};
  const root = parsed as Record<string, unknown>;
  const layout = isObject(root.layout) ? { ...root.layout } : {};
  layout.feltInnerTopLeftRatio = roundPair(corners.tl);
  layout.feltInnerTopRightRatio = roundPair(corners.tr);
  layout.feltInnerBottomLeftRatio = roundPair(corners.bl);
  layout.feltInnerBottomRightRatio = roundPair(corners.br);
  root.layout = layout;
  return JSON.stringify(root, null, 2);
}

function roundPair(value: Pair): Pair {
  return [Math.round(value[0] * 10000) / 10000, Math.round(value[1] * 10000) / 10000];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Inline RGB so Tailwind's JIT can't strip the dynamically-built
// class names (it would only ship CSS for classes it sees statically).
const CORNER_COLORS: Record<Corner, { color: string; label: string }> = {
  tl: { color: '#6ee7b7', label: 'Top-left' }, // emerald-300
  tr: { color: '#fcd34d', label: 'Top-right' }, // amber-300
  bl: { color: '#67e8f9', label: 'Bottom-left' }, // cyan-300
  br: { color: '#fda4af', label: 'Bottom-right' }, // rose-300
};

/**
 * Lets the admin mark all four inner corners of the painted felt on
 * the gameplay image. When TR/BL deviate from axis-aligned (i.e. the
 * felt isn't a perfect rectangle from the camera's POV), the engine
 * bilinear-maps every point/checker into the resulting quadrilateral
 * so stacks follow the painted perspective.
 *
 * Saves to metadata.layout.feltInner{TopLeft,TopRight,BottomLeft,
 * BottomRight}Ratio so the renderer can read it through remote.ts.
 */
export default function FeltCornersField({ gameplayImage, metadata, onMetadataChange }: Props) {
  const corners = useMemo(() => readCorners(metadata), [metadata]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Corner | null>(null);
  const [hover, setHover] = useState<Corner | null>(null);
  // The editor shows the image in the GAMEPLAY projection: a 4:3 box
  // (matching .game-board-column in index.css) with the image stretched
  // to fill, exactly like BoardCanvas renders it in a match. The dot
  // ratios are image-relative either way, but displaying the image at
  // its natural aspect (as this editor used to) lies to the operator
  // whenever an upload isn't exactly 4:3 — the dots would sit on an
  // image the player never sees. One projection everywhere: editor,
  // live preview below, and gameplay are now the same picture.

  const updateCorner = (which: Corner, ratio: Pair) => {
    const next: Corners = { ...corners, [which]: ratio };
    onMetadataChange(writeCorners(metadata, next));
  };

  const handlePointerDown = (which: Corner) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    dragRef.current = which;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = dragRef.current;
    if (!target) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    updateCorner(target, [x, y]);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const cornerPct = (key: Corner) => ({ x: corners[key][0] * 100, y: corners[key][1] * 100 });
  const tl = cornerPct('tl');
  const tr = cornerPct('tr');
  const bl = cornerPct('bl');
  const br = cornerPct('br');
  // SVG-style quad overlay so the felt outline follows the four
  // corners even when they form a non-rectangular trapezoid.
  const quadPoints = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;

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
    </label>
  );

  const cornerRow = (key: Corner) => {
    const palette = CORNER_COLORS[key];
    const value = corners[key];
    return (
      <div key={key} className="flex flex-wrap items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: palette.color }}
        />
        <span className="text-[10px] normal-case tracking-normal text-white/55">{palette.label}</span>
        {numberInput('X%', value[0], (x) => updateCorner(key, [x, value[1]]))}
        {numberInput('Y%', value[1], (y) => updateCorner(key, [value[0], y]))}
      </div>
    );
  };

  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="mb-1.5 flex items-center justify-between">
        <span>Felt corners</span>
        <span className="text-[10px] normal-case tracking-normal text-white/35">
          Drag the four dots to the inner corners of the painted felt
        </span>
      </div>
      <div
        ref={wrapRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ aspectRatio: '4 / 3', touchAction: 'none' }}
        className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-black/40"
      >
        {gameplayImage ? (
          <img
            src={gameplayImage}
            alt=""
            className="absolute inset-0 h-full w-full"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[10px] font-bold normal-case tracking-normal text-white/40">
            Upload the Gameplay image above to position the felt corners.
          </div>
        )}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <polygon
            points={quadPoints}
            fill="rgba(255,212,128,0.07)"
            stroke="rgba(253,224,71,0.7)"
            strokeWidth={0.2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {(Object.keys(CORNER_COLORS) as Corner[]).map((key) => {
          const pct = cornerPct(key);
          return (
            <Handle
              key={key}
              xPct={pct.x}
              yPct={pct.y}
              palette={CORNER_COLORS[key]}
              active={hover === key || dragRef.current === key}
              onPointerDown={handlePointerDown(key)}
              onPointerEnter={() => setHover(key)}
              onPointerLeave={() => setHover(null)}
            />
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {cornerRow('tl')}
        {cornerRow('tr')}
        {cornerRow('bl')}
        {cornerRow('br')}
      </div>
    </div>
  );
}

interface HandleProps {
  xPct: number;
  yPct: number;
  palette: { color: string; label: string };
  active: boolean;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

function Handle({ xPct, yPct, palette, active, onPointerDown, onPointerEnter, onPointerLeave }: HandleProps) {
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      title={palette.label}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        touchAction: 'none',
        backgroundColor: palette.color,
        borderColor: palette.color,
      }}
      className={`absolute -ml-2 -mt-2 h-4 w-4 cursor-grab rounded-full border-2 shadow-[0_2px_8px_rgba(0,0,0,0.6)] transition active:cursor-grabbing ${
        active ? 'scale-150' : 'scale-100'
      }`}
    />
  );
}
