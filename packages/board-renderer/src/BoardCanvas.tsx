import {useEffect, useRef} from "react"

import {Application} from "pixi.js"

import type {BoardState, Position} from "../../engine/src/types"

import {BoardRenderer} from "./pixi/BoardRenderer"
import type {RenderSelection} from "./pixi/types"
import {defaultTheme} from "./theme/default"
import {loadTheme} from "./theme/loader"
import type {Theme, ThemeLayout} from "./theme/types"

type Props = {
  state: BoardState,
  theme?: Theme,
  layoutOverride?: ThemeLayout,
  selection?: RenderSelection,
  onPointClick?: (pos: Position) => void,
  interactionEnabled?: boolean,
  /** Fires once Pixi has finished initialising and the first board
   *  frame has been rendered. Lets the surrounding route hold its
   *  loader overlay open until the WebGL surface is actually painted,
   *  instead of fading on HTML-image readiness alone. */
  onReady?: () => void,
}

export function BoardCanvas({
  state,
  theme = defaultTheme,
  layoutOverride,
  selection,
  onPointClick,
  interactionEnabled: interactionEnabledProp,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<Application | null>(null)
  const rendererRef = useRef<BoardRenderer | null>(null)

  const stateRef = useRef(state)
  const selectionRef = useRef(selection)
  const clickRef = useRef(onPointClick)
  const layoutOverrideRef = useRef(layoutOverride)
  const interactionEnabled = interactionEnabledProp ?? Boolean(onPointClick)
  const interactionEnabledRef = useRef(interactionEnabled)
  // Held in a ref so the init effect (theme-keyed) doesn't have to
  // re-run just because the parent passed a new onReady identity.
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let initialized = false
    let renderer: BoardRenderer | null = null
    let resizeObserver: ResizeObserver | null = null
    let outerReadyFrame: number | null = null
    let innerReadyFrame: number | null = null
    const app = new Application()

    const renderLatest = () => {
      if (!renderer) return
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      app.renderer.resize(width, height)
      renderer.resize(width, height)
    }

    (async () => {
      // Mobile GPUs choke on a full-DPR board: a DPR-3 phone would render ~9x
      // the pixels of a DPR-1 desktop, and MSAA antialias piles on more fill
      // cost. Cap the render resolution at 2x (imperceptible on a phone-sized
      // board, but ~2.25x less fill than DPR 3) and skip antialias on hi-DPI
      // screens, where the pixel density already smooths edges. Desktop
      // (DPR 1) keeps antialias for crisp edges.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const [, loaded] = await Promise.all([
        app.init({
          resizeTo: container,
          backgroundAlpha: 0,
          antialias: dpr < 2,
          autoDensity: true,
          resolution: dpr,
        }),
        loadTheme(theme),
      ])
      initialized = true
      if (cancelled) {
        app.destroy(true)
        return
      }
      app.ticker.stop()
      container.appendChild(app.canvas)
      appRef.current = app

      renderer = new BoardRenderer(app, loaded)
      renderer.setThemeLayout(layoutOverrideRef.current ?? theme.layout)
      renderer.setOnPointClick((pos) => clickRef.current?.(pos))
      rendererRef.current = renderer
      renderer.setSelection(selectionRef.current)
      renderer.setPosition(stateRef.current)
      renderer.setInteractionEnabled(interactionEnabledRef.current)

      // app.renderer.render() only updates Pixi's scene graph; the actual
      // GPU draw happens on the next ticker tick (rAF). If we fire
      // onReady immediately, the overlay can start fading on a canvas
      // that's still blank, briefly exposing the underlying layout.
      // Force a synchronous render so the canvas is composited before
      // we signal ready. Wrapped in try because in some pixi build
      // variants the renderer.render shape differs slightly; the
      // double-rAF fallback below covers that.
      try {
        app.renderer.render({container: app.stage})
      }
      catch {
        // ignore — fall through to the rAF wait below
      }
      outerReadyFrame = requestAnimationFrame(() => {
        innerReadyFrame = requestAnimationFrame(() => {
          if (cancelled) return
          onReadyRef.current?.()
        })
      })

      resizeObserver = new ResizeObserver(renderLatest)
      resizeObserver.observe(container)
    })()

    return () => {
      cancelled = true
      if (outerReadyFrame !== null) cancelAnimationFrame(outerReadyFrame)
      if (innerReadyFrame !== null) cancelAnimationFrame(innerReadyFrame)
      resizeObserver?.disconnect()
      if (rendererRef.current === renderer) {
        appRef.current = null
        rendererRef.current = null
      }
      renderer?.destroy()
      if (initialized) app.destroy(true)
    }
  }, [theme])

  useEffect(() => {
    stateRef.current = state
    rendererRef.current?.setPosition(state)
  }, [state])

  useEffect(() => {
    selectionRef.current = selection
    rendererRef.current?.setSelection(selection)
  }, [selection])

  useEffect(() => {
    layoutOverrideRef.current = layoutOverride
    rendererRef.current?.setThemeLayout(layoutOverride ?? theme.layout)
  }, [layoutOverride, theme.layout])

  useEffect(() => {
    interactionEnabledRef.current = interactionEnabled
    rendererRef.current?.setInteractionEnabled(interactionEnabled)
  }, [interactionEnabled])

  useEffect(() => {
    clickRef.current = onPointClick
  }, [onPointClick])

  const boardBackground = theme.assets?.board
    ? {
      backgroundImage: `url("${theme.assets.board}")`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "100% 100%",
    }
    : undefined

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-visible"
      style={boardBackground}/>
  )
}
