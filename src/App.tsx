import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';

// Code-split everything except Home (the landing page) so the initial JS
// payload stays small. Each route is fetched on first navigation.
const HotSeat = lazy(() => import('./pages/HotSeat'));
const Profile = lazy(() => import('./pages/Profile'));
const Replay = lazy(() => import('./pages/Replay'));
const PlayOnline = lazy(() => import('./pages/PlayOnline'));
const JoinMatch = lazy(() => import('./pages/JoinMatch'));
const Lobby = lazy(() => import('./pages/Lobby'));

function RouteFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center text-board-felt/50 text-sm">
      Loading…
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/hotseat" element={<HotSeat />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/replay/:gameId" element={<Replay />} />
          <Route path="/play/:matchId" element={<PlayOnline />} />
          <Route path="/join/:code" element={<JoinMatch />} />
          <Route path="/lobby" element={<Lobby />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
