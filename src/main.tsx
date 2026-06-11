import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './lib/auth';
import { AdminAuthProvider } from './lib/adminAuth';
import { NavigationOverlayProvider } from './lib/navigationOverlay';
import { installNativeAuthHandler } from './lib/nativeAuth';

// Build stamp — log the deployed commit + build time and expose them on
// window.__BUILD__ so "am I on the latest deploy?" is answerable in one glance
// (values injected by vite.config.ts; 'dev' for local builds).
const BUILD_INFO = { commit: __APP_BUILD_COMMIT__, time: __APP_BUILD_TIME__ };
(window as unknown as { __BUILD__: typeof BUILD_INFO }).__BUILD__ = BUILD_INFO;
console.info(
  `%cGammon Rivals%c build ${BUILD_INFO.commit} · ${BUILD_INFO.time}`,
  'font-weight:bold;color:#fcd34d',
  'color:inherit'
);

// -----------------------------------------------------------------------------
// Stale chunk auto-reload
// -----------------------------------------------------------------------------
// Classic SPA gotcha on Vercel: after a fresh deploy, browsers with
// the old `index.html` cached try to dynamic-import() a code-split
// chunk whose hash no longer exists. Vercel's SPA rewrite returns
// the new index.html for the missing JS URL, the browser sees HTML
// where JS was expected, and the import rejects with:
//   TypeError: 'text/html' is not a valid JavaScript MIME type.
//
// This handler catches that exact failure (plus the standard
// ChunkLoadError) and silently reloads so the player picks up the
// new bundle. A sessionStorage flag dedupes so we never loop if the
// failure turns out to be structural.

const RELOAD_FLAG = '__gr_chunk_reloaded__';

function isStaleChunkError(reason: unknown): boolean {
  if (!reason) return false;
  const name = (reason as { name?: string }).name;
  if (name === 'ChunkLoadError') return true;
  const message = String((reason as { message?: unknown }).message ?? reason);
  return (
    message.includes("is not a valid JavaScript MIME type") ||
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed')
  );
}

function maybeReloadForStaleChunk(reason: unknown): void {
  if (!isStaleChunkError(reason)) return;
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
}

// React.lazy + dynamic import() failures hit unhandledrejection.
window.addEventListener('unhandledrejection', (event) => {
  maybeReloadForStaleChunk(event.reason);
});

// <script type="module"> failures hit window.onerror.
window.addEventListener('error', (event) => {
  maybeReloadForStaleChunk(event.error ?? event.message);
});

// Successful render → clear the dedupe flag so a *later* deploy can
// trigger another reload if the user keeps the tab open.
window.addEventListener('load', () => {
  sessionStorage.removeItem(RELOAD_FLAG);
});

// Wire the Capacitor `appUrlOpen` listener BEFORE React mounts so a
// deep-link auth callback (gammonrivals://auth/callback#…) that
// arrives milliseconds after process start still has a registered
// handler. On web this is a no-op — the function exits early when
// `Capacitor.isNativePlatform()` returns false. Fire-and-forget;
// the listener is async-installed but doesn't need to block render.
void installNativeAuthHandler();

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
