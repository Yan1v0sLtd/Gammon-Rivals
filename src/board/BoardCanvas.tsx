import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import type { BoardState, Position } from '../engine/types';
import { BoardRenderer, type RenderSelection } from './pixi/BoardRenderer';
import { defaultTheme, loadTheme, type Theme } from './theme';

interface Props {
  state: BoardState;
  theme?: Theme;
  selection?: RenderSelection;
  onPointClick?: (pos: Position) => void;
}

export default function BoardCanvas({
  state,
  theme = defaultTheme,
  selection,
  onPointClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);

  const stateRef = useRef(state);
  const selectionRef = useRef(selection);
  const clickRef = useRef(onPointClick);
  stateRef.current = state;
  selectionRef.current = selection;
  clickRef.current = onPointClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let resizeHandler: (() => void) | null = null;
    const app = new Application();

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
      if (cancelled) {
        app.destroy(true);
        return;
      }
      container.appendChild(app.canvas);
      appRef.current = app;

      const renderer = new BoardRenderer(app, loaded);
      renderer.setOnPointClick((pos) => clickRef.current?.(pos));
      rendererRef.current = renderer;
      renderer.render(stateRef.current, selectionRef.current);

      resizeHandler = () => {
        renderer.resize(app.screen.width, app.screen.height);
        renderer.render(stateRef.current, selectionRef.current);
      };
      window.addEventListener('resize', resizeHandler);
    })();

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      const a = appRef.current;
      if (a) {
        rendererRef.current?.destroy();
        a.destroy(true);
        appRef.current = null;
        rendererRef.current = null;
      }
    };
  }, [theme]);

  useEffect(() => {
    rendererRef.current?.render(state, selection);
  }, [state, selection]);

  return <div ref={containerRef} className="w-full h-full" />;
}
