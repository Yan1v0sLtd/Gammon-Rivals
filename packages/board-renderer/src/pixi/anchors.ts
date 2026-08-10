import type {BoardState, Player, Position} from "../../../engine/src/types"
import {BAR, OFF} from "../../../engine/src/types"
import {checkerCenter, type Layout, pointCoords} from "../coordinates"

export type Anchor = {x: number, y: number}

export function barCheckerAnchor(layout: Layout, owner: Player, stackIndex: number): Anchor {
  const {barX, barWidth, height, checkerRadius} = layout
  const cx = barX + barWidth / 2
  const diameter = 2 * checkerRadius
  const cy =
    owner === "white"
      ? height / 2 + checkerRadius + 6 + stackIndex * diameter
      : height / 2 - checkerRadius - 6 - stackIndex * diameter
  return {x: cx, y: cy}
}

export function offTrayMetrics(layout: Layout, owner: Player) {
  const {
    blackOffTrayHeight,
    blackOffTrayTiltDeg,
    blackOffTrayTop,
    blackOffTrayX,
    checkerRadius,
    offCheckerStackSpacing,
    railWidth,
    whiteOffTrayHeight,
    whiteOffTrayTiltDeg,
    whiteOffTrayTop,
    whiteOffTrayX,
  } = layout
  const trayHeight = owner === "black" ? blackOffTrayHeight : whiteOffTrayHeight
  const trayTop = owner === "black" ? blackOffTrayTop : whiteOffTrayTop
  const trayX = owner === "black" ? blackOffTrayX : whiteOffTrayX
  const tiltDeg = owner === "black" ? blackOffTrayTiltDeg : whiteOffTrayTiltDeg
  const tiltRad = (tiltDeg * Math.PI) / 180
  const usable = Math.max(checkerRadius, trayHeight - checkerRadius * 2)
  const step = Math.min(checkerRadius * offCheckerStackSpacing, usable / 14)
  return {
    x: trayX,
    top: trayTop,
    width: Math.max(checkerRadius * 2.3, railWidth * 0.36),
    height: trayHeight,
    step,
    // Per-step delta vector: black stacks downward (y > 0), white upward
    // (y < 0). Positive tilt shifts each successive checker right.
    tiltDx: step * Math.sin(tiltRad),
    tiltDy: step * (Math.cos(tiltRad) - 1),
  }
}

export function offCheckerAnchor(layout: Layout, owner: Player, stackIndex: number): Anchor {
  const {checkerRadius} = layout
  const tray = offTrayMetrics(layout, owner)
  const baseY =
    owner === "black"
      ? tray.top + checkerRadius + stackIndex * tray.step
      : tray.top + tray.height - checkerRadius - stackIndex * tray.step
  // For white the stack travels upward, so the cos-component shortens
  // the upward stride; for black it lengthens the downward stride.
  const dirY = owner === "black" ? 1 : -1
  return {
    x: tray.x + stackIndex * tray.tiltDx,
    y: baseY + stackIndex * tray.tiltDy * dirY,
  }
}

export function checkerCount(state: BoardState, pos: Position, owner: Player): number {
  if (pos === BAR) return state.bar[owner]
  if (pos === OFF) return state.off[owner]
  const point = state.points[pos]
  return point?.owner === owner ? point.count : 0
}

export function checkerAnchor(
  layout: Layout,
  state: BoardState,
  pos: Position,
  owner: Player,
): Anchor | null {
  if (pos === BAR) {
    const count = state.bar[owner]
    if (count <= 0) return null
    return barCheckerAnchor(layout, owner, count - 1)
  }
  if (pos === OFF) return offCheckerAnchor(layout, owner, Math.max(0, state.off[owner] - 1))

  const point = state.points[pos]
  if (point?.owner !== owner || point?.count <= 0) return null
  const ppos = pointCoords(layout, pos)
  return checkerCenter(layout, ppos, point.count - 1, point.count)
}

export function originAnchor(layout: Layout, state: BoardState, pos: Position): Anchor | null {
  const r = layout.checkerRadius
  if (pos === BAR) {
    const cx = layout.barX + layout.barWidth / 2
    const cy =
      state.turn === "white"
        ? layout.height / 2 + r + 6
        : layout.height / 2 - r - 6
    return {x: cx, y: cy}
  }
  if (pos === OFF) return null
  const ppos = pointCoords(layout, pos)
  const point = state.points[pos]
  const top = Math.max(0, (point?.count ?? 1) - 1)
  return checkerCenter(layout, ppos, top, point?.count ?? 1)
}

export function destinationAnchor(layout: Layout, state: BoardState, pos: Position): Anchor | null {
  if (pos === OFF) {
    return offCheckerAnchor(layout, state.turn, state.off[state.turn])
  }
  if (pos === BAR) return null
  const ppos = pointCoords(layout, pos)
  const point = state.points[pos]
  const stackIdx =
    point?.owner === state.turn ? point.count : 0 // landing on top of own stack, else fresh stack
  return checkerCenter(layout, ppos, stackIdx, stackIdx + 1)
}

export function pointIndexForColumn(side: "top" | "bottom", column: number): number {
  return side === "bottom" ? 12 + column : 11 - column
}
