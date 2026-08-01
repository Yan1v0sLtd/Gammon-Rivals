import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './lib/auth';
import { initializeClient } from './lib/clientBootstrap';
import { NavigationOverlayProvider } from './lib/navigationOverlay';
import { installNativeAuthHandler } from './lib/nativeAuth';

initializeClient('Gammon Rivals', 'gammon-rivals');

// Native auth can arrive before React mounts, so register its listener first.
void installNativeAuthHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <NavigationOverlayProvider>
        <App />
      </NavigationOverlayProvider>
    </AuthProvider>
  </StrictMode>
);
