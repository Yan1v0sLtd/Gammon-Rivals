import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import AuthGate from './components/AuthGate';
import { LoadingScreen } from './components/LoadingScreen';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { ShopProvider, useShop } from './components/ShopProvider';
import Home from './pages/Home';

// Code-split everything except Home (the landing page) so the initial JS
// payload stays small. Each route is fetched on first navigation.
const HotSeat = lazy(() => import('./pages/HotSeat'));
const Profile = lazy(() => import('./pages/Profile'));
const Replay = lazy(() => import('./pages/Replay'));
const PlayOnline = lazy(() => import('./pages/PlayOnline'));
const JoinMatch = lazy(() => import('./pages/JoinMatch'));
const Lobby = lazy(() => import('./pages/Lobby'));
const Admin = lazy(() => import('./pages/Admin'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const AdminAuthCallback = lazy(() => import('./pages/AdminAuthCallback'));

/**
 * The shop is no longer a full-screen page — it's an app-wide scale-in
 * popup (see ShopProvider). The /shop URL is kept as a deep link: it
 * pops the shop open and bounces to the lobby so the popup floats over
 * the game like every other entry point.
 */
function ShopRoute() {
  const { openShop } = useShop();
  const navigate = useNavigate();
  useEffect(() => {
    // Open the popup, then bounce to the lobby so it floats over the game.
    // Imperative redirect (not <Navigate>) so openShop fires reliably
    // before this route unmounts — the popup state lives in ShopProvider,
    // which sits above the router and survives the redirect.
    openShop();
    navigate('/play', { replace: true });
  }, [openShop, navigate]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ShopProvider>
        <RouteErrorBoundary>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              {/* `/` is the marketing landing page (public/landing.html,
                  served via the Vercel rewrite in vercel.json). The
                  game / lobby lives at `/play`. */}
              <Route path="/play" element={<AuthGate><Home /></AuthGate>} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/hotseat" element={<AuthGate><HotSeat /></AuthGate>} />
              <Route path="/profile" element={<AuthGate><Profile /></AuthGate>} />
              <Route path="/replay/:gameId" element={<AuthGate><Replay /></AuthGate>} />
              <Route path="/play/:matchId" element={<AuthGate><PlayOnline /></AuthGate>} />
              <Route path="/join/:code" element={<AuthGate><JoinMatch /></AuthGate>} />
              <Route path="/lobby" element={<AuthGate><Lobby /></AuthGate>} />
              <Route path="/shop" element={<AuthGate><ShopRoute /></AuthGate>} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/auth/callback" element={<AdminAuthCallback />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </ShopProvider>
    </BrowserRouter>
  );
}
