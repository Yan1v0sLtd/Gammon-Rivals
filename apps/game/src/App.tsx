import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import AuthGate from './components/AuthGate';
import { LoadingScreen } from './components/LoadingScreen';
import { refreshLoadingScreenImage } from './lib/loadingScreenImage';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { ShopHost } from './components/ShopHost';
import { useShop } from './features/appUi/useShop';
import Home from './pages/Home';

// Code-split everything except Home (the landing page) so the initial JS
// payload stays small. Each route is fetched on first navigation.
const HotSeat = lazy(() => import('./pages/HotSeat'));
const Profile = lazy(() => import('./pages/Profile'));
const Replay = lazy(() => import('./pages/Replay'));
const PlayOnline = lazy(() => import('./pages/PlayOnline'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const DeleteAccount = lazy(() => import('./pages/DeleteAccount'));

/**
 * The shop is no longer a full-screen page — it's an app-wide scale-in
 * popup (see ShopHost). The /shop URL is kept as a deep link: it
 * pops the shop open and bounces to the lobby so the popup floats over
 * the game like every other entry point.
 */
function ShopRoute() {
  const { openShop } = useShop();
  const navigate = useNavigate();
  useEffect(() => {
    // Open the popup, then bounce to the lobby so it floats over the game.
    // Imperative redirect (not <Navigate>) so openShop fires reliably
    // before this route unmounts — the popup state lives in the appUi
    // slice, which sits above the router and survives the redirect.
    openShop();
    navigate('/play', { replace: true });
  }, [openShop, navigate]);
  return null;
}

function RouteFallback() {
  return <LoadingScreen />;
}

export default function App() {
  // Sync the BO-managed loading-screen art into the localStorage cache
  // (fire-and-forget; the CURRENT loading screen already painted from the
  // cache/bundled default — this warms the art for the next one).
  useEffect(() => {
    refreshLoadingScreenImage();
  }, []);

  return (
    <BrowserRouter>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* On the web, `/` is the marketing landing page
                (public/landing.html, served via the vercel.json rewrite)
                and never reaches this router. Inside the Capacitor bundle
                there is NO rewrite: the WebView boots at `/`, so without
                this redirect the router matches no route and renders a
                black screen. Send the native app straight to the lobby. */}
            <Route path="/" element={<Navigate to="/play" replace />} />
            {/* The game / lobby lives at `/play`. */}
            <Route path="/play" element={<AuthGate><Home /></AuthGate>} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            {/* Public + ungated: the in-app deletion target AND the
                account-deletion URL required by Google Play (must be reachable
                without signing in). */}
            <Route path="/delete-account" element={<DeleteAccount />} />
            <Route path="/hotseat" element={<AuthGate><HotSeat /></AuthGate>} />
            <Route path="/profile" element={<AuthGate><Profile /></AuthGate>} />
            <Route path="/replay/:gameId" element={<AuthGate><Replay /></AuthGate>} />
            <Route path="/play/:matchId" element={<AuthGate><PlayOnline /></AuthGate>} />
            <Route path="/shop" element={<AuthGate><ShopRoute /></AuthGate>} />
            {/* Any unmatched path (e.g. a stale native deep link, or a
                future bundle boot path) bounces to the lobby instead of a
                blank screen. Defined routes above still win over this. */}
            <Route path="*" element={<Navigate to="/play" replace />} />
          </Routes>
          </Suspense>
        </RouteErrorBoundary>
        {/* Shop popup host — a sibling of, not inside, RouteErrorBoundary,
            so it keeps today's tree semantics: the modal floats above every
            route and outlives route transitions. */}
        <ShopHost />
    </BrowserRouter>
  );
}
