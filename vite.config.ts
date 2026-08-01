import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { buildDefines, projectRoot } from './vite.shared.ts';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.join(projectRoot, 'packages/shared/src'),
    },
  },
  define: buildDefines(),
  server: { port: 5174, host: '127.0.0.1' },
  optimizeDeps: {
    include: ['cannon-es', 'three'],
  },
});
