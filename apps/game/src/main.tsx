import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './lib/auth';
import { initializeClient } from '../../../packages/shared/src/clientBootstrap';
import { NavigationOverlayProvider } from './lib/navigationOverlay';
import { installNativeAuthHandler } from './lib/nativeAuth';
import { store } from './store/store';

initializeClient('Gammon Rivals', 'gammon-rivals');

// Native auth can arrive before React mounts, so register its listener first.
void installNativeAuthHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <AuthProvider>
        <NavigationOverlayProvider>
          <App />
        </NavigationOverlayProvider>
      </AuthProvider>
    </Provider>
  </StrictMode>
);
