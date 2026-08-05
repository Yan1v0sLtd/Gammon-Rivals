import {StrictMode} from "react"

import {createRoot} from "react-dom/client"
import {Provider} from "react-redux"

import "./index.css"
import "./keyframes.css"
import {initializeClient} from "../../../packages/shared/src/clientBootstrap"

import {App} from "./App.tsx"
import {NavigationLoaderOverlay} from "./components/NavigationLoaderOverlay"
import {authInitializationRequested} from "./features/auth/authActions"
import {installNativeAuthHandler} from "./lib/nativeAuth"
import {store} from "./store/store"

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
