import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './lib/auth';
import { AdminAuthProvider } from './lib/adminAuth';
import { NavigationOverlayProvider } from './lib/navigationOverlay';

// AdminAuthProvider sits next to AuthProvider but operates on a
// separate Supabase client (adminSupabase) with its own storageKey.
// Both providers initialise on mount but neither does any work outside
// its consumers — the BO context just listens to its own
// onAuthStateChange and stays idle for routes that don't read it.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AdminAuthProvider>
        <NavigationOverlayProvider>
          <App />
        </NavigationOverlayProvider>
      </AdminAuthProvider>
    </AuthProvider>
  </StrictMode>
);
