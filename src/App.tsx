import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import HotSeat from './pages/HotSeat';
import Profile from './pages/Profile';
import Replay from './pages/Replay';
import PlayOnline from './pages/PlayOnline';
import JoinMatch from './pages/JoinMatch';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/hotseat" element={<HotSeat />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/replay/:gameId" element={<Replay />} />
        <Route path="/play/:matchId" element={<PlayOnline />} />
        <Route path="/join/:code" element={<JoinMatch />} />
      </Routes>
    </BrowserRouter>
  );
}
