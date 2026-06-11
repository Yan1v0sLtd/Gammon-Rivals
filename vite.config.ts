import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build stamp injected into the client so the deployed build is identifiable at
// a glance (console banner + window.__BUILD__). Vercel sets
// VERCEL_GIT_COMMIT_SHA at build time; falls back to 'dev' for local builds.
const buildCommit = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);
const buildTime = new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_COMMIT__: JSON.stringify(buildCommit),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: { port: 5174, host: '127.0.0.1' },
  optimizeDeps: {
    include: ['cannon-es', 'three'],
  },
});
