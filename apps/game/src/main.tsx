import {StrictMode} from "react"

import {createRoot} from "react-dom/client"
import {Provider} from "react-redux"

import "./index.css"
import "./keyframes.css"
import {initializeClient} from "../../../packages/shared/src/clientBootstrap"
import {getCounts, resetCounts} from "../../../packages/shared/src/perf"

import {App} from "./App.tsx"
import {NavigationLoaderOverlay} from "./components/NavigationLoaderOverlay"
import {authInitializationRequested} from "./features/auth/authActions"
import {installNativeAuthHandler} from "./lib/nativeAuth"
import {store} from "./store/store"

declare global {
  // Window augmentation requires interface merging for the DOM lib type.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    __perf?: {
      readonly getCounts: typeof getCounts,
      readonly resetCounts: typeof resetCounts,
    }
  }
}

if (import.meta.env.DEV) {
  window.__perf = {getCounts, resetCounts}
}

initializeClient("Gammon Rivals", "gammon-rivals")

// Native auth can arrive before React mounts, so register its listener first.
void installNativeAuthHandler()
store.dispatch(authInitializationRequested())

createRoot(document.getElementById("root")!).render(<StrictMode>
  <Provider store={store}>
    <App/>
    <NavigationLoaderOverlay/>
  </Provider>
</StrictMode>)
