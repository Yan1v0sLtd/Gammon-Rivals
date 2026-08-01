import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export function vendorChunkGroups() {
  return [
    {
      name: 'vendor-pixi-rendering',
      test: /node_modules[\\/]pixi\.js[\\/]lib[\\/]rendering[\\/]/,
    },
    {
      name: 'vendor-pixi-scene',
      test: /node_modules[\\/]pixi\.js[\\/]lib[\\/]scene[\\/]/,
    },
    {
      name: 'vendor-pixi-core',
      test: /node_modules[\\/](?:pixi\.js|earcut)[\\/]/,
    },
    {
      name: 'vendor-react',
      test: /node_modules[\\/](?:react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
    },
    {
      name: 'vendor-supabase',
      test: /node_modules[\\/]@supabase[\\/]/,
    },
    {
      name: 'vendor-billing',
      test: /node_modules[\\/](?:cordova-plugin-purchase|capacitor-plugin-cdv-purchase)[\\/]/,
    },
    {
      name: 'vendor-sentry',
      test: /node_modules[\\/]@sentry(?:-internal)?[\\/]/,
    },
    {
      name: 'vendor-capacitor',
      test: /node_modules[\\/](?:@capacitor|@capgo)[\\/]/,
    },
  ];
}

export function buildDefines(): Record<string, string> {
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);
  return {
    __APP_BUILD_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  };
}
