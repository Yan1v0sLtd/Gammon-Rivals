import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
  readonly info: ErrorInfo | null;
}

/**
 * Catches render errors so an exception inside a route shows a real
 * error UI with the stack instead of a silent blank page. Lives at
 * the route level (wraps each lazy page in App.tsx) so a bug in one
 * page can't kill the whole app.
 *
 * We render the stack inline because most of these will be caught
 * during development / mid-iteration; a polished "something went
 * wrong" screen is a follow-up once the live bugs are gone.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[RouteErrorBoundary] render crashed', error, info);
    this.setState({ info });
  }

  render(): ReactNode {
    if (this.state.error) {
      const { error, info } = this.state;
      return (
        <main className="min-h-screen bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt p-6 flex flex-col gap-4 overflow-auto">
          <div className="font-display text-2xl text-rose-300">
            Page crashed — please report this
          </div>
          <div className="text-sm text-board-felt/70">
            The page hit a render error. Take a screenshot of what's below and
            send it to the developer so they can fix it.
          </div>
          <div className="bg-black/40 border border-rose-400/30 rounded p-3 text-xs font-mono text-rose-200 whitespace-pre-wrap break-all">
            <div className="font-bold mb-1">{error.name}: {error.message}</div>
            {error.stack && <div className="opacity-80">{error.stack}</div>}
            {info?.componentStack && (
              <>
                <div className="font-bold mt-3 mb-1">Component stack:</div>
                <div className="opacity-80">{info.componentStack}</div>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <Link
              to="/play"
              className="px-4 py-2 rounded bg-amber-700 text-amber-50 text-sm hover:brightness-110"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded bg-board-felt/10 border border-board-felt/20 text-board-felt/80 text-sm hover:bg-board-felt/15"
            >
              Reload page
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
