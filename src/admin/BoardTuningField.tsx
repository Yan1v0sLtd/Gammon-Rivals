interface Props {
  metadata: string;
  onMetadataChange(next: string): void;
}

type LayoutKey =
  | 'pointHeightRatio'
  | 'checkerStackSpacingRatio'
  | 'checkerRadiusRatio'
  | 'whiteOffTrayXRatio'
  | 'whiteOffTrayTopRatio'
  | 'whiteOffTrayHeightRatio'
  | 'whiteOffTrayTiltDeg'
  | 'blackOffTrayXRatio'
  | 'blackOffTrayTopRatio'
  | 'blackOffTrayHeightRatio'
  | 'blackOffTrayTiltDeg'
  | 'offCheckerStackSpacingRatio';

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

// On-board checker geometry.
const BOARD_FIELDS: readonly Field[] = [
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

// Bear-off tray geometry. These keys ALREADY drive the renderer
// (BoardRenderer.offTrayMetrics / offCheckerAnchor read them from
// metadata.layout); they were just never exposed in the back office, so
// borne-off checkers could only be aligned by editing the raw metadata
// JSON. Defaults mirror premiumTheme.layout. Tilt is in degrees
// (0 = straight stack); the rest are fractions of the board image.
// Toggle "Show bear-off" in the live preview to see the stacks while
// nudging.
const TRAY_FIELDS: readonly Field[] = [
  {
    key: 'whiteOffTrayXRatio',
    label: 'White tray X',
    hint: 'Horizontal centre of the white bear-off tray (fraction of board width).',
    min: 0.5,
    max: 1.0,
    smallStep: 0.004,
    bigStep: 0.02,
    decimals: 4,
    defaultValue: 0.925,
  },
  {
    key: 'whiteOffTrayTopRatio',
    label: 'White tray top',
    hint: 'Top edge of the white tray (fraction of board height).',
    min: 0.0,
    max: 0.95,
    smallStep: 0.004,
    bigStep: 0.02,
    decimals: 4,
    defaultValue: 0.61,
  },
  {
    key: 'whiteOffTrayHeightRatio',
    label: 'White tray height',
    hint: 'Vertical span the white stack fills (fraction of board height).',
    min: 0.08,
    max: 0.6,
    smallStep: 0.004,
    bigStep: 0.02,
    decimals: 4,
    defaultValue: 0.255,
  },
  {
    key: 'whiteOffTrayTiltDeg',
    label: 'White tray tilt',
    hint: 'Angle (°) tilting the white stack off vertical. 0 = straight.',
    min: -30,
    max: 30,
    smallStep: 0.5,
    bigStep: 3,
    decimals: 1,
    defaultValue: 0,
  },
  {
    key: 'blackOffTrayXRatio',
    label: 'Black tray X',
    hint: 'Horizontal centre of the black bear-off tray (fraction of board width).',
    min: 0.5,
    max: 1.0,
    smallStep: 0.004,
    bigStep: 0.02,
    decimals: 4,
    defaultValue: 0.925,
  },
  {
    key: 'blackOffTrayTopRatio',
    label: 'Black tray top',
    hint: 'Top edge of the black tray (fraction of board height).',
    min: 0.0,
    max: 0.95,
    smallStep: 0.004,
    bigStep: 0.02,
    decimals: 4,
    defaultValue: 0.145,
  },
  {
    key: 'blackOffTrayHeightRatio',
    label: 'Black tray height',
    hint: 'Vertical span the black stack fills (fraction of board height).',
    min: 0.08,
    max: 0.6,
    smallStep: 0.004,
    bigStep: 0.02,
    decimals: 4,
    defaultValue: 0.255,
  },
  {
    key: 'blackOffTrayTiltDeg',
    label: 'Black tray tilt',
    hint: 'Angle (°) tilting the black stack off vertical. 0 = straight.',
    min: -30,
    max: 30,
    smallStep: 0.5,
    bigStep: 3,
    decimals: 1,
    defaultValue: 0,
  },
  {
    key: 'offCheckerStackSpacingRatio',
    label: 'Tray stack spacing',
    hint: 'Gap between borne-off checkers (multiplier of checker radius).',
    min: 0.3,
    max: 1.0,
    smallStep: 0.02,
    bigStep: 0.08,
    decimals: 2,
    defaultValue: 0.56,
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
 *
 * Two groups:
 *   - Board: on-board checker geometry (point depth, stack spacing,
 *     checker radius).
 *   - Bear-off trays: where borne-off checkers stack on the right rail
 *     (per-colour X / top / height / tilt + shared stack spacing). These
 *     keys already drive the renderer; toggle "Show bear-off" in the
 *     live preview to align them.
 */
export default function BoardTuningField({ metadata, onMetadataChange }: Props) {
  const renderField = (field: Field) => {
    const value = readValue(metadata, field.key, field.defaultValue);
    const setValue = (next: number) =>
      onMetadataChange(writeValue(metadata, field.key, clamp(next, field.min, field.max)));
    const nudge = (delta: number) => setValue(value + delta);
    return (
      <div key={field.key} className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] tracking-[0.12em]">{field.label}</span>
          <span className="text-[9px] normal-case tracking-normal text-white/40">
            {field.min}–{field.max}
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
  };

  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="mb-1.5 flex items-center justify-between">
        <span>Board tuning</span>
        <span className="text-[10px] normal-case tracking-normal text-white/35">
          Adjust stack depth, spacing and checker size per board
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">{BOARD_FIELDS.map(renderField)}</div>

      <div className="mb-1.5 mt-3 flex items-center justify-between">
        <span>Bear-off trays</span>
        <span className="text-[10px] normal-case tracking-normal text-white/35">
          Align borne-off checkers — toggle “Show bear-off” in the preview
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">{TRAY_FIELDS.map(renderField)}</div>
    </div>
  );
}
