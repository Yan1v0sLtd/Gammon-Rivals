import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { buildDefines, projectRoot, vendorChunkGroups } from '../../config/vite.shared.ts';

export default defineConfig({
  root: path.join(projectRoot, 'apps/game'),
  envDir: projectRoot,
  publicDir: path.join(projectRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.join(projectRoot, 'packages/shared/src'),
      '@engine': path.join(projectRoot, 'packages/engine/src'),
      '@board-renderer': path.join(projectRoot, 'packages/board-renderer/src'),
    },
  },
  define: buildDefines(),
  server: { port: 5174, host: '127.0.0.1' },
  optimizeDeps: {
    include: ['cannon-es', 'three'],
  },
  build: {
    outDir: path.join(projectRoot, 'dist'),
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
