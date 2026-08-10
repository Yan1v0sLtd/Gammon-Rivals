import createConfig from '@miskamyasa/eslint-config'

// Opinionated ESLint config for React + TypeScript projects.
// Repo-specific bits:
//  - android/ is generated Capacitor output (its assets contain built JS)
//  - reports/ are work logs, not shipped code
//  - allowDefaultProject: files outside the app/package tsconfigs still get
//    linted; supabase/** is a mirror of packages/engine + packages/ai via
//    build-shared-* scripts
export default createConfig(
  {
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      'dist',
      'android',
      'tmp',
      'reports',
      'scripts/**',
      'tools/**',
      'eslint.config.js',
      'capacitor.config.ts',
      'vitest.config.ts',
      '**/vite.config.*',
      '**/astro.config.mjs',
      '**/.astro',
      '**/public/sw.js',
      'supabase/functions/**',
    ],
  },
  {
    name: 'backgammon/parser',
    files: ['**/*.{ts,tsx,mts,cts,mjs,cjs,js}'],
    languageOptions: {
      parserOptions: {
        allowDefaultProject: [
          'supabase/**',
        ],
      },
    },
  },
  {
    name: 'backgammon/user-overrides',
    rules: {
      // The general indent rule remains authoritative because these rules conflict on existing JSX formatting.
      '@stylistic/jsx-indent-props': 'off',
      '@stylistic/max-len': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      'no-use-before-define': 'off',
      '@eslint-react/purity': "off",
    },
  },
)
