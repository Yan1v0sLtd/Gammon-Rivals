import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './lib/auth';
import { initializeClient } from '../../../packages/shared/src/clientBootstrap';
import { NavigationLoaderOverlay } from './components/NavigationLoaderOverlay';
import { installNativeAuthHandler } from './lib/nativeAuth';
import { store } from './store/store';

initializeClient('Gammon Rivals', 'gammon-rivals');

// Native auth can arrive before React mounts, so register its listener first.
void installNativeAuthHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <AuthProvider>
        {/* The overlay is position:fixed, z-index:9999, so sibling
            placement is visually identical to its old provider wrapper. */}
        <>
          <App />
          <NavigationLoaderOverlay />
        </>
      </AuthProvider>
    </Provider>
  </StrictMode>
);
