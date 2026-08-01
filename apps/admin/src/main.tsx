import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeClient } from '@shared/clientBootstrap';
import { AdminAuthProvider } from './lib/adminAuth';

initializeClient('Gammon Rivals Back Office', 'gammon-rivals-admin');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminAuthProvider>
      <App />
    </AdminAuthProvider>
  </StrictMode>
);
