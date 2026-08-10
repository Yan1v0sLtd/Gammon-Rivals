import {Container, Sprite} from "pixi.js"

import type {RenderCtx} from "./types"

/**
 * Static board chrome. The theme MUST ship a full `board` texture; a missing
 * one is a configuration error and fails loudly instead of rendering a fake
 * procedural board.
 */
export function drawBoard(target: Container, ctx: RenderCtx) {
  const tex = ctx.texture("board")
  if (!tex) throw new Error("Board theme is missing its 'board' texture")
  const {width, height} = ctx.layout
  const sprite = new Sprite(tex)
  sprite.width = width
  sprite.height = height
  target.addChild(sprite)
}
