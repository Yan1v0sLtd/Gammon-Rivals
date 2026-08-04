import {StrictMode} from "react"

import {createRoot} from "react-dom/client"

import {initializeClient} from "../../../packages/shared/src/clientBootstrap"

import {App} from "./App"
import "./index.css"
import {AdminAuthProvider} from "./lib/AdminAuthProvider"

initializeClient("Gammon Rivals Back Office", "gammon-rivals-admin")

createRoot(document.getElementById("root")!).render(<StrictMode>
  <AdminAuthProvider>
    <App/>
  </AdminAuthProvider>
</StrictMode>)
