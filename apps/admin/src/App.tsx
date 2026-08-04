import {lazy, Suspense} from "react"

import {BrowserRouter, Navigate, Route, Routes} from "react-router-dom"

const Admin = lazy(() => import("./Admin").then((m) => ({default: m.Admin})))
const AdminAuthCallback = lazy(() => import("./AdminAuthCallback").then((m) => ({default: m.AdminAuthCallback})))

function LoadingFallback() {
  return (<main
    aria-busy="true"
    aria-label="Loading"
    className="fixed inset-0 grid place-items-center bg-[#0a0f1c]"
    role="status">
    <div
      aria-hidden="true"
      className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/60"/>
  </main>)
}

export function App() {
  return (<BrowserRouter>
    <Suspense fallback={<LoadingFallback/>}>
      <Routes>
        <Route
          element={<Admin/>}
          path="/"/>
        <Route
          element={<AdminAuthCallback/>}
          path="/auth/callback"/>
        <Route
          element={<Navigate
            replace
            to="/"/>}
          path="*"/>
      </Routes>
    </Suspense>
  </BrowserRouter>)
}
