import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import HotSeat from './pages/HotSeat';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/hotseat" element={<HotSeat />} />
      </Routes>
    </BrowserRouter>
  );
}
