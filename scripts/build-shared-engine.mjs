// Generate a Deno-native mirror of packages/engine for Supabase edge functions
// (server-side move/outcome validation — Phase 2b, layer 1).
//
// The browser app (Vite) imports packages/engine with extensionless
// specifiers; Deno (the edge runtime) requires explicit `.ts` extensions on
// relative imports. Rather than hand-maintain a second copy, this script
// copies the pure engine and rewrites its relative import/export specifiers.
//
// packages/engine stays the SINGLE SOURCE OF TRUTH. Never edit generated files;
// re-run `npm run build:shared-engine` after any engine change. The generated
// tree is committed so the edge-function deploy can bundle it.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages', 'engine', 'src');
const OUT = join(ROOT, 'supabase', 'functions', '_shared', 'engine');

const BANNER = [
  '// GENERATED FILE — DO NOT EDIT.',
  '// Deno mirror of packages/engine for Supabase edge functions (server-side',
  '// move/outcome validation). packages/engine is the single source of truth;',
  '// regenerate with:  npm run build:shared-engine',
  '',
  '',
].join('\n');

/** Add a `.ts` extension to relative specifiers that don't already have one. */
function addTsExtensions(code) {
  return code.replace(
    /(\bfrom\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (match, pre, spec, post) =>
      /\.[cm]?[jt]sx?$/i.test(spec) ? match : `${pre}${spec}.ts${post}`
  );
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC, { withFileTypes: true })
  .filter(
    (d) =>
      d.isFile() &&
      d.name.endsWith('.ts') &&
      d.name !== 'index.ts' &&
      !d.name.endsWith('.test.ts')
  )
  .map((d) => d.name);

for (const name of files) {
  const code = readFileSync(join(SRC, name), 'utf8');
  writeFileSync(join(OUT, name), BANNER + addTsExtensions(code));
}

const serverExports = ['types.ts', 'board.ts', 'dice.ts', 'rules.ts', 'match.ts']
  .map((name) => `export * from './${name}';`)
  .join('\n');
writeFileSync(join(OUT, 'index.ts'), BANNER + serverExports + '\n');

console.log(`build-shared-engine: wrote ${files.length + 1} file(s) -> ${OUT}`);
