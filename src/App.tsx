import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AuthGate from './components/AuthGate';
import { LoadingScreen } from './components/LoadingScreen';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
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
const Shop = lazy(() => import('./pages/Shop'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const AdminAuthCallback = lazy(() => import('./pages/AdminAuthCallback'));

export default function App() {
  return (
    <BrowserRouter>
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
            <Route path="/shop" element={<AuthGate><Shop /></AuthGate>} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/auth/callback" element={<AdminAuthCallback />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </BrowserRouter>
  );
}
