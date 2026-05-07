import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import HotSeat from './pages/HotSeat';
import Profile from './pages/Profile';
import Replay from './pages/Replay';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/hotseat" element={<HotSeat />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/replay/:gameId" element={<Replay />} />
      </Routes>
    </BrowserRouter>
  );
}
