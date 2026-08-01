import baseConfig from './tailwind.config.js';

export default {
  ...baseConfig,
  content: [
    './apps/admin/index.html',
    './apps/admin/src/**/*.{ts,tsx}',
    './src/board/**/*.{ts,tsx}',
  ],
};
