import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { projectRoot } from './config/vite.shared.ts';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.join(projectRoot, 'packages/shared/src'),
      '@engine': path.join(projectRoot, 'packages/engine/src'),
      '@board-renderer': path.join(projectRoot, 'packages/board-renderer/src'),
      '@board-preview': path.join(projectRoot, 'packages/board-preview/src'),
    },
  },
  test: {
    include: ['apps/**/*.{test,spec}.{ts,tsx}', 'packages/**/*.{test,spec}.{ts,tsx}'],
  },
});
