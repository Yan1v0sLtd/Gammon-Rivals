import {Component, type ErrorInfo, type ReactNode} from "react"

import {Link} from "react-router-dom"

import styles from "./RouteErrorBoundary.module.css"

type Props = {
  readonly children: ReactNode,
}

type State = {
  readonly error: Error | null,
  readonly info: ErrorInfo | null,
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
  state: State = {
    error: null,
    info: null,
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {error}
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[RouteErrorBoundary] render crashed", error, info)
    this.setState({info})
  }

  render(): ReactNode {
    if (this.state.error) {
      const {
        error,
        info,
      } = this.state
      return (<div className={styles.page}>
        <div className={styles.title}>
          Page crashed — please report this
        </div>
        <div className={styles.subtitle}>
          The page hit a render error. Take a screenshot of what's below and
          send it to the developer so they can fix it.
        </div>
        <div className={styles.details}>
          <div className={styles.errorName}>{error.name}: {error.message}</div>
          {error.stack && <div className={styles.stack}>{error.stack}</div>}
          {info?.componentStack && (<>
            <div className={styles.stackHeader}>Component stack:</div>
            <div className={styles.stack}>{info.componentStack}</div>
          </>)}
        </div>
        <div className={styles.actions}>
          <Link
            className={styles.homeLink}
            to="/play">
            Home
          </Link>
          <button
            className={styles.reloadButton}
            type="button"
            onClick={() => {
              window.location.reload()
            }}>
            Reload page
          </button>
        </div>
      </div>)
    }
    return this.props.children
  }
}
