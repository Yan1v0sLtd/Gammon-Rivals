// Injected by the Vite app configs. The deployed git commit (7 chars) and
// build timestamp, so "which build am I running?" is answerable instantly from
// the browser console or window.__BUILD__ — added after a stale-build incident
// where there was no way to tell which version a tab was actually serving.
declare const __APP_BUILD_COMMIT__: string
declare const __APP_BUILD_TIME__: string
