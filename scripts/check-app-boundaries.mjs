import fs from 'node:fs';
import path from 'node:path';

const roots = [
  'apps/game/src',
  'apps/admin/src',
  'packages/shared/src',
  'packages/engine/src',
  'packages/ai/src',
  'packages/sim/src',
  'packages/board-renderer/src',
  'packages/board-preview/src',
];
// Packages that must stay dependency-free. `allowed` lists the only local roots
// they may reach into; the test runner is the sole permitted bare specifier.
const PURE_PACKAGE_EXTERNALS = new Set(['vitest']);
const PURE_PACKAGES = [
  { root: 'packages/ai/src/', label: 'ai', allowed: ['packages/ai/src/', 'packages/engine/'] },
  {
    root: 'packages/sim/src/',
    label: 'sim',
    allowed: ['packages/sim/src/', 'packages/ai/', 'packages/engine/'],
  },
];

const sourceFiles = roots.flatMap(walk);
const violations = [];

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map(
    (match) => match[1]
  );
  const hasBarrelExport = /(?:^|\n)\s*export\s+(?:\*\s+from|(?:type\s+)?\{[^}]*\}\s+from)\s*['"]/m.test(source);

  if (/^index\.tsx?$/.test(path.basename(file))) {
    violations.push(`${file}: client index modules are forbidden`);
  }
  if (hasBarrelExport) {
    violations.push(`${file}: client barrel re-exports are forbidden`);
  }
  if (file.startsWith('apps/game/src/') && /VITE_ADMIN_APP_URL|apps\/admin/.test(source)) {
    violations.push(`${file}: game source references the admin app`);
  }
  if (file.startsWith('apps/admin/src/') && /VITE_GAME_APP_URL|apps\/game/.test(source)) {
    violations.push(`${file}: admin source references the game app`);
  }

  for (const specifier of imports) {
    const resolved = resolveLocalImport(file, specifier);
    if (file.startsWith('apps/game/src/') && pointsTo(specifier, resolved, 'apps/admin')) {
      violations.push(`${file}: game source imports the admin app (${specifier})`);
    }
    if (file.startsWith('apps/admin/src/') && pointsTo(specifier, resolved, 'apps/game')) {
      violations.push(`${file}: admin source imports the game app (${specifier})`);
    }
    if (
      file.startsWith('apps/admin/src/') &&
      (resolved?.startsWith('packages/engine/') ||
        resolved?.startsWith('packages/board-renderer/'))
    ) {
      violations.push(`${file}: admin UI must use board-preview instead of ${specifier}`);
    }
    if (file.startsWith('packages/') && resolved?.startsWith('apps/')) {
      violations.push(`${file}: package imports application code (${specifier})`);
    }
    if (
      file.startsWith('packages/shared/src/') &&
      resolved !== null &&
      !resolved.startsWith('packages/shared/src/')
    ) {
      violations.push(`${file}: shared code imports outside its package (${specifier})`);
    }
    if (
      file.startsWith('packages/engine/src/') &&
      resolved !== null &&
      !resolved.startsWith('packages/engine/src/')
    ) {
      violations.push(`${file}: engine imports outside its package (${specifier})`);
    }
    // The AI and the sim are dependency-free by contract, and that contract has
    // teeth: build-shared-ai.mjs copies packages/ai/src verbatim into a Deno edge
    // function, so a stray npm import would land server-side and fail at runtime
    // with no local build error. Bare specifiers are therefore rejected too — a
    // check on relative paths alone would miss `import x from 'lodash'`.
    for (const pure of PURE_PACKAGES) {
      if (!file.startsWith(pure.root)) continue;
      if (isExternal(specifier)) {
        if (!PURE_PACKAGE_EXTERNALS.has(specifier)) {
          violations.push(
            `${file}: ${pure.label} imports an external dependency (${specifier}) — must stay dependency-free`
          );
        }
      } else if (resolved === null || !pure.allowed.some((root) => resolved.startsWith(root))) {
        violations.push(`${file}: ${pure.label} imports an unapproved boundary (${specifier})`);
      }
    }
    if (
      file.startsWith('packages/board-renderer/src/') &&
      resolved?.startsWith('packages/board-preview/')
    ) {
      violations.push(`${file}: renderer imports board-preview (${specifier})`);
    }
    if (
      file.startsWith('packages/board-preview/src/') &&
      !isExternal(specifier) &&
      !['packages/board-preview/', 'packages/shared/', 'packages/engine/', 'packages/board-renderer/']
        .some((root) => resolved?.startsWith(root))
    ) {
      violations.push(`${file}: board-preview imports an unapproved boundary (${specifier})`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Application boundaries OK');
}

function isExternal(specifier) {
  return !specifier.startsWith('.');
}

function pointsTo(specifier, resolved, root) {
  return specifier.includes(root) || resolved?.startsWith(`${root}/`);
}

function resolveLocalImport(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  return path.normalize(path.join(path.dirname(file), specifier));
}

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return walk(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}
