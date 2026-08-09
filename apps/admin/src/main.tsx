import {StrictMode} from "react"

import {createRoot} from "react-dom/client"
import {Provider} from "react-redux"

import {initializeClient} from "../../../packages/shared/src/clientBootstrap"

import {App} from "./App"
import "./index.css"
import {AdminAuthProvider} from "./lib/AdminAuthProvider"
import {store} from "./store/store"

initializeClient("Gammon Rivals Back Office", "gammon-rivals-admin")

createRoot(document.getElementById("root")!).render(<StrictMode>
  <Provider store={store}>
    <AdminAuthProvider>
      <App/>
    </AdminAuthProvider>
  </Provider>
</StrictMode>)
