import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface Props {
  gameplayImage: string;
  metadata: string;
  onMetadataChange(next: string): void;
}

type Corner = 'tl' | 'br';

interface Corners {
  tl: [number, number]; // [xRatio, yRatio] within the image, 0..1
  br: [number, number];
}

const DEFAULT_CORNERS: Corners = {
  tl: [0.08, 0.08],
  br: [0.92, 0.92],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
  const tl = layout.feltInnerTopLeftRatio;
  const br = layout.feltInnerBottomRightRatio;
  return {
    tl:
      Array.isArray(tl) && typeof tl[0] === 'number' && typeof tl[1] === 'number'
        ? [tl[0], tl[1]]
        : DEFAULT_CORNERS.tl,
    br:
      Array.isArray(br) && typeof br[0] === 'number' && typeof br[1] === 'number'
        ? [br[0], br[1]]
        : DEFAULT_CORNERS.br,
  };
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
  layout.feltInnerTopLeftRatio = [round4(corners.tl[0]), round4(corners.tl[1])];
  layout.feltInnerBottomRightRatio = [round4(corners.br[0]), round4(corners.br[1])];
  root.layout = layout;
  return JSON.stringify(root, null, 2);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Lets the admin mark the inner top-left and inner bottom-right corners
 * of the felt rectangle on the gameplay image. Saves to
 * metadata.layout.feltInnerTopLeftRatio / feltInnerBottomRightRatio so
 * the engine can map points / bar / off-trays relative to where the
 * artist actually painted the felt — even when the wood frame margin
 * varies between boards.
 */
export default function FeltCornersField({ gameplayImage, metadata, onMetadataChange }: Props) {
  const corners = useMemo(() => readCorners(metadata), [metadata]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Corner | null>(null);
  const [hover, setHover] = useState<Corner | null>(null);

  const updateCorner = (which: Corner, ratio: [number, number]) => {
    const next: Corners = { ...corners, [which]: ratio };
    // Keep TL above-left of BR (small gap so the felt is always non-zero).
    if (which === 'tl') {
      next.tl = [Math.min(ratio[0], corners.br[0] - 0.02), Math.min(ratio[1], corners.br[1] - 0.02)];
    } else {
      next.br = [Math.max(ratio[0], corners.tl[0] + 0.02), Math.max(ratio[1], corners.tl[1] + 0.02)];
    }
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

  const tlPct = { x: corners.tl[0] * 100, y: corners.tl[1] * 100 };
  const brPct = { x: corners.br[0] * 100, y: corners.br[1] * 100 };
  const rectStyle = {
    left: `${tlPct.x}%`,
    top: `${tlPct.y}%`,
    width: `${brPct.x - tlPct.x}%`,
    height: `${brPct.y - tlPct.y}%`,
  } as const;

  const numberInput = (
    label: string,
    value: number,
    onChange: (next: number) => void
  ) => (
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

  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="mb-1.5 flex items-center justify-between">
        <span>Felt corners</span>
        <span className="text-[10px] normal-case tracking-normal text-white/35">
          Drag the green / red dot to the inner corners of the felt rectangle
        </span>
      </div>
      <div
        ref={wrapRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ aspectRatio: '2170 / 1000', touchAction: 'none' }}
        className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-black/40"
      >
        {gameplayImage ? (
          <img
            src={gameplayImage}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[10px] font-bold normal-case tracking-normal text-white/40">
            Upload the Gameplay image above to position the felt corners.
          </div>
        )}
        <div
          className="pointer-events-none absolute border border-amber-200/70"
          style={{ ...rectStyle, background: 'rgba(255,212,128,0.07)' }}
        />
        <Handle
          color="emerald"
          xPct={tlPct.x}
          yPct={tlPct.y}
          active={hover === 'tl' || dragRef.current === 'tl'}
          onPointerDown={handlePointerDown('tl')}
          onPointerEnter={() => setHover('tl')}
          onPointerLeave={() => setHover(null)}
        />
        <Handle
          color="rose"
          xPct={brPct.x}
          yPct={brPct.y}
          active={hover === 'br' || dragRef.current === 'br'}
          onPointerDown={handlePointerDown('br')}
          onPointerEnter={() => setHover('br')}
          onPointerLeave={() => setHover(null)}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-300" />
          <span className="text-[10px] normal-case tracking-normal text-white/55">Top-left</span>
          {numberInput('X%', corners.tl[0], (x) => updateCorner('tl', [x, corners.tl[1]]))}
          {numberInput('Y%', corners.tl[1], (y) => updateCorner('tl', [corners.tl[0], y]))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-300" />
          <span className="text-[10px] normal-case tracking-normal text-white/55">Bottom-right</span>
          {numberInput('X%', corners.br[0], (x) => updateCorner('br', [x, corners.br[1]]))}
          {numberInput('Y%', corners.br[1], (y) => updateCorner('br', [corners.br[0], y]))}
        </div>
      </div>
    </div>
  );
}

interface HandleProps {
  color: 'emerald' | 'rose';
  xPct: number;
  yPct: number;
  active: boolean;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

function Handle({ color, xPct, yPct, active, onPointerDown, onPointerEnter, onPointerLeave }: HandleProps) {
  const ring = color === 'emerald' ? 'border-emerald-300 bg-emerald-400/80' : 'border-rose-300 bg-rose-400/80';
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ left: `${xPct}%`, top: `${yPct}%`, touchAction: 'none' }}
      className={`absolute -ml-2 -mt-2 h-4 w-4 cursor-grab rounded-full border-2 shadow-[0_2px_8px_rgba(0,0,0,0.6)] transition active:cursor-grabbing ${ring} ${
        active ? 'scale-150' : 'scale-100'
      }`}
    />
  );
}
