// Monte-Carlo economy/AI-ladder simulator runner.
//
// The sim lives in packages/sim/src as TypeScript and imports other TS modules
// with extensionless specifiers (e.g. '../../engine/src/board'), so plain node
// cannot load it directly: node --experimental-strip-types requires explicit
// `.ts` extensions, and we are not rewriting engine imports.
// Vite is already a devDependency, and its SSR module loader resolves
// TypeScript, extensionless specifiers and tsconfig path aliases for free, so
// this script boots a Vite dev server in middlewareMode just long enough to
// load and run packages/sim/src/runSim.ts.
//
//   npm run sim                 → full report, 1000 games per pairing
//   SIM_GAMES=4000 npm run sim  → more games
import { createServer } from 'vite';

// No explicit root: npm scripts run with cwd = repo root, which is where the
// /apps/... module specifier below resolves from.
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
});
try {
  const mod = await server.ssrLoadModule('/packages/sim/src/runSim.ts');
  await mod.main();
} finally {
  await server.close();
}
