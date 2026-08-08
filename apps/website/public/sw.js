/*
 * Self-destructing service worker — DO NOT REMOVE.
 *
 * A previous deploy (an old PWA / Workbox experiment) registered a
 * precaching service worker at /sw.js. The current app ships NO
 * service-worker code, but browsers that registered the old one keep
 * serving a stale, precached bundle — surviving even hard refreshes,
 * because the worker intercepts every request and answers from Cache
 * Storage. (Classic "zombie service worker".)
 *
 * This file replaces that worker with one whose only job is to delete
 * itself: on activation it purges every Cache Storage entry, unregisters
 * itself, then reloads open tabs so they fetch the live build from the
 * network. Affected browsers recover automatically on their next visit —
 * the browser re-fetches /sw.js, sees it changed, installs this, and it
 * self-destructs.
 *
 * Keep this file in place permanently. If /sw.js ever 404s (or the SPA
 * rewrite turns it into index.html), the orphaned worker's update check
 * fails and any browser that hasn't yet recovered stays stranded.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (err) {
        // best-effort purge; continue regardless
      }
      try {
        await self.registration.unregister();
      } catch (err) {
        // ignore
      }
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.navigate(client.url);
        }
      } catch (err) {
        // some clients may refuse navigation; ignore
      }
    })()
  );
});
