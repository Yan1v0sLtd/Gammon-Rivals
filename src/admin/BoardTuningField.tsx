interface Props {
  metadata: string;
  onMetadataChange(next: string): void;
}

type LayoutKey =
  | 'pointHeightRatio'
  | 'checkerStackSpacingRatio'
  | 'checkerRadiusRatio';

interface Field {
  key: LayoutKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  smallStep: number;
  bigStep: number;
  decimals: number;
  defaultValue: number;
}

const FIELDS: readonly Field[] = [
  {
    key: 'pointHeightRatio',
    label: 'Point depth',
    hint: 'How far stacks reach into the felt (fraction of canvas height).',
    min: 0.08,
    max: 0.6,
    smallStep: 0.006,
    bigStep: 0.03,
    decimals: 4,
    defaultValue: 0.44,
  },
  {
    key: 'checkerStackSpacingRatio',
    label: 'Stack spacing',
    hint: 'Distance between stacked checkers, as a multiplier of the checker diameter.',
    min: 0.55,
    max: 1.45,
    smallStep: 0.04,
    bigStep: 0.16,
    decimals: 2,
    defaultValue: 1.0,
  },
  {
    key: 'checkerRadiusRatio',
    label: 'Checker radius',
    hint: 'Checker radius as a fraction of the point width.',
    min: 0.28,
    max: 0.6,
    smallStep: 0.02,
    bigStep: 0.06,
    decimals: 3,
    defaultValue: 0.42,
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readValue(metadata: string, key: LayoutKey, fallback: number): number {
  if (!metadata.trim()) return fallback;
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!isObject(parsed) || !isObject(parsed.layout)) return fallback;
    const value = parsed.layout[key];
    return typeof value === 'number' ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeValue(metadata: string, key: LayoutKey, value: number): string {
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
  layout[key] = round(value);
  root.layout = layout;
  return JSON.stringify(root, null, 2);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compact panel of per-board visual nudgers. Each control reads /
 * writes a single key under `metadata.layout` so the values persist
 * with the rest of the board theme. Replaces the in-session
 * alignment-tool nudgers (which only saved to localStorage for the
 * legacy premium-purple board, not for back-office-managed themes).
 */
export default function BoardTuningField({ metadata, onMetadataChange }: Props) {
  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="mb-1.5 flex items-center justify-between">
        <span>Board tuning</span>
        <span className="text-[10px] normal-case tracking-normal text-white/35">
          Adjust stack depth, spacing and checker size per board
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {FIELDS.map((field) => {
          const value = readValue(metadata, field.key, field.defaultValue);
          const setValue = (next: number) =>
            onMetadataChange(writeValue(metadata, field.key, clamp(next, field.min, field.max)));
          const nudge = (delta: number) => setValue(value + delta);
          return (
            <div key={field.key} className="rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] tracking-[0.12em]">{field.label}</span>
                <span className="text-[9px] normal-case tracking-normal text-white/40">
                  {field.min.toFixed(2)}–{field.max.toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                <button
                  type="button"
                  onClick={() => nudge(-field.bigStep)}
                  className="rounded bg-slate-800 px-1 py-1 text-[10px] font-bold normal-case tracking-normal text-white/70 hover:bg-slate-700"
                >
                  -big
                </button>
                <button
                  type="button"
                  onClick={() => nudge(-field.smallStep)}
                  className="rounded bg-slate-800 px-1 py-1 text-[10px] font-bold normal-case tracking-normal text-white/70 hover:bg-slate-700"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => nudge(field.smallStep)}
                  className="rounded bg-slate-800 px-1 py-1 text-[10px] font-bold normal-case tracking-normal text-white/70 hover:bg-slate-700"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => nudge(field.bigStep)}
                  className="rounded bg-slate-800 px-1 py-1 text-[10px] font-bold normal-case tracking-normal text-white/70 hover:bg-slate-700"
                >
                  big+
                </button>
              </div>
              <input
                type="number"
                min={field.min}
                max={field.max}
                step={field.smallStep}
                value={value.toFixed(field.decimals)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) setValue(next);
                }}
                className="mt-1 w-full rounded border border-white/15 bg-black/30 px-1.5 py-1 text-right font-mono text-[11px] normal-case tracking-normal text-white/85 outline-none focus:border-amber-200/60"
              />
              <div className="mt-1 text-[9px] normal-case tracking-normal text-white/35">{field.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
