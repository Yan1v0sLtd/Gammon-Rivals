import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { buildDefines, projectRoot, vendorChunkGroups } from './vite.shared.ts';

export default defineConfig({
  root: path.join(projectRoot, 'apps/admin'),
  // Load env from the project root so the admin app sees the same
  // VITE_* vars as the game (apps/admin/.env would otherwise be the
  // lookup dir, and it doesn't exist).
  envDir: projectRoot,
  publicDir: path.join(projectRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.join(projectRoot, 'packages/shared/src'),
      '@board-preview': path.join(projectRoot, 'packages/board-preview/src'),
      '@board': path.join(projectRoot, 'src/board'),
      '@engine': path.join(projectRoot, 'src/engine'),
    },
  },
  define: buildDefines(),
  server: { port: 5175, host: '127.0.0.1' },
  optimizeDeps: {
    include: ['pixi.js'],
  },
  build: {
    outDir: path.join(projectRoot, 'dist-admin'),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: vendorChunkGroups(),
        },
      },
    },
  },
});
