import * as Sentry from '@sentry/react';

const RELOAD_FLAG = '__gr_chunk_reloaded__';

function isStaleChunkError(reason: unknown): boolean {
  if (!reason) return false;
  const name = (reason as { name?: string }).name;
  if (name === 'ChunkLoadError') return true;
  const message = String((reason as { message?: unknown }).message ?? reason);
  return (
    message.includes('is not a valid JavaScript MIME type') ||
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed')
  );
}

function maybeReloadForStaleChunk(reason: unknown): void {
  if (!isStaleChunkError(reason) || sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
}

export function initializeClient(displayName: string, releaseName: string): void {
  Sentry.init({
    dsn: 'https://0c5bff118503a96dd9dc942802f36821@o4511552133070848.ingest.us.sentry.io/4511552135036928',
    release: `${releaseName}@${__APP_BUILD_COMMIT__}`,
    environment: import.meta.env.PROD ? 'production' : 'development',
    enabled: import.meta.env.PROD,
    ignoreErrors: [
      'ChunkLoadError',
      'is not a valid JavaScript MIME type',
      'Failed to fetch dynamically imported module',
      'error loading dynamically imported module',
      'Importing a module script failed',
    ],
  });

  const build = { commit: __APP_BUILD_COMMIT__, time: __APP_BUILD_TIME__ };
  (window as unknown as { __BUILD__: typeof build }).__BUILD__ = build;
  console.info(
    `%c${displayName}%c build ${build.commit} · ${build.time}`,
    'font-weight:bold;color:#fcd34d',
    'color:inherit'
  );

  window.addEventListener('unhandledrejection', (event) => {
    maybeReloadForStaleChunk(event.reason);
  });
  window.addEventListener('error', (event) => {
    maybeReloadForStaleChunk(event.error ?? event.message);
  });
  window.addEventListener('load', () => {
    sessionStorage.removeItem(RELOAD_FLAG);
  });
}
