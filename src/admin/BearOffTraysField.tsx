import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';

interface Props {
  gameplayImage: string;
  metadata: string;
  onMetadataChange(next: string): void;
}

// Each bear-off tray is a vertical line with a TOP dot and a BOTTOM dot.
// The two dots of a tray share an X (drag either horizontally to move the
// whole line; drag vertically to set that edge). White and black are
// fully independent.
type Owner = 'white' | 'black';
type Edge = 'top' | 'bottom';
type HandleId = `${Owner}-${Edge}`;

interface TrayLine {
  x: number; // 0..1 of board width — stack centre
  top: number; // 0..1 of board height — top edge
  bottom: number; // 0..1 of board height — bottom edge
}
type Trays = Record<Owner, TrayLine>;

const MIN_SPAN = 0.03; // keep at least a sliver of height so the line stays grabbable

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function isPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Initial tray lines. Priority per colour:
 *   1. explicit metadata.layout.{owner}OffTray{X,Top,Height}Ratio
 *   2. felt-derived (mirrors computeLayout: tray just outside the right
 *      felt edge; black = upper half, white = lower half of the felt)
 *   3. legacy absolute defaults
 * so the dots open exactly where the trays currently render, and the user
 * drags from there.
 */
function readTrays(metadata: string): Trays {
  let layout: Record<string, unknown> = {};
  if (metadata.trim()) {
    try {
      const parsed = JSON.parse(metadata);
      if (isObject(parsed) && isObject(parsed.layout)) layout = parsed.layout as Record<string, unknown>;
    } catch {
      layout = {};
    }
  }

  // Felt-derived fallback (ratio space — same result as the renderer's
  // pixel-space math since the transforms are linear).
  const tl = isPair(layout.feltInnerTopLeftRatio) ? layout.feltInnerTopLeftRatio : undefined;
  const br = isPair(layout.feltInnerBottomRightRatio) ? layout.feltInnerBottomRightRatio : undefined;
  const tr = isPair(layout.feltInnerTopRightRatio) ? layout.feltInnerTopRightRatio : undefined;
  const bl = isPair(layout.feltInnerBottomLeftRatio) ? layout.feltInnerBottomLeftRatio : undefined;
  let derived: Trays | null = null;
  if (tl || br) {
    const fL = tl ? tl[0] : 0.08;
    const fT = tl ? tl[1] : 0.08;
    const fR = br ? br[0] : 0.92;
    const fB = br ? br[1] : 0.92;
    const rightEdge = Math.max(tr ? tr[0] : fR, fR);
    const topEdge = Math.min(tl ? fT : fT, tr ? tr[1] : fT);
    const bottomEdge = Math.max(bl ? bl[1] : fB, fB);
    const mid = (topEdge + bottomEdge) / 2;
    const h = Math.max(0.001, bottomEdge - topEdge);
    const x = rightEdge + (1 - rightEdge) * 0.5;
    const margin = h * 0.06;
    const halfGap = (h * 0.22) / 2;
    void fL;
    derived = {
      black: { x, top: topEdge + margin, bottom: mid - halfGap },
      white: { x, top: mid + halfGap, bottom: bottomEdge - margin },
    };
  }

  const legacy: Trays = {
    black: { x: 0.925, top: 0.145, bottom: 0.145 + 0.255 },
    white: { x: 0.925, top: 0.61, bottom: 0.61 + 0.255 },
  };

  const lineFor = (owner: Owner): TrayLine => {
    const x = num(layout[`${owner}OffTrayXRatio`]);
    const top = num(layout[`${owner}OffTrayTopRatio`]);
    const height = num(layout[`${owner}OffTrayHeightRatio`]);
    if (x !== undefined && top !== undefined && height !== undefined) {
      return { x, top, bottom: top + height };
    }
    return derived ? derived[owner] : legacy[owner];
  };

  return { white: lineFor('white'), black: lineFor('black') };
}

function writeTrays(metadata: string, trays: Trays): string {
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
  for (const owner of ['white', 'black'] as const) {
    const line = trays[owner];
    layout[`${owner}OffTrayXRatio`] = round(line.x);
    layout[`${owner}OffTrayTopRatio`] = round(line.top);
    layout[`${owner}OffTrayHeightRatio`] = round(Math.max(MIN_SPAN, line.bottom - line.top));
  }
  root.layout = layout;
  return JSON.stringify(root, null, 2);
}

const TRAY_COLORS: Record<Owner, { color: string; label: string }> = {
  white: { color: '#67e8f9', label: 'White tray' }, // cyan-300
  black: { color: '#fda4af', label: 'Black tray' }, // rose-300
};

export default function BearOffTraysField({ gameplayImage, metadata, onMetadataChange }: Props) {
  const trays = useMemo(() => readTrays(metadata), [metadata]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<HandleId | null>(null);
  const [hover, setHover] = useState<HandleId | null>(null);
  const [imageAspect, setImageAspect] = useState<number>(2170 / 1000);

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setImageAspect(img.naturalWidth / img.naturalHeight);
    }
  };

  const apply = (next: Trays) => onMetadataChange(writeTrays(metadata, next));

  const moveHandle = (id: HandleId, x: number, y: number) => {
    const [owner, edge] = id.split('-') as [Owner, Edge];
    const line = { ...trays[owner] };
    line.x = x; // both dots of a tray share X — drag either to move the line
    if (edge === 'top') line.top = Math.min(y, line.bottom - MIN_SPAN);
    else line.bottom = Math.max(y, line.top + MIN_SPAN);
    apply({ ...trays, [owner]: line });
  };

  const handlePointerDown = (id: HandleId) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    dragRef.current = id;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const id = dragRef.current;
    if (!id) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    moveHandle(id, x, y);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

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

  const trayRow = (owner: Owner) => {
    const palette = TRAY_COLORS[owner];
    const line = trays[owner];
    const setLine = (patch: Partial<TrayLine>) => apply({ ...trays, [owner]: { ...line, ...patch } });
    return (
      <div key={owner} className="flex flex-wrap items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: palette.color }} />
        <span className="text-[10px] normal-case tracking-normal text-white/55">{palette.label}</span>
        {numberInput('X%', line.x, (x) => setLine({ x }))}
        {numberInput('Top%', line.top, (top) => setLine({ top: Math.min(top, line.bottom - MIN_SPAN) }))}
        {numberInput('Bottom%', line.bottom, (bottom) => setLine({ bottom: Math.max(bottom, line.top + MIN_SPAN) }))}
      </div>
    );
  };

  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="mb-1.5 flex items-center justify-between">
        <span>Bear-off trays</span>
        <span className="text-[10px] normal-case tracking-normal text-white/35">
          Drag each tray’s top &amp; bottom dots onto its slot — white &amp; black are independent
        </span>
      </div>
      <div
        ref={wrapRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ aspectRatio: String(imageAspect), touchAction: 'none' }}
        className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-black/40"
      >
        {gameplayImage ? (
          <img
            src={gameplayImage}
            alt=""
            onLoad={handleImageLoad}
            className="absolute inset-0 h-full w-full"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[10px] font-bold normal-case tracking-normal text-white/40">
            Upload the Gameplay image above to position the bear-off trays.
          </div>
        )}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {(['white', 'black'] as const).map((owner) => {
            const line = trays[owner];
            return (
              <line
                key={owner}
                x1={line.x * 100}
                y1={line.top * 100}
                x2={line.x * 100}
                y2={line.bottom * 100}
                stroke={TRAY_COLORS[owner].color}
                strokeWidth={0.5}
                strokeOpacity={0.85}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {(['white', 'black'] as const).flatMap((owner) =>
          (['top', 'bottom'] as const).map((edge) => {
            const id: HandleId = `${owner}-${edge}`;
            const line = trays[owner];
            const y = edge === 'top' ? line.top : line.bottom;
            return (
              <Handle
                key={id}
                xPct={line.x * 100}
                yPct={y * 100}
                color={TRAY_COLORS[owner].color}
                title={`${TRAY_COLORS[owner].label} ${edge}`}
                active={hover === id || dragRef.current === id}
                onPointerDown={handlePointerDown(id)}
                onPointerEnter={() => setHover(id)}
                onPointerLeave={() => setHover(null)}
              />
            );
          })
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {trayRow('black')}
        {trayRow('white')}
      </div>
    </div>
  );
}

interface HandleProps {
  xPct: number;
  yPct: number;
  color: string;
  title: string;
  active: boolean;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

function Handle({ xPct, yPct, color, title, active, onPointerDown, onPointerEnter, onPointerLeave }: HandleProps) {
  return (
    <div
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
      className={`absolute -ml-2 -mt-2 h-4 w-4 cursor-grab rounded-full border-2 shadow-[0_2px_8px_rgba(0,0,0,0.6)] transition active:cursor-grabbing ${
        active ? 'scale-150' : 'scale-100'
      }`}
    />
  );
}
