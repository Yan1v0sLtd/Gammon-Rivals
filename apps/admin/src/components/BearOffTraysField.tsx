import {type PointerEvent as ReactPointerEvent, useMemo, useRef, useState} from "react"

import styles from "./BearOffTraysField.module.css"

type Props = {
  gameplayImage: string,
  metadata: string,

  onMetadataChange(next: string): void,
}

// Each bear-off tray is a vertical line with a TOP dot and a BOTTOM dot.
// The two dots of a tray share an X (drag either horizontally to move the
// whole line; drag vertically to set that edge). White and black are
// fully independent.
type Owner = "white" | "black"
type Edge = "top" | "bottom"
type HandleId = `${Owner}-${Edge}`

type TrayLine = {
  x: number, // 0..1 of board width — stack centre
  top: number, // 0..1 of board height — top edge
  bottom: number, // 0..1 of board height — bottom edge
}

type Trays = Record<Owner, TrayLine>

const MIN_SPAN = 0.03 // keep at least a sliver of height so the line stays grabbable

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isPair(value: unknown): value is [number, number] {
  return (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number")
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
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
  let layout: Record<string, unknown> = {}
  if (metadata.trim()) {
    try {
      const parsed = JSON.parse(metadata)
      if (isObject(parsed) && isObject(parsed.layout)) layout = parsed.layout
    }
    catch {
      layout = {}
    }
  }

  // Felt-derived fallback (ratio space — same result as the renderer's
  // pixel-space math since the transforms are linear).
  const tl = isPair(layout.feltInnerTopLeftRatio) ? layout.feltInnerTopLeftRatio : undefined
  const br = isPair(layout.feltInnerBottomRightRatio) ? layout.feltInnerBottomRightRatio : undefined
  const tr = isPair(layout.feltInnerTopRightRatio) ? layout.feltInnerTopRightRatio : undefined
  const bl = isPair(layout.feltInnerBottomLeftRatio) ? layout.feltInnerBottomLeftRatio : undefined
  let derived: Trays | null = null
  if (tl || br) {
    const fL = tl ? tl[0] : 0.08
    const fT = tl ? tl[1] : 0.08
    const fR = br ? br[0] : 0.92
    const fB = br ? br[1] : 0.92
    const rightEdge = Math.max(tr ? tr[0] : fR, fR)
    const topEdge = Math.min(tl ? fT : fT, tr ? tr[1] : fT)
    const bottomEdge = Math.max(bl ? bl[1] : fB, fB)
    const mid = (topEdge + bottomEdge) / 2
    const h = Math.max(0.001, bottomEdge - topEdge)
    const x = rightEdge + (1 - rightEdge) * 0.5
    const margin = h * 0.06
    const halfGap = (h * 0.22) / 2
    void fL
    derived = {
      black: {
        x,
        top: topEdge + margin,
        bottom: mid - halfGap,
      },
      white: {
        x,
        top: mid + halfGap,
        bottom: bottomEdge - margin,
      },
    }
  }

  const legacy: Trays = {
    black: {
      x: 0.925,
      top: 0.145,
      bottom: 0.145 + 0.255,
    },
    white: {
      x: 0.925,
      top: 0.61,
      bottom: 0.61 + 0.255,
    },
  }

  const lineFor = (owner: Owner): TrayLine => {
    const x = num(layout[`${owner}OffTrayXRatio`])
    const top = num(layout[`${owner}OffTrayTopRatio`])
    const height = num(layout[`${owner}OffTrayHeightRatio`])
    if (x !== undefined && top !== undefined && height !== undefined) {
      return {
        x,
        top,
        bottom: top + height,
      }
    }
    return derived ? derived[owner] : legacy[owner]
  }

  return {
    white: lineFor("white"),
    black: lineFor("black"),
  }
}

function writeTrays(metadata: string, trays: Trays): string {
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
  for (const owner of ["white", "black"] as const) {
    const line = trays[owner]
    layout[`${owner}OffTrayXRatio`] = round(line.x)
    layout[`${owner}OffTrayTopRatio`] = round(line.top)
    layout[`${owner}OffTrayHeightRatio`] = round(Math.max(MIN_SPAN, line.bottom - line.top))
  }
  root.layout = layout
  return JSON.stringify(root, null, 2)
}

const TRAY_COLORS: Record<Owner, {
  color: string,
  label: string,
}> = {
  white: {
    color: "#67e8f9",
    label: "White tray",
  }, // cyan-300
  black: {
    color: "#fda4af",
    label: "Black tray",
  }, // rose-300
}

export function BearOffTraysField({
  gameplayImage,
  metadata,
  onMetadataChange,
}: Props) {
  const trays = useMemo(() => readTrays(metadata), [metadata])
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<HandleId | null>(null)
  const [dragging, setDragging] = useState<HandleId | null>(null)
  const [hover, setHover] = useState<HandleId | null>(null)

  const apply = (next: Trays) => {
    onMetadataChange(writeTrays(metadata, next))
  }

  const moveHandle = (id: HandleId, x: number, y: number) => {
    const [owner, edge] = id.split("-") as [Owner, Edge]
    const line = {...trays[owner]}
    line.x = x // both dots of a tray share X — drag either to move the line
    if (edge === "top") line.top = Math.min(y, line.bottom - MIN_SPAN); else line.bottom = Math.max(y, line.top + MIN_SPAN)
    apply({
      ...trays,
      [owner]: line,
    })
  }

  const handlePointerDown = (id: HandleId) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation();
    (event.currentTarget).setPointerCapture(event.pointerId)
    dragRef.current = id
    setDragging(id)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const id = dragRef.current
    if (!id) return
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const x = clamp01((event.clientX - rect.left) / rect.width)
    const y = clamp01((event.clientY - rect.top) / rect.height)
    moveHandle(id, x, y)
  }

  const handlePointerUp = () => {
    dragRef.current = null
    setDragging(null)
  }

  const numberInput = (label: string, value: number, onChange: (next: number) => void) => (
    <label className={styles.numberInput}>
      {label}
      <input
        className={styles.monoInput}
        max={100}
        min={0}
        step={0.1}
        type="number"
        value={(value * 100).toFixed(1)}
        onChange={(event) => {
          const next = Number(event.target.value) / 100
          if (Number.isFinite(next)) onChange(clamp01(next))
        }}/>
    </label>)

  const trayRow = (owner: Owner) => {
    const palette = TRAY_COLORS[owner]
    const line = trays[owner]
    const setLine = (patch: Partial<TrayLine>) => {
      apply({
        ...trays,
        [owner]: {...line, ...patch},
      })
    }
    return (<div
      key={owner}
      className={styles.trayRow}>
      <span
        className={styles.colorDot}
        style={{backgroundColor: palette.color}}/>
      <span className={styles.trayLabel}>{palette.label}</span>
      {numberInput("X%", line.x, (x) => {
        setLine({x})
      })}
      {numberInput("Top%", line.top, (top) => {
        setLine({top: Math.min(top, line.bottom - MIN_SPAN)})
      })}
      {numberInput("Bottom%", line.bottom, (bottom) => {
        setLine({bottom: Math.max(bottom, line.top + MIN_SPAN)})
      })}
    </div>)
  }

  return (<div className={styles.fieldLabel}>
    <div className={styles.sectionHeader}>
      <span>Bear-off trays</span>
      <span className={styles.sectionHint}>
        Drag each tray’s top &amp; bottom dots onto its slot — white &amp; black are independent
      </span>
    </div>
    {/* GAMEPLAY projection: 4:3 (matching .game-board-column) with the
          image stretched to fill, exactly as BoardCanvas renders it in a
          match — same rule as FeltCornersField / BoardPreview. Dragging
          trays on any other projection lies to the operator whenever the
          upload isn't exactly 4:3. */}
    <div
      ref={wrapRef}
      className={styles.preview}
      style={{
        aspectRatio: "4 / 3",
        touchAction: "none",
      }}
      onPointerCancel={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}>
      {gameplayImage ? (<img
        alt=""
        className={styles.previewImg}
        draggable={false}
        src={gameplayImage}/>) : (<div
        className={styles.previewPlaceholder}>
          Upload the Gameplay image above to position the bear-off trays.
      </div>)}
      <svg
        className={styles.overlay}
        preserveAspectRatio="none"
        viewBox="0 0 100 100">
        {(["white", "black"] as const).map((owner) => {
          const line = trays[owner]
          return (<line
            key={owner}
            stroke={TRAY_COLORS[owner].color}
            strokeOpacity={0.85}
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
            x1={line.x * 100}
            x2={line.x * 100}
            y1={line.top * 100}
            y2={line.bottom * 100}/>)
        })}
      </svg>
      {(["white", "black"] as const).flatMap((owner) => (["top", "bottom"] as const).map((edge) => {
        const id: HandleId = `${owner}-${edge}`
        const line = trays[owner]
        const y = edge === "top" ? line.top : line.bottom
        return (<Handle
          key={id}
          active={hover === id || dragging === id}
          color={TRAY_COLORS[owner].color}
          title={`${TRAY_COLORS[owner].label} ${edge}`}
          xPct={line.x * 100}
          yPct={y * 100}
          onPointerDown={handlePointerDown(id)}
          onPointerEnter={() => {
            setHover(id)
          }}
          onPointerLeave={() => {
            setHover(null)
          }}/>)
      }))}
    </div>
    <div className={styles.trayGrid}>
      {trayRow("black")}
      {trayRow("white")}
    </div>
  </div>)
}

type HandleProps = {
  xPct: number,
  yPct: number,
  color: string,
  title: string,
  active: boolean,

  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void,

  onPointerEnter(): void,

  onPointerLeave(): void,
}

function Handle({
  xPct,
  yPct,
  color,
  title,
  active,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
}: HandleProps) {
  return (<div
    className={`${styles.handle} ${active ? styles.active : styles.inactive}`}
    style={{
      left: `${xPct}%`,
      top: `${yPct}%`,
      touchAction: "none",
      backgroundColor: color,
      borderColor: color,
    }}
    title={title}
    onPointerDown={onPointerDown}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}/>)
}
