import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { buildDefines } from './vite.shared.ts';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(projectRoot, 'apps/admin'),
  publicDir: path.join(projectRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.join(projectRoot, 'src'),
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
