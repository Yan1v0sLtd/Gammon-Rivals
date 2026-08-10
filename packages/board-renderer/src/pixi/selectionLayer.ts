import {Container, Graphics} from "pixi.js"

import type {BoardState, Position} from "../../../engine/src/types"

import {destinationAnchor, originAnchor} from "./anchors"
import type {RenderCtx, RenderSelection} from "./types"

function drawOriginHint(target: Container, ctx: RenderCtx, state: BoardState, pos: Position) {
  const a = originAnchor(ctx.layout, state, pos)
  if (!a) return
  const r = ctx.layout.checkerRadius
  const g = new Graphics()
  g.circle(a.x, a.y, r * 1.18).stroke({color: 0xffd34d, width: 2, alpha: 0.45})
  target.addChild(g)
}

function drawThreatOriginHint(target: Container, ctx: RenderCtx, state: BoardState, pos: Position) {
  const a = originAnchor(ctx.layout, state, pos)
  if (!a) return
  const r = ctx.layout.checkerRadius
  const g = new Graphics()
  g.circle(a.x, a.y, r * 1.2).stroke({color: 0xff5c5c, width: 2.5, alpha: 0.55})
  target.addChild(g)
}

function drawThreatDestinationRing(target: Container, ctx: RenderCtx, state: BoardState, pos: Position) {
  const a = destinationAnchor(ctx.layout, state, pos)
  if (!a) return
  const r = ctx.layout.checkerRadius
  const g = new Graphics()
  g.circle(a.x, a.y, r * 0.98).fill({color: 0xef4444, alpha: 0.22})
  g.circle(a.x, a.y, r * 1.08).stroke({color: 0xff6b6b, width: 2.5, alpha: 0.9})
  target.addChild(g)
}

function drawSelectedRing(target: Container, ctx: RenderCtx, state: BoardState, pos: Position) {
  const a = originAnchor(ctx.layout, state, pos)
  if (!a) return
  const r = ctx.layout.checkerRadius
  const g = new Graphics()
  g.circle(a.x, a.y, r * 1.22).stroke({color: 0xffe58a, width: 4, alpha: 0.95})
  g.circle(a.x, a.y, r * 1.05).stroke({color: 0xfff2c2, width: 1.5, alpha: 0.7})
  target.addChild(g)
}

function drawDestinationRing(target: Container, ctx: RenderCtx, state: BoardState, pos: Position) {
  const a = destinationAnchor(ctx.layout, state, pos)
  if (!a) return
  const r = ctx.layout.checkerRadius
  const g = new Graphics()
  g.circle(a.x, a.y, r * 0.95).fill({color: 0x4ade80, alpha: 0.28})
  g.circle(a.x, a.y, r * 1.05).stroke({color: 0x6ee7a3, width: 2.5, alpha: 0.9})
  target.addChild(g)
}

export function drawSelectionOverlay(
  target: Container,
  ctx: RenderCtx,
  state: BoardState,
  selection: RenderSelection,
) {
  const {
    legalOrigins,
    opponentDestinations = [],
    opponentOrigins = [],
    selectedFrom,
    validDestinations,
  } = selection

  for (const origin of opponentOrigins) drawThreatOriginHint(target, ctx, state, origin)
  for (const dest of opponentDestinations) drawThreatDestinationRing(target, ctx, state, dest)

  for (const origin of legalOrigins) {
    if (origin === selectedFrom) continue
    drawOriginHint(target, ctx, state, origin)
  }
  if (selectedFrom !== null) drawSelectedRing(target, ctx, state, selectedFrom)
  for (const dest of validDestinations) drawDestinationRing(target, ctx, state, dest)
}
