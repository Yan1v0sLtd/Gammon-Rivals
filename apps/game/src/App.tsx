import {lazy, Suspense, useEffect} from "react"

import {BrowserRouter, Navigate, Route, Routes, useNavigate} from "react-router-dom"

import {AuthGate} from "./components/AuthGate"
import {LoadingScreen} from "./components/LoadingScreen"
import {RouteErrorBoundary} from "./components/RouteErrorBoundary"
import {ShopHost} from "./components/ShopHost"
import {useShop} from "./features/appUi/useShop"
import {refreshLoadingScreenImage} from "./lib/loadingScreenImage"
import {Home} from "./pages/Home"

// Code-split everything except Home (the landing page) so the initial JS
// payload stays small. Each route is fetched on first navigation.
const HotSeat = lazy(() => import("./pages/HotSeat").then((m) => ({default: m.HotSeat})))
const Profile = lazy(() => import("./pages/Profile").then((m) => ({default: m.Profile})))
const Replay = lazy(() => import("./pages/Replay").then((m) => ({default: m.Replay})))
const PlayOnline = lazy(() => import("./pages/PlayOnline").then((m) => ({default: m.PlayOnline})))
const AuthCallback = lazy(() => import("./pages/AuthCallback").then((m) => ({default: m.AuthCallback})))
const DeleteAccount = lazy(() => import("./pages/DeleteAccount").then((m) => ({default: m.DeleteAccount})))

/**
 * The shop is no longer a full-screen page — it's an app-wide scale-in
 * popup (see ShopHost). The /shop URL is kept as a deep link: it
 * pops the shop open and bounces to the lobby so the popup floats over
 * the game like every other entry point.
 */
function ShopRoute() {
  const {openShop} = useShop()
  const navigate = useNavigate()
  useEffect(() => {
    // Open the popup, then bounce to the lobby so it floats over the game.
    // Imperative redirect (not <Navigate>) so openShop fires reliably
    // before this route unmounts — the popup state lives in the appUi
    // slice, which sits above the router and survives the redirect.
    openShop()
    navigate("/play", {replace: true})
  }, [openShop, navigate])
  return null
}

function RouteFallback() {
  return <LoadingScreen/>
}

export function App() {
  // Sync the BO-managed loading-screen art into the localStorage cache
  // (fire-and-forget; the CURRENT loading screen already painted from the
  // cache/bundled default — this warms the art for the next one).
  useEffect(() => {
    refreshLoadingScreenImage()
  }, [])

  return (
    <BrowserRouter>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback/>}>
          <Routes>
            {/* On the web, `/` is the marketing landing page
                (public/landing.html, served via the vercel.json rewrite)
                and never reaches this router. Inside the Capacitor bundle
                there is NO rewrite: the WebView boots at `/`, so without
                this redirect the router matches no route and renders a
                black screen. Send the native app straight to the lobby. */}
            <Route
              element={<Navigate
                replace
                to="/play"/>}
              path="/"/>
            {/* The game / lobby lives at `/play`. */}
            <Route
              element={<AuthGate><Home/></AuthGate>}
              path="/play"/>
            <Route
              element={<AuthCallback/>}
              path="/auth/callback"/>
            {/* Public + ungated: the in-app deletion target AND the
                account-deletion URL required by Google Play (must be reachable
                without signing in). */}
            <Route
              element={<DeleteAccount/>}
              path="/delete-account"/>
            <Route
              element={<AuthGate><HotSeat/></AuthGate>}
              path="/hotseat"/>
            <Route
              element={<AuthGate><Profile/></AuthGate>}
              path="/profile"/>
            <Route
              element={<AuthGate><Replay/></AuthGate>}
              path="/replay/:gameId"/>
            <Route
              element={<AuthGate><PlayOnline/></AuthGate>}
              path="/play/:matchId"/>
            <Route
              element={<AuthGate><ShopRoute/></AuthGate>}
              path="/shop"/>
            {/* Any unmatched path (e.g. a stale native deep link, or a
                future bundle boot path) bounces to the lobby instead of a
                blank screen. Defined routes above still win over this. */}
            <Route
              element={<Navigate
                replace
                to="/play"/>}
              path="*"/>
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
      {/* Shop popup host — a sibling of, not inside, RouteErrorBoundary,
            so it keeps today's tree semantics: the modal floats above every
            route and outlives route transitions. */}
      <ShopHost/>
    </BrowserRouter>)
}
