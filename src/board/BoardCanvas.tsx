import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import type { BoardState, Position } from '../engine/types';
import { BoardRenderer, type RenderSelection } from './pixi/BoardRenderer';
import { defaultTheme, loadTheme, type Theme, type ThemeLayout } from './theme';

interface Props {
  state: BoardState;
  theme?: Theme;
  layoutOverride?: ThemeLayout;
  selection?: RenderSelection;
  onPointClick?: (pos: Position) => void;
  /** Fires once Pixi has finished initialising and the first board
   *  frame has been rendered. Lets the surrounding route hold its
   *  loader overlay open until the WebGL surface is actually painted,
   *  instead of fading on HTML-image readiness alone. */
  onReady?: () => void;
}

export default function BoardCanvas({
  state,
  theme = defaultTheme,
  layoutOverride,
  selection,
  onPointClick,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);

  const stateRef = useRef(state);
  const selectionRef = useRef(selection);
  const clickRef = useRef(onPointClick);
  const layoutOverrideRef = useRef(layoutOverride);
  // Held in a ref so the init effect (theme-keyed) doesn't have to
  // re-run just because the parent passed a new onReady identity.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let initialized = false;
    let renderer: BoardRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const app = new Application();

    const renderLatest = () => {
      if (!renderer) return;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      app.renderer.resize(width, height);
      renderer.resize(width, height);
      renderer.render(stateRef.current, selectionRef.current);
    };

    (async () => {
      const [, loaded] = await Promise.all([
        app.init({
          resizeTo: container,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        }),
        loadTheme(theme),
      ]);
      initialized = true;
      if (cancelled) {
        app.destroy(true);
        return;
      }
      container.appendChild(app.canvas);
      appRef.current = app;

      renderer = new BoardRenderer(app, loaded);
      renderer.setThemeLayout(layoutOverrideRef.current ?? theme.layout);
      renderer.setOnPointClick((pos) => clickRef.current?.(pos));
      rendererRef.current = renderer;
      renderLatest();

      // Pixi has now drawn the board with the loaded textures. Notify
      // the parent so it can release the loading overlay on a fully
      // composed surface (not just on HTML-image readiness).
      onReadyRef.current?.();

      resizeObserver = new ResizeObserver(renderLatest);
      resizeObserver.observe(container);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (rendererRef.current === renderer) {
        appRef.current = null;
        rendererRef.current = null;
      }
      renderer?.destroy();
      if (initialized) app.destroy(true);
    };
  }, [theme]);

  useEffect(() => {
    stateRef.current = state;
    selectionRef.current = selection;
    clickRef.current = onPointClick;
    rendererRef.current?.render(state, selection);
  }, [state, selection, onPointClick]);

  useEffect(() => {
    layoutOverrideRef.current = layoutOverride;
    rendererRef.current?.setThemeLayout(layoutOverride ?? theme.layout);
    rendererRef.current?.render(stateRef.current, selectionRef.current);
  }, [layoutOverride, theme.layout]);

  const boardBackground = theme.assets?.board
    ? {
        backgroundImage: `url("${theme.assets.board}")`,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
      }
    : undefined;

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-visible"
      style={boardBackground}
    />
  );
}
