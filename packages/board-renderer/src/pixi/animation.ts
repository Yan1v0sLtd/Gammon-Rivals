import type {Container} from "pixi.js"

import type {BoardState, Player, Position} from "../../../engine/src/types"
import {BAR, OFF} from "../../../engine/src/types"
import {checkerCenter, type Layout, pointCoords} from "../coordinates"

import {checkerAnchor, checkerCount} from "./anchors"
import {drawChecker} from "./checkerLayer"
import {
  DEAL_ITEM_DURATION_MS,
  DEAL_TOTAL_MS,
  type DealAnimation,
  type DealItem,
  type MoveAnimation,
  type RenderCtx,
} from "./types"

export function isStartingPosition(state: BoardState): boolean {
  if (state.bar.white !== 0 || state.bar.black !== 0) return false
  if (state.off.white !== 0 || state.off.black !== 0) return false
  const expected: Record<number, readonly [Player, number]> = {
    0: ["white", 2],
    5: ["black", 5],
    7: ["black", 3],
    11: ["white", 5],
    12: ["black", 5],
    16: ["white", 3],
    18: ["white", 5],
    23: ["black", 2],
  }

  for (let idx = 0; idx < 24; idx++) {
    const point = state.points[idx]
    const exp = expected[idx]
    if (!exp) {
      if (point?.owner || point?.count) return false
      continue
    }
    if (point?.owner !== exp[0] || point.count !== exp[1]) return false
  }
  return true
}

function dealItems(layout: Layout, state: BoardState): readonly DealItem[] {
  const stacks: DealItem[][] = []
  for (let pos = 0; pos < 24; pos++) {
    const point = state.points[pos]
    if (!point?.owner || point.count <= 0) continue
    stacks.push(
      Array.from({length: point.count}, (_, stackIndex) => ({
        owner: point.owner!,
        pos,
        stackIndex,
        count: point.count,
      })),
    )
  }
  stacks.sort((a, b) => {
    const aPos = pointCoords(layout, a[0].pos)
    const bPos = pointCoords(layout, b[0].pos)
    return aPos.y - bPos.y || aPos.x - bPos.x
  })

  const items: DealItem[] = []
  const tallest = Math.max(0, ...stacks.map((stack) => stack.length))
  for (let n = 0; n < tallest; n++) {
    for (const stack of stacks) {
      const item = stack[n]
      if (item) items.push(item)
    }
  }
  return items
}

export function createDealAnimation(layout: Layout, state: BoardState): DealAnimation | null {
  const items = dealItems(layout, state)
  if (items.length === 0) return null
  const stagger =
    items.length <= 1
      ? 0
      : Math.max(28, (DEAL_TOTAL_MS - DEAL_ITEM_DURATION_MS) / (items.length - 1))
  return {
    items,
    start: performance.now(),
    itemDuration: DEAL_ITEM_DURATION_MS,
    stagger,
    totalDuration: Math.min(2000, DEAL_ITEM_DURATION_MS + stagger * (items.length - 1)),
  }
}

export function detectMoveAnimation(
  layout: Layout,
  previous: BoardState,
  next: BoardState,
): MoveAnimation | null {
  const owner = previous.turn
  const positions: Position[] = [
    ...Array.from({length: 24}, (_, idx) => idx),
    BAR,
    OFF,
  ]
  let from: Position | null = null
  let to: Position | null = null
  let totalAbsDelta = 0

  for (const pos of positions) {
    const delta = checkerCount(next, pos, owner) - checkerCount(previous, pos, owner)
    totalAbsDelta += Math.abs(delta)
    if (delta === -1) {
      if (from !== null) return null
      from = pos
    }
    else if (delta === 1) {
      if (to !== null) return null
      to = pos
    }
    else if (delta !== 0) {
      return null
    }
  }

  if (totalAbsDelta !== 2 || from === null || to === null) return null

  const fromAnchor = checkerAnchor(layout, previous, from, owner)
  const toAnchor = checkerAnchor(layout, next, to, owner)
  if (!fromAnchor || !toAnchor) return null

  return {
    owner,
    from: fromAnchor,
    to: toAnchor,
    skip: to === BAR ? null : {pos: to, owner},
    start: performance.now(),
    duration: 340,
  }
}

export function drawAnimatedChecker(target: Container, ctx: RenderCtx, animation: MoveAnimation) {
  const raw = Math.min(1, (performance.now() - animation.start) / animation.duration)
  const eased = 1 - Math.pow(1 - raw, 3)
  const lift = Math.sin(raw * Math.PI) * ctx.layout.checkerRadius * 0.55
  const x = animation.from.x + (animation.to.x - animation.from.x) * eased
  const y = animation.from.y + (animation.to.y - animation.from.y) * eased - lift
  drawChecker(target, ctx, x, y, animation.owner)
}

export function drawDealCheckers(target: Container, ctx: RenderCtx, animation: DealAnimation) {
  const elapsed = performance.now() - animation.start
  const source = {
    x: ctx.layout.width * 0.5,
    y: Math.max(ctx.layout.checkerRadius * 1.2, ctx.layout.height * 0.07),
  }

  for (let idx = 0; idx < animation.items.length; idx++) {
    const item = animation.items[idx]
    const itemElapsed = elapsed - idx * animation.stagger
    if (itemElapsed < 0) continue

    const pos = pointCoords(ctx.layout, item.pos)
    const destination = checkerCenter(ctx.layout, pos, item.stackIndex, item.count)
    const t = Math.min(1, itemElapsed / animation.itemDuration)
    const eased = 1 - Math.pow(1 - t, 3)
    const lift = Math.sin(t * Math.PI) * ctx.layout.checkerRadius * 0.6
    const fan = (idx % 5 - 2) * ctx.layout.checkerRadius * 0.18
    const x = source.x + fan * (1 - eased) + (destination.x - source.x) * eased
    const y = source.y + (destination.y - source.y) * eased - lift
    drawChecker(target, ctx, x, y, item.owner)
  }
}
