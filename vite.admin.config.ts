import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { buildDefines, projectRoot } from './vite.shared.ts';

export default defineConfig({
  root: path.join(projectRoot, 'apps/admin'),
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
  },
});
