// Generate a Deno-native mirror of src/ai (the move picker) for Supabase edge
// functions — server-authored AI turns (Phase 2b, layer 2). Sibling of the
// engine mirror (build-shared-engine.mjs). src/ai stays the SINGLE SOURCE OF
// TRUTH; never edit the generated files — re-run `npm run build:shared-ai` after
// any picker change. The generated tree is committed so the edge deploy can
// bundle it.
//
// Two differences from the engine mirror:
//   1. The browser-only Web Worker layer (client.ts / worker.ts) is EXCLUDED —
//      it uses `new Worker()` and can't run in Deno. The pure decision logic
//      (picker / evaluator / sequence / strength / types) is what we mirror.
//   2. src/ai imports the engine as a directory specifier (`from '../engine'`).
//      Deno needs an explicit file, and the engine mirror is a sibling package,
//      so rewrite `../engine` → `../engine/index.ts` before adding extensions.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'ai');
const OUT = join(ROOT, 'supabase', 'functions', '_shared', 'ai');

// Browser/Worker-only — not portable to Deno.
const EXCLUDE = new Set(['client.ts', 'worker.ts']);

const BANNER = [
  '// GENERATED FILE — DO NOT EDIT.',
  '// Deno mirror of src/ai (move picker) for Supabase edge functions',
  '// (server-authored AI turns). src/ai is the single source of truth;',
  '// regenerate with:  npm run build:shared-ai',
  '',
  '',
].join('\n');

/** Rewrite the `../engine` directory import to the sibling mirror's barrel. */
function fixEngineImport(code) {
  return code.replace(/(['"])\.\.\/engine(['"])/g, '$1../engine/index.ts$2');
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
      !d.name.endsWith('.test.ts') &&
      !EXCLUDE.has(d.name)
  )
  .map((d) => d.name);

for (const name of files) {
  const code = readFileSync(join(SRC, name), 'utf8');
  writeFileSync(join(OUT, name), BANNER + addTsExtensions(fixEngineImport(code)));
}

console.log(`build-shared-ai: wrote ${files.length} file(s) -> ${OUT}`);
