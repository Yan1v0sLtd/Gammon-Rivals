import baseConfig from './tailwind.config.js';

export default {
  ...baseConfig,
  content: [
    './apps/admin/index.html',
    './apps/admin/src/**/*.{ts,tsx}',
    './packages/board-preview/src/**/*.{ts,tsx}',
    './packages/board-renderer/src/**/*.{ts,tsx}',
  ],
};
