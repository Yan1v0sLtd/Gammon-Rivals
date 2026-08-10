import {Container, Graphics} from "pixi.js"

import type {BoardState, Player} from "../../../engine/src/types"
import {checkerCenter, pointCoords} from "../coordinates"

import {offCheckerAnchor, offTrayMetrics, pointIndexForColumn} from "./anchors"
import type {AlignmentDebugSelection, RenderCtx} from "./types"

function drawOffTrayDebugOverlay(target: Container, ctx: RenderCtx, owner: Player) {
  const tray = offTrayMetrics(ctx.layout, owner)
  const r = ctx.layout.checkerRadius
  const left = tray.x - tray.width / 2
  const g = new Graphics()
  // Outline the active tray in magenta + a soft cyan tint for the
  // inactive one so the user can compare positions while editing.
  const other = owner === "white" ? "black" : "white"
  const otherTray = offTrayMetrics(ctx.layout, other)
  const otherLeft = otherTray.x - otherTray.width / 2
  g.rect(otherLeft, otherTray.top, otherTray.width, otherTray.height).stroke({
    color: 0x23d7ff,
    width: 1.5,
    alpha: 0.35,
  })
  g.rect(left, tray.top, tray.width, tray.height).stroke({
    color: 0xff4df3,
    width: 3,
    alpha: 0.95,
  })
  // Ghost the 15 stack slots so the user can see where each finished
  // checker would land at the current spacing + tilt.
  for (let n = 0; n < 15; n++) {
    const anchor = offCheckerAnchor(ctx.layout, owner, n)
    if (anchor.y < tray.top + r * 0.6 || anchor.y > tray.top + tray.height - r * 0.6) break
    g.circle(anchor.x, anchor.y, r * 0.95).stroke({
      color: 0xff4df3,
      width: 1.5,
      alpha: 0.7,
    })
  }
  target.addChild(g)
}

export function drawAlignmentDebugOverlay(
  target: Container,
  ctx: RenderCtx,
  state: BoardState,
  debug: AlignmentDebugSelection,
) {
  const debugTarget = debug.target ?? "point"
  if (debugTarget === "offWhite" || debugTarget === "offBlack") {
    drawOffTrayDebugOverlay(target, ctx, debugTarget === "offWhite" ? "white" : "black")
    return
  }
  const activeColumn = Math.max(0, Math.min(11, debug.column))
  const g = new Graphics()
  const r = ctx.layout.checkerRadius

  for (let column = 0; column < 12; column++) {
    const idx = pointIndexForColumn(debug.side, column)
    const pos = pointCoords(ctx.layout, idx)
    // pos.tipY already accounts for per-row pointHeight and the
    // felt-tilt perspective transform.
    const tipY = pos.tipY
    const selected = column === activeColumn
    const color = selected ? 0xff4df3 : 0x23d7ff
    const alpha = selected ? 0.95 : 0.32
    const width = selected ? 3 : 1.5

    g.moveTo(pos.x, pos.y)
      .lineTo(pos.tipX, tipY)
      .stroke({color, width, alpha})

    g.circle(pos.x, pos.y, selected && debug.anchor === "base" ? r * 0.22 : r * 0.13)
      .fill({color, alpha: selected && debug.anchor === "base" ? 0.8 : 0.35})
    g.circle(pos.tipX, tipY, selected && debug.anchor === "tip" ? r * 0.22 : r * 0.13)
      .fill({color, alpha: selected && debug.anchor === "tip" ? 0.8 : 0.35})
  }

  const selectedIdx = pointIndexForColumn(debug.side, activeColumn)
  const selectedPoint = state.points[selectedIdx]
  const selectedPos = pointCoords(ctx.layout, selectedIdx)
  const ghostCount = selectedPoint?.count ?? 5

  for (let n = 0; n < ghostCount; n++) {
    const center = checkerCenter(ctx.layout, selectedPos, n, ghostCount)
    const activeTopChecker = debug.anchor === "topChecker" && n === ghostCount - 1
    g.circle(center.x, center.y, r * 1.08).stroke({
      color: activeTopChecker ? 0x7cff74 : 0xff4df3,
      width: activeTopChecker ? 4 : 2.5,
      alpha: activeTopChecker ? 1 : 0.9,
    })
    g.moveTo(center.x - r * 0.24, center.y)
      .lineTo(center.x + r * 0.24, center.y)
      .stroke({color: activeTopChecker ? 0x7cff74 : 0xff4df3, width: 1.5, alpha: 0.8})
    g.moveTo(center.x, center.y - r * 0.24)
      .lineTo(center.x, center.y + r * 0.24)
      .stroke({color: activeTopChecker ? 0x7cff74 : 0xff4df3, width: 1.5, alpha: 0.8})
  }

  target.addChild(g)
}
