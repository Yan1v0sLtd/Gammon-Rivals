import {Container, Graphics} from "pixi.js"

import type {Layout} from "../coordinates"
import {computeHitRects} from "../hit-areas"

import type {PointClickHandler} from "./types"

export function drawHitAreas(target: Container, layout: Layout, onPointClick: PointClickHandler) {
  // All hit-area math lives in packages/board-renderer/src/hit-areas.ts as a pure
  // function, kept separate from this imperative loop so it stays readable and
  // reusable across themes/orientations. If you're tempted to tweak this loop,
  // edit the pure function instead.
  const rects = computeHitRects(layout)
  for (const rect of rects) {
    const g = new Graphics()
    g
      .rect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
      .fill({color: 0xffffff, alpha: 0.001})
    g.eventMode = "static"
    g.cursor = "pointer"
    const hitTarget = rect.target
    g.on("pointerdown", () => {
      onPointClick(hitTarget)
    })
    target.addChild(g)
  }
}
