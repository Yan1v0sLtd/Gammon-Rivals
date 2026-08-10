import {lazy, Suspense} from "react"

import {BrowserRouter, Route, Routes} from "react-router-dom"

import styles from "./App.module.css"
import {AdminAuthGate} from "./features/AdminAccess/AdminAuthGate"

const Admin = lazy(() => import("./Admin").then((m) => ({default: m.Admin})))
const AdminAuthCallback = lazy(() => import("./AdminAuthCallback").then((m) => ({default: m.AdminAuthCallback})))

function LoadingFallback() {
  return (<div
    aria-busy="true"
    aria-label="Loading"
    className={styles.loadingOverlay}
    role="status">
    <div
      aria-hidden="true"
      className={styles.spinner}/>
  </div>)
}

export function App() {
  return (<BrowserRouter basename="/admin">
    <Suspense fallback={<LoadingFallback/>}>
      <Routes>
        <Route
          element={<AdminAuthGate><Admin/></AdminAuthGate>}
          path="/*"/>
        <Route
          element={<AdminAuthCallback/>}
          path="/auth/callback"/>
      </Routes>
    </Suspense>
  </BrowserRouter>)
}
