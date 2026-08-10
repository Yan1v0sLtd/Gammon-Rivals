import {Container, FillGradient, Graphics, Sprite} from "pixi.js"

import type {BoardState, Player} from "../../../engine/src/types"
import {BAR, OFF} from "../../../engine/src/types"
import {checkerCenter, pointCoords} from "../coordinates"

import {barCheckerAnchor, offCheckerAnchor} from "./anchors"
import type {CheckerSkip, RenderCtx} from "./types"

export function drawChecker(
  target: Container,
  ctx: RenderCtx,
  x: number,
  y: number,
  owner: Player,
  withShadow = true,
) {
  const r = ctx.layout.checkerRadius
  const ry = r * ctx.layout.checkerScaleY
  const tex = ctx.texture(owner === "white" ? "whiteChecker" : "blackChecker")

  if (withShadow) {
    if (tex) {
      // Themed checkers are sprites whose art usually does NOT fill the full
      // r*2 box (the PNG has transparent padding around the disc). A shadow
      // sized to radius r would then peek out across that whole padding gap
      // as a THICK grey halo. Instead, draw the checker's OWN silhouette
      // (same texture, tinted black) a few % larger behind it: the shadow
      // then hugs the actual art shape and shows only a thin, even ~2px
      // halo, independent of how much padding a given theme's sprite has.
      const halo = (grow: number, alpha: number) => {
        const s = new Sprite(tex)
        s.anchor.set(0.5)
        s.x = x
        s.y = y
        s.width = r * 2 * grow
        s.height = r * 2 * ctx.layout.checkerScaleY * grow
        s.tint = 0x000000
        s.alpha = alpha
        target.addChild(s)
      }
      halo(1.05, 0.14)
      halo(1.025, 0.18)
    }
    else {
      // Procedural fallback checker: the disc fills radius r exactly, so the
      // thin concentric-ellipse ring (only the part beyond r shows) is fine.
      const shadow = new Graphics()
      const ring = (grow: number, alpha: number) => {
        shadow.ellipse(x, y, r + grow, ry + grow)
        shadow.fill({color: 0x000000, alpha})
      }
      ring(0.6, 0.1)
      ring(0.4, 0.14)
      ring(0.2, 0.18)
      target.addChild(shadow)
    }
  }

  if (tex) {
    const sprite = new Sprite(tex)
    sprite.anchor.set(0.5)
    sprite.x = x
    sprite.y = y
    sprite.width = r * 2
    sprite.height = r * 2 * ctx.layout.checkerScaleY
    target.addChild(sprite)
    return
  }

  const c = ctx.colors
  const rim = owner === "white" ? c.whiteCheckerRim : c.blackCheckerRim
  const light = owner === "white" ? c.whiteCheckerLight : c.blackCheckerLight
  const dark = owner === "white" ? c.whiteCheckerDark : c.blackCheckerDark
  const highlight = owner === "white" ? c.whiteCheckerHighlight : c.blackCheckerHighlight

  const g = new Graphics()
  // Outer brass-toned rim
  g.circle(x, y, r).fill(c.brass)
  g.circle(x, y, r).stroke({color: c.brassDark, width: 1.5})

  // Inner rim layer (darker, 92% radius)
  g.circle(x, y, r * 0.92).fill(rim)

  // Inner disc with diagonal gradient (light top-left → dark bottom-right)
  const grad = new FillGradient(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7)
  grad.addColorStop(0, light)
  grad.addColorStop(0.55, light)
  grad.addColorStop(1, dark)
  g.circle(x, y, r * 0.78).fill(grad)

  // Concave inset ring
  g.circle(x, y, r * 0.55).stroke({
    color: rim,
    width: Math.max(1.2, r * 0.06),
    alpha: 0.7,
  })

  // Center pip
  g.circle(x, y, r * 0.1).fill({color: rim, alpha: 0.8})

  // Specular highlight top-left
  g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.22, r * 0.16).fill({
    color: highlight,
    alpha: 0.85,
  })
  target.addChild(g)
}

export function drawCheckers(
  target: Container,
  ctx: RenderCtx,
  state: BoardState,
  skip: CheckerSkip | null,
) {
  for (let i = 0; i < 24; i++) {
    const point = state.points[i]
    if (!point || point.count === 0 || point.owner === null) continue
    const pos = pointCoords(ctx.layout, i)
    // Bottom-row spikes point UP; the bottom of the stack (n=0) is
    // closest to the camera in the slight 3-D tilt, so it should be
    // drawn LAST (on top in z). Reverse the iteration order for those.
    // Top-row spikes already match the natural order — the spike's
    // tip end (n=count-1) is closest to the camera there.
    const reverse = pos.stackDir === -1
    for (let k = 0; k < point.count; k++) {
      const n = reverse ? point.count - 1 - k : k
      if (skip?.pos === i && skip.owner === point.owner && n === point.count - 1) continue
      const center = checkerCenter(ctx.layout, pos, n, point.count)
      // Every checker gets the soft 2px all-around shadow now — it's small
      // enough that even the bottom-row base (flush against the rail) won't
      // artifact onto the wood frame, unlike the old half-disc puddle.
      drawChecker(target, ctx, center.x, center.y, point.owner, true)
    }
  }
}

export function drawBarCheckers(
  target: Container,
  ctx: RenderCtx,
  state: BoardState,
  skip: CheckerSkip | null,
) {
  const whiteCount = Math.max(
    0,
    state.bar.white - (skip?.pos === BAR && skip.owner === "white" ? 1 : 0),
  )
  const blackCount = Math.max(
    0,
    state.bar.black - (skip?.pos === BAR && skip.owner === "black" ? 1 : 0),
  )
  for (let n = 0; n < whiteCount; n++) {
    const {x, y} = barCheckerAnchor(ctx.layout, "white", n)
    drawChecker(target, ctx, x, y, "white")
  }
  for (let n = 0; n < blackCount; n++) {
    const {x, y} = barCheckerAnchor(ctx.layout, "black", n)
    drawChecker(target, ctx, x, y, "black")
  }
}

export function drawOffCheckers(
  target: Container,
  ctx: RenderCtx,
  state: BoardState,
  skip: CheckerSkip | null,
) {
  const blackCount = Math.max(
    0,
    state.off.black - (skip?.pos === OFF && skip.owner === "black" ? 1 : 0),
  )
  const whiteCount = Math.max(
    0,
    state.off.white - (skip?.pos === OFF && skip.owner === "white" ? 1 : 0),
  )
  for (let n = 0; n < blackCount; n++) {
    const {x, y} = offCheckerAnchor(ctx.layout, "black", n)
    drawChecker(target, ctx, x, y, "black")
  }
  for (let n = 0; n < whiteCount; n++) {
    const {x, y} = offCheckerAnchor(ctx.layout, "white", n)
    drawChecker(target, ctx, x, y, "white")
  }
}
