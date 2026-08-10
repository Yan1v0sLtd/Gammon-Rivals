import styles from "./BoardTuningField.module.css"

type Props = {
  metadata: string,

  onMetadataChange(next: string): void,
}

type LayoutKey =
  | "pointHeightRatio"
  | "checkerStackSpacingRatio"
  | "checkerRadiusRatio"
  | "offCheckerStackSpacingRatio"
  | "blackOffTrayTiltDeg"
  | "whiteOffTrayTiltDeg"

type Field = {
  key: LayoutKey,
  label: string,
  hint: string,
  min: number,
  max: number,
  smallStep: number,
  bigStep: number,
  decimals: number,
  defaultValue: number,
}

// On-board checker geometry.
const BOARD_FIELDS: readonly Field[] = [{
  key: "pointHeightRatio",
  label: "Point depth",
  hint: "How far stacks reach into the felt (fraction of canvas height).",
  min: 0.08,
  max: 0.6,
  smallStep: 0.006,
  bigStep: 0.03,
  decimals: 4,
  defaultValue: 0.44,
}, {
  key: "checkerStackSpacingRatio",
  label: "Stack spacing",
  hint: "Distance between stacked checkers, as a multiplier of the checker diameter.",
  min: 0.55,
  max: 1.45,
  smallStep: 0.04,
  bigStep: 0.16,
  decimals: 2,
  defaultValue: 1.0,
}, {
  key: "checkerRadiusRatio",
  label: "Checker radius",
  hint: "Checker radius as a fraction of the point width.",
  min: 0.28,
  max: 0.6,
  smallStep: 0.02,
  bigStep: 0.06,
  decimals: 3,
  defaultValue: 0.42,
}]

// Bear-off stack styling. POSITION is set with the drag editor (the
// "Bear-off trays" field above — drag each tray's top/bottom dots). These
// remaining knobs are cosmetic and apply on top of wherever the trays
// sit: how tightly the borne-off checkers stack, and an optional lean.
const TRAY_FIELDS: readonly Field[] = [{
  key: "offCheckerStackSpacingRatio",
  label: "Stack spacing",
  hint: "Gap between borne-off checkers (multiplier of checker radius).",
  min: 0.3,
  max: 1.0,
  smallStep: 0.02,
  bigStep: 0.08,
  decimals: 2,
  defaultValue: 0.56,
}, {
  key: "blackOffTrayTiltDeg",
  label: "Black tilt",
  hint: "Angle (°) tilting the black (upper) stack off vertical. 0 = straight.",
  min: -30,
  max: 30,
  smallStep: 0.5,
  bigStep: 3,
  decimals: 1,
  defaultValue: 0,
}, {
  key: "whiteOffTrayTiltDeg",
  label: "White tilt",
  hint: "Angle (°) tilting the white (lower) stack off vertical. 0 = straight.",
  min: -30,
  max: 30,
  smallStep: 0.5,
  bigStep: 3,
  decimals: 1,
  defaultValue: 0,
}]

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function readValue(metadata: string, key: LayoutKey, fallback: number): number {
  if (!metadata.trim()) return fallback
  try {
    const parsed = JSON.parse(metadata) as unknown
    if (!isObject(parsed) || !isObject(parsed.layout)) return fallback
    const value = parsed.layout[key]
    return typeof value === "number" ? value : fallback
  }
  catch {
    return fallback
  }
}

function writeValue(metadata: string, key: LayoutKey, value: number): string {
  let parsed: unknown = {}
  if (metadata.trim()) {
    try {
      parsed = JSON.parse(metadata)
    }
    catch {
      parsed = {}
    }
  }
  if (!isObject(parsed)) parsed = {}
  const root = parsed as Record<string, unknown>
  const layout = isObject(root.layout) ? {...root.layout} : {}
  layout[key] = round(value)
  root.layout = layout
  return JSON.stringify(root, null, 2)
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Compact panel of per-board visual nudgers. Each control reads /
 * writes a single key under `metadata.layout` so the values persist
 * with the rest of the board theme.
 *
 * Two groups:
 *   - Board: on-board checker geometry (point depth, stack spacing,
 *     checker radius).
 *   - Bear-off trays: the trays auto-align to the board's felt corners;
 *     these knobs fine-tune that derivation (distance from felt, margins,
 *     mid gap, stack spacing, tilt) and are optional per-board overrides.
 *     Toggle "Bear-off only" in the live preview to see them.
 */
export function BoardTuningField({
  metadata,
  onMetadataChange,
}: Props) {
  const renderField = (field: Field) => {
    const value = readValue(metadata, field.key, field.defaultValue)
    const setValue = (next: number) => {
      onMetadataChange(writeValue(metadata, field.key, clamp(next, field.min, field.max)))
    }
    const nudge = (delta: number) => {
      setValue(value + delta)
    }
    return (<div
      key={field.key}
      className={styles.tuner}>
      <div className={styles.tunerHeader}>
        <span className={styles.tunerLabel}>{field.label}</span>
        <span className={styles.tunerRange}>
          {field.min}–{field.max}
        </span>
      </div>
      <div className={styles.nudgeGrid}>
        <button
          className={styles.nudgeButton}
          type="button"
          onClick={() => {
            nudge(-field.bigStep)
          }}>
          -big
        </button>
        <button
          className={styles.nudgeButton}
          type="button"
          onClick={() => {
            nudge(-field.smallStep)
          }}>
          -
        </button>
        <button
          className={styles.nudgeButton}
          type="button"
          onClick={() => {
            nudge(field.smallStep)
          }}>
          +
        </button>
        <button
          className={styles.nudgeButton}
          type="button"
          onClick={() => {
            nudge(field.bigStep)
          }}>
          big+
        </button>
      </div>
      <input
        className={styles.monoInput}
        max={field.max}
        min={field.min}
        step={field.smallStep}
        type="number"
        value={value.toFixed(field.decimals)}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) setValue(next)
        }}/>
      <div className={styles.tunerHint}>{field.hint}</div>
    </div>)
  }

  return (<div className={styles.fieldLabel}>
    <div className={styles.sectionHeader}>
      <span>Board tuning</span>
      <span className={styles.sectionHint}>
        Adjust stack depth, spacing and checker size per board
      </span>
    </div>
    <div className={styles.fieldGrid}>{BOARD_FIELDS.map(renderField)}</div>

    <div className={`${styles.sectionHeader} ${styles.sectionHeaderSpaced}`}>
      <span>Bear-off stacks</span>
      <span className={styles.sectionHint}>
        Stack spacing &amp; lean — set tray position with the drag editor above
      </span>
    </div>
    <div className={styles.fieldGrid}>{TRAY_FIELDS.map(renderField)}</div>
  </div>)
}
