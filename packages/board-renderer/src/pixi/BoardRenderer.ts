import {Application, Container} from "pixi.js"

import type {BoardState} from "../../../engine/src/types"
import {measure} from "../../../shared/src/perf"
import {computeLayout, type Layout} from "../coordinates"
import type {LoadedTheme} from "../theme/loader"
import type {ThemeLayout} from "../theme/types"

import {drawAlignmentDebugOverlay} from "./alignmentDebugLayer"
import {
  createDealAnimation,
  detectMoveAnimation,
  drawAnimatedChecker,
  drawDealCheckers,
  isStartingPosition,
} from "./animation"
import {drawBoard} from "./boardLayer"
import {drawBarCheckers, drawCheckers, drawOffCheckers} from "./checkerLayer"
import {drawHitAreas} from "./interactionLayer"
import {drawSelectionOverlay} from "./selectionLayer"
import type {
  CheckerSkip,
  DealAnimation,
  MoveAnimation,
  PointClickHandler,
  RenderCtx,
  RenderSelection,
} from "./types"

export class BoardRenderer {
  private readonly app: Application
  private readonly root: Container
  // Each content layer has an independent rebuild lifecycle.
  private readonly boardLayer: Container
  private readonly checkerLayer: Container
  private readonly selectionLayer: Container
  private readonly interactionLayer: Container
  private readonly animationLayer: Container
  private layout: Layout
  private layoutWidth: number
  private layoutHeight: number
  private themeLayout: ThemeLayout | undefined
  private readonly loaded: LoadedTheme
  private onPointClick: PointClickHandler | null = null
  private interactionEnabled = false
  private previousState: BoardState | null = null
  private currentState: BoardState | null = null
  private currentSelection: RenderSelection | undefined
  private animation: MoveAnimation | null = null
  private dealAnimation: DealAnimation | null = null
  private scheduledFrame: number | null = null
  private destroyed = false

  // Stable forwarder so hit areas stay late-bound to the current handler
  // instead of capturing whichever one was set at rebuild time.
  private readonly emitPointClick: PointClickHandler = (pos) => {
    this.onPointClick?.(pos)
  }

  constructor(app: Application, loaded: LoadedTheme) {
    this.app = app
    this.loaded = loaded
    this.root = new Container()
    this.boardLayer = new Container()
    this.checkerLayer = new Container()
    this.selectionLayer = new Container()
    this.interactionLayer = new Container()
    this.animationLayer = new Container()
    this.root.addChild(this.boardLayer, this.checkerLayer, this.selectionLayer, this.interactionLayer, this.animationLayer)
    this.app.stage.addChild(this.root)
    this.themeLayout = loaded.theme.layout
    this.layout = computeLayout(app.screen.width, app.screen.height, this.themeLayout)
    this.layoutWidth = this.layout.width
    this.layoutHeight = this.layout.height
    this.rebuildBoardLayer()
  }

  resize(width: number, height: number) {
    if (width === this.layoutWidth && height === this.layoutHeight) return
    this.layout = computeLayout(width, height, this.themeLayout)
    this.layoutWidth = width
    this.layoutHeight = height
    this.rebuildAllLayers()
  }

  setThemeLayout(themeLayout: ThemeLayout | undefined) {
    this.themeLayout = themeLayout
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height, this.themeLayout)
    this.layoutWidth = this.layout.width
    this.layoutHeight = this.layout.height
    this.rebuildAllLayers()
  }

  setOnPointClick(fn: PointClickHandler | null) {
    this.onPointClick = fn
  }

  setInteractionEnabled(enabled: boolean) {
    if (enabled === this.interactionEnabled) return
    this.interactionEnabled = enabled
    this.rebuildInteractionLayer()
    this.invalidate()
  }

  setPosition(state: BoardState) {
    const alignmentMode = Boolean(this.currentSelection?.alignmentDebug?.enabled)
    const shouldDeal =
      !alignmentMode
      && isStartingPosition(state)
      && (!this.previousState || !isStartingPosition(this.previousState))

    if (shouldDeal) {
      const deal = createDealAnimation(this.layout, state)
      if (deal) {
        this.dealAnimation = deal
        this.startAnimationLoop()
      }
    }

    if (this.previousState && this.previousState !== state) {
      this.animation = detectMoveAnimation(this.layout, this.previousState, state)
      if (this.animation) this.startAnimationLoop()
    }
    this.previousState = state
    this.currentState = state
    this.rebuildCheckerLayer(state, this.currentAnimation()?.skip ?? null)
    this.rebuildSelectionLayer(state, this.currentSelection)
    this.clearAnimationLayer()
    this.drawAnimationFrame()
    this.invalidate()
  }

  setSelection(selection: RenderSelection | undefined) {
    this.currentSelection = selection
    this.rebuildSelectionLayer(this.currentState, selection)
    this.invalidate()
  }

  private get ctx(): RenderCtx {
    return {
      layout: this.layout,
      colors: this.loaded.theme.colors,
      texture: (key) => this.loaded.textures[key],
    }
  }

  private rebuildAllLayers() {
    this.rebuildBoardLayer()
    this.rebuildCheckerLayer(this.currentState, this.currentAnimation()?.skip ?? null)
    this.rebuildSelectionLayer(this.currentState, this.currentSelection)
    this.rebuildInteractionLayer()
    this.clearAnimationLayer()
    this.drawAnimationFrame()
    this.invalidate()
  }

  private rebuildBoardLayer() {
    measure("pixi.layer.board.rebuild", () => {
      this.clearLayer(this.boardLayer)
      drawBoard(this.boardLayer, this.ctx)
    })
  }

  private rebuildCheckerLayer(state: BoardState | null, skip: CheckerSkip | null) {
    measure("pixi.layer.checkers.rebuild", () => {
      this.clearLayer(this.checkerLayer)
      if (!state) return
      const ctx = this.ctx
      const dealAnimation = this.dealAnimation && this.currentDealAnimation()
      if (!dealAnimation) {
        drawCheckers(this.checkerLayer, ctx, state, skip)
      }
      drawBarCheckers(this.checkerLayer, ctx, state, skip)
      drawOffCheckers(this.checkerLayer, ctx, state, skip)
    })
  }

  private rebuildSelectionLayer(state: BoardState | null, selection: RenderSelection | undefined) {
    measure("pixi.layer.selection.rebuild", () => {
      this.clearLayer(this.selectionLayer)
      if (!state || !selection) return
      const ctx = this.ctx
      drawSelectionOverlay(this.selectionLayer, ctx, state, selection)
      if (selection?.alignmentDebug?.enabled) {
        drawAlignmentDebugOverlay(this.selectionLayer, ctx, state, selection.alignmentDebug)
      }
    })
  }

  private rebuildInteractionLayer() {
    measure("pixi.layer.interaction.rebuild", () => {
      this.clearLayer(this.interactionLayer)
      if (!this.interactionEnabled || !this.onPointClick) return
      drawHitAreas(this.interactionLayer, this.layout, this.emitPointClick)
    })
  }

  private clearAnimationLayer() {
    this.clearLayer(this.animationLayer)
  }

  private drawAnimationFrame() {
    const animation = this.currentAnimation()
    const dealAnimation = this.currentDealAnimation()
    if (!animation && !dealAnimation) return
    const ctx = this.ctx
    if (dealAnimation) {
      drawDealCheckers(this.animationLayer, ctx, dealAnimation)
    }
    if (animation) {
      drawAnimatedChecker(this.animationLayer, ctx, animation)
    }
  }

  private clearLayer(layer: Container) {
    const children = layer.removeChildren()
    for (const child of children) {
      child.destroy({children: true, texture: false, textureSource: false})
    }
  }

  private currentAnimation(): MoveAnimation | null {
    const animation = this.animation
    if (!animation) return null
    if (performance.now() - animation.start >= animation.duration) {
      this.animation = null
      return null
    }
    return animation
  }

  private currentDealAnimation(): DealAnimation | null {
    const animation = this.dealAnimation
    if (!animation) return null
    if (performance.now() - animation.start >= animation.totalDuration) {
      this.dealAnimation = null
      return null
    }
    return animation
  }

  private invalidate() {
    if (this.destroyed || this.scheduledFrame !== null) return
    this.scheduledFrame = requestAnimationFrame(() => {
      measure("pixi.animation.frame", () => {
        this.scheduledFrame = null
        if (this.destroyed) return

        const hadAnimation = Boolean(this.animation)
        const hadDealAnimation = Boolean(this.dealAnimation)
        const animation = this.currentAnimation()
        const dealAnimation = this.currentDealAnimation()
        if (hadAnimation || hadDealAnimation) {
          this.clearAnimationLayer()
          if ((!animation && hadAnimation) || (!dealAnimation && hadDealAnimation)) {
            this.rebuildCheckerLayer(this.currentState, animation?.skip ?? null)
            this.rebuildSelectionLayer(this.currentState, this.currentSelection)
          }
          if (animation || dealAnimation) this.drawAnimationFrame()
        }

        this.app.renderer.render({container: this.app.stage})
        if (this.animation || this.dealAnimation) this.invalidate()
      })
    })
  }

  private startAnimationLoop() {
    this.invalidate()
  }

  destroy() {
    this.destroyed = true
    if (this.scheduledFrame !== null) {
      cancelAnimationFrame(this.scheduledFrame)
      this.scheduledFrame = null
    }
    this.animation = null
    this.dealAnimation = null
    this.root.destroy({children: true, texture: false, textureSource: false})
  }
}
