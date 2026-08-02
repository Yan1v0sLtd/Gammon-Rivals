import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';
import './index.css';
import App from './App.tsx';
import {initializeClient} from '../../../packages/shared/src/clientBootstrap';
import {NavigationLoaderOverlay} from './components/NavigationLoaderOverlay';
import {installNativeAuthHandler} from './lib/nativeAuth';
import {store} from './store/store';
import {authInitializationRequested} from './features/auth/authActions';

initializeClient('Gammon Rivals', 'gammon-rivals');

// Native auth can arrive before React mounts, so register its listener first.
void installNativeAuthHandler();
store.dispatch(authInitializationRequested());

createRoot(document.getElementById('root')!).render(<StrictMode>
  <Provider store={store}>
    <App/>
    <NavigationLoaderOverlay/>
  </Provider>
</StrictMode>);
