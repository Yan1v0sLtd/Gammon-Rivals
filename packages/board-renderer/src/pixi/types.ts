import type {Texture} from "pixi.js"

import type {Player, Position} from "../../../engine/src/types"
import type {Layout} from "../coordinates"
import type {ThemeAssetKey, ThemeColors} from "../theme/types"

export type RenderSelection = {
  readonly selectedFrom: Position | null,
  readonly validDestinations: readonly Position[],
  readonly legalOrigins: readonly Position[],
  readonly opponentOrigins?: readonly Position[],
  readonly opponentDestinations?: readonly Position[],
  readonly alignmentDebug?: AlignmentDebugSelection,
}

export type AlignmentDebugSelection = {
  readonly enabled: boolean,
  readonly side: "top" | "bottom",
  readonly column: number,
  readonly anchor: "base" | "tip" | "topChecker",
  // 'point' (default) edits a point's geometry; 'offWhite' / 'offBlack'
  // switch the overlay + panel to edit one of the bear-off trays.
  readonly target?: "point" | "offWhite" | "offBlack",
}

export type PointClickHandler = (pos: Position) => void

export type CheckerSkip = {
  readonly pos: Position,
  readonly owner: Player,
}

export type MoveAnimation = {
  readonly owner: Player,
  readonly from: {x: number, y: number},
  readonly to: {x: number, y: number},
  readonly skip: CheckerSkip | null,
  readonly start: number,
  readonly duration: number,
}

export type DealItem = {
  readonly owner: Player,
  readonly pos: number,
  readonly stackIndex: number,
  readonly count: number,
}

export type DealAnimation = {
  readonly items: readonly DealItem[],
  readonly start: number,
  readonly itemDuration: number,
  readonly stagger: number,
  readonly totalDuration: number,
}

/**
 * Everything the layer draw functions need from the renderer. Bundled so
 * each layer module stays a plain function of (target, ctx) instead of a
 * method reaching into BoardRenderer state.
 */
export type RenderCtx = {
  readonly layout: Layout,
  readonly colors: ThemeColors,
  readonly texture: (key: ThemeAssetKey) => Texture | undefined,
}

export const DEAL_ITEM_DURATION_MS = 330
export const DEAL_TOTAL_MS = 1750
