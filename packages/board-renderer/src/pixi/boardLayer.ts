import {Container, FillGradient, Graphics, Sprite, TilingSprite} from "pixi.js"

import {pointCoords} from "../coordinates"

import {offTrayMetrics} from "./anchors"
import type {RenderCtx} from "./types"

// Deterministic LCG for reproducible "wood grain" patterns
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * Procedural wood grain. Draws horizontal stripes of varying alpha/thickness
 * over an existing rectangle. Deterministic per-seed.
 */
function drawWoodGrain(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  direction: "horizontal" | "vertical",
) {
  const rand = lcg(seed)
  const span = direction === "horizontal" ? h : w
  const numStripes = Math.max(8, Math.floor(span / 6))

  for (let i = 0; i < numStripes; i++) {
    const t = (i + rand() * 0.6) / numStripes
    const offset = t * span
    const thickness = 0.6 + rand() * 1.6
    const alpha = 0.04 + rand() * 0.10
    const dark = rand() > 0.5
    const color = dark ? 0x000000 : 0xffffff

    if (direction === "horizontal") {
      g.rect(x, y + offset, w, thickness).fill({color, alpha})
    }
    else {
      g.rect(x + offset, y, thickness, h).fill({color, alpha})
    }
  }
}

function drawBoardTexture(target: Container, ctx: RenderCtx) {
  const tex = ctx.texture("board")
  if (!tex) return
  const {width, height} = ctx.layout
  const sprite = new Sprite(tex)
  sprite.width = width
  sprite.height = height
  target.addChild(sprite)
}

function drawFrame(target: Container, ctx: RenderCtx) {
  const {width, height} = ctx.layout
  const tex = ctx.texture("frame")
  if (tex) {
    const sprite = new TilingSprite({texture: tex, width, height})
    target.addChild(sprite)
    return
  }
  const grad = new FillGradient(0, 0, 0, height)
  grad.addColorStop(0, ctx.colors.frameLight)
  grad.addColorStop(0.55, ctx.colors.frameDark)
  grad.addColorStop(1, ctx.colors.frameLight)

  const g = new Graphics()
  g.rect(0, 0, width, height).fill(grad)
  drawWoodGrain(g, 0, 0, width, height, 7919, "horizontal")

  // Bevel highlights — top/bottom edges
  g.rect(0, 0, width, 3).fill({color: ctx.colors.frameBevel, alpha: 0.7})
  g.rect(0, height - 3, width, 3).fill({color: 0x000000, alpha: 0.5})
  target.addChild(g)
}

function drawRails(target: Container, ctx: RenderCtx) {
  const {width, height, railWidth} = ctx.layout
  const tex = ctx.texture("rail")
  if (tex) {
    const left = new TilingSprite({texture: tex, width: railWidth, height})
    const right = new TilingSprite({
      texture: tex,
      width: railWidth,
      height,
      x: width - railWidth,
    })
    target.addChild(left, right)
    return
  }
  const g = new Graphics()

  const gradL = new FillGradient(0, 0, railWidth, 0)
  gradL.addColorStop(0, ctx.colors.frameDark)
  gradL.addColorStop(0.55, ctx.colors.rail)
  gradL.addColorStop(1, ctx.colors.frameInnerEdge)
  g.rect(0, 0, railWidth, height).fill(gradL)
  drawWoodGrain(g, 0, 0, railWidth, height, 1709, "vertical")

  const gradR = new FillGradient(0, 0, railWidth, 0)
  gradR.addColorStop(0, ctx.colors.frameInnerEdge)
  gradR.addColorStop(0.45, ctx.colors.rail)
  gradR.addColorStop(1, ctx.colors.frameDark)
  g.rect(width - railWidth, 0, railWidth, height).fill(gradR)
  drawWoodGrain(g, width - railWidth, 0, railWidth, height, 4129, "vertical")

  target.addChild(g)
}

function drawFelt(target: Container, ctx: RenderCtx) {
  const {playLeft, playWidth, height} = ctx.layout
  const tex = ctx.texture("felt")
  if (tex) {
    const sprite = new TilingSprite({texture: tex, width: playWidth, height, x: playLeft})
    target.addChild(sprite)
    return
  }
  const g = new Graphics()
  g.rect(playLeft, 0, playWidth, height).fill(ctx.colors.felt)

  // Vignette: darker stripes at top/bottom edges
  const edge = 14
  const vigTop = new FillGradient(playLeft, 0, playLeft, edge)
  vigTop.addColorStop(0, ctx.colors.feltVignette)
  vigTop.addColorStop(1, {r: 0, g: 0, b: 0, a: 0})
  g.rect(playLeft, 0, playWidth, edge).fill(vigTop)

  const vigBot = new FillGradient(playLeft, height - edge, playLeft, height)
  vigBot.addColorStop(0, {r: 0, g: 0, b: 0, a: 0})
  vigBot.addColorStop(1, ctx.colors.feltVignette)
  g.rect(playLeft, height - edge, playWidth, edge).fill(vigBot)

  // Inner dark seam between frame and felt
  g.rect(playLeft - 2, 0, 2, height).fill(ctx.colors.frameInnerEdge)
  g.rect(playLeft + playWidth, 0, 2, height).fill(ctx.colors.frameInnerEdge)

  // Bright gold bevel hairline on the felt side of the seam
  g.rect(playLeft, 0, 1, height).fill({color: ctx.colors.brass, alpha: 0.55})
  g.rect(playLeft + playWidth - 1, 0, 1, height).fill({color: ctx.colors.brass, alpha: 0.55})
  target.addChild(g)
}

function drawPoints(target: Container, ctx: RenderCtx) {
  const {pointWidth, topPointHeight, bottomPointHeight} = ctx.layout
  const lightTex = ctx.texture("pointLight")
  const darkTex = ctx.texture("pointDark")

  for (let i = 0; i < 24; i++) {
    const pos = pointCoords(ctx.layout, i)
    const isLight = pos.column % 2 === 0
    const tex = isLight ? lightTex : darkTex
    // Per-row depth so editing "Point depth (bottom)" only affects
    // the bottom-row triangles (and the same for top).
    const pointHeight = pos.stackDir === 1 ? topPointHeight : bottomPointHeight

    if (tex) {
      const sprite = new Sprite(tex)
      sprite.width = pointWidth
      sprite.height = pointHeight
      sprite.anchor.set(0.5, 0)
      sprite.x = pos.x
      sprite.y = pos.stackDir === 1 ? pos.y : pos.y - pointHeight
      if (pos.stackDir === -1) sprite.scale.y = -Math.abs(sprite.scale.y)
      target.addChild(sprite)
      continue
    }

    const baseColor = isLight ? ctx.colors.pointLightBase : ctx.colors.pointDarkBase
    const tipColor = isLight ? ctx.colors.pointLightTip : ctx.colors.pointDarkTip
    // pos.tipY already incorporates the felt-tilt perspective; using
    // pos.y + stackDir*pointHeight would mix tilted base + flat delta.
    const tipY = pos.tipY
    const grad = new FillGradient(pos.x, pos.y, pos.x, tipY)
    grad.addColorStop(0, baseColor)
    grad.addColorStop(0.85, tipColor)
    grad.addColorStop(1, tipColor)

    const g = new Graphics()
    g.poly([
      pos.x - pointWidth / 2, pos.y,
      pos.x + pointWidth / 2, pos.y,
      pos.x, tipY,
    ])
      .fill(grad)
      .stroke({color: ctx.colors.pointOutline, width: 1, alpha: 0.45})

    // Subtle inner highlight along the long edges of the triangle
    const edgeAlpha = isLight ? 0.25 : 0.15
    const edgeColor = isLight ? 0xffffff : ctx.colors.brassDark
    g.moveTo(pos.x - pointWidth / 2 + 1, pos.y)
      .lineTo(pos.x, tipY)
      .stroke({color: edgeColor, width: 1, alpha: edgeAlpha})
    target.addChild(g)
  }
}

function drawBar(target: Container, ctx: RenderCtx) {
  const {barX, barWidth, height} = ctx.layout
  const tex = ctx.texture("bar")
  if (tex) {
    const sprite = new TilingSprite({texture: tex, width: barWidth, height, x: barX})
    target.addChild(sprite)
    return
  }
  const grad = new FillGradient(barX, 0, barX + barWidth, 0)
  grad.addColorStop(0, ctx.colors.frameInnerEdge)
  grad.addColorStop(0.5, ctx.colors.barHighlight)
  grad.addColorStop(1, ctx.colors.frameInnerEdge)

  const g = new Graphics()
  g.rect(barX, 0, barWidth, height).fill(grad)
  drawWoodGrain(g, barX, 0, barWidth, height, 2389, "vertical")

  // Brass corner caps where bar meets frame top/bottom
  const capW = barWidth * 1.05
  const capH = barWidth * 0.35
  const cx = barX + barWidth / 2
  const capGradTop = new FillGradient(0, 0, 0, capH)
  capGradTop.addColorStop(0, ctx.colors.brass)
  capGradTop.addColorStop(1, ctx.colors.brassDark)
  g.roundRect(cx - capW / 2, 0, capW, capH, 2).fill(capGradTop)

  const capGradBot = new FillGradient(0, 0, 0, capH)
  capGradBot.addColorStop(0, ctx.colors.brassDark)
  capGradBot.addColorStop(1, ctx.colors.brass)
  g.roundRect(cx - capW / 2, height - capH, capW, capH, 2).fill(capGradBot)

  target.addChild(g)
}

function drawHinges(target: Container, ctx: RenderCtx) {
  const {barX, barWidth, height} = ctx.layout
  const tex = ctx.texture("hinge")
  const cx = barX + barWidth / 2
  const hingeW = barWidth * 1.6
  const hingeH = Math.min(barWidth * 1.1, height * 0.05)
  const positions = [height * 0.18, height - height * 0.18 - hingeH]

  for (const top of positions) {
    if (tex) {
      const sprite = new Sprite(tex)
      sprite.width = hingeW
      sprite.height = hingeH
      sprite.anchor.set(0.5, 0)
      sprite.x = cx
      sprite.y = top
      target.addChild(sprite)
      continue
    }

    const g = new Graphics()
    const plateGrad = new FillGradient(0, top, 0, top + hingeH)
    plateGrad.addColorStop(0, ctx.colors.brass)
    plateGrad.addColorStop(0.4, 0xf5d56a)
    plateGrad.addColorStop(0.65, ctx.colors.brass)
    plateGrad.addColorStop(1, ctx.colors.brassDark)

    g.roundRect(cx - hingeW / 2, top, hingeW, hingeH, hingeH * 0.25).fill(plateGrad)
    g.roundRect(cx - hingeW / 2, top, hingeW, hingeH, hingeH * 0.25).stroke({
      color: ctx.colors.brassDark,
      width: 1.5,
    })

    // Four rivets — corners
    const rivetR = hingeH * 0.13
    const padX = hingeH * 0.5
    const padY = hingeH * 0.28
    const rivets: [number, number][] = [
      [cx - hingeW / 2 + padX, top + padY],
      [cx + hingeW / 2 - padX, top + padY],
      [cx - hingeW / 2 + padX, top + hingeH - padY],
      [cx + hingeW / 2 - padX, top + hingeH - padY],
    ]
    for (const [rx, ry] of rivets) {
      g.circle(rx, ry, rivetR).fill(ctx.colors.brassDark)
      g.circle(rx - rivetR * 0.3, ry - rivetR * 0.3, rivetR * 0.35).fill({
        color: 0xffffff,
        alpha: 0.4,
      })
    }
    target.addChild(g)
  }
}

function drawOffTrayBackgrounds(target: Container, ctx: RenderCtx) {
  const bg = new Graphics()
  for (const owner of ["black", "white"] as const) {
    const tray = offTrayMetrics(ctx.layout, owner)
    const left = tray.x - tray.width / 2
    const grad = new FillGradient(left, 0, left + tray.width, 0)
    grad.addColorStop(0, ctx.colors.frameInnerEdge)
    grad.addColorStop(0.5, ctx.colors.trayBg)
    grad.addColorStop(1, ctx.colors.frameInnerEdge)
    bg.roundRect(left, tray.top, tray.width, tray.height, 6).fill(grad)
    bg.roundRect(left, tray.top, tray.width, tray.height, 6).stroke({
      color: ctx.colors.brassDark,
      width: 1,
      alpha: 0.6,
    })
  }
  target.addChild(bg)
}

/**
 * Static board chrome. A theme that ships a full `board` texture replaces
 * every procedural surface below it with a single sprite.
 */
export function drawBoard(target: Container, ctx: RenderCtx) {
  const hasBoardTexture = Boolean(ctx.texture("board"))
  if (hasBoardTexture) {
    drawBoardTexture(target, ctx)
  }
  else {
    drawFrame(target, ctx)
    drawRails(target, ctx)
    drawFelt(target, ctx)
    drawPoints(target, ctx)
    drawBar(target, ctx)
    drawHinges(target, ctx)
    drawOffTrayBackgrounds(target, ctx)
  }
}
