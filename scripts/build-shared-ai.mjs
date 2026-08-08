// Generate a Deno-native mirror of packages/ai/src for Supabase edge
// functions — server-authored AI turns (Phase 2b, layer 2). Sibling of the
// engine mirror (build-shared-engine.mjs). packages/ai/src stays the source of
// truth; never edit generated files — re-run `pnpm run build:shared-ai` after
// any picker change. The generated tree is committed so the edge deploy can
// bundle it.
//
// Two differences from the engine mirror:
//   1. The browser-only Web Worker layer (client.ts / worker.ts) is EXCLUDED —
//      it uses `new Worker()` and can't run in Deno. The pure decision logic
//      (picker / evaluator / sequence / strength / types) is what we mirror.
//   2. The AI imports the engine source through a repository-relative path.
//      Deno needs the sibling mirror's explicit `../engine/index.ts` path.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages', 'ai', 'src');
const OUT = join(ROOT, 'supabase', 'functions', '_shared', 'ai');

// Browser/Worker-only — not portable to Deno.
const EXCLUDE = new Set(['client.ts', 'worker.ts']);

const BANNER = [
  '// GENERATED FILE — DO NOT EDIT.',
  '// Deno mirror of packages/ai/src for Supabase edge functions',
  '// (server-authored AI turns). packages/ai/src is the source of truth;',
  '// regenerate with:  pnpm run build:shared-ai',
  '',
  '',
].join('\n');

/**
 * Rewrite repository-relative engine imports to the server-only Deno barrel.
 * Depth-agnostic on purpose: the AI source has already moved once (from
 * apps/game/src/ai to packages/ai/src, changing `../../../../packages/engine/src`
 * to `../../engine/src`). A depth-hardcoded pattern silently stops matching on
 * such a move and emits a mirror with an unresolvable import, breaking
 * server-side AI with no build error — so match any number of `../` segments.
 */
function fixEngineImport(code) {
  return code.replace(
    /(['"])(?:\.\.\/)+(?:packages\/)?engine\/src(?:\/(?:index|types|board|dice|rules|match))?(['"])/g,
    '$1../engine/index.ts$2'
  );
}

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
      !d.name.endsWith('.test.ts') &&
      !EXCLUDE.has(d.name)
  )
  .map((d) => d.name);

for (const name of files) {
  const code = readFileSync(join(SRC, name), 'utf8');
  writeFileSync(join(OUT, name), BANNER + addTsExtensions(fixEngineImport(code)));
}

const serverExports = ['types.ts', 'sequence.ts', 'evaluator.ts', 'picker.ts']
  .map((name) => `export * from './${name}';`)
  .join('\n');
writeFileSync(join(OUT, 'index.ts'), BANNER + serverExports + '\n');

console.log(`build-shared-ai: wrote ${files.length + 1} file(s) -> ${OUT}`);
