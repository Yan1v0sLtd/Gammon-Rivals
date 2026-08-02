import fs from 'node:fs';
import path from 'node:path';

const roots = [
  'apps/game/src',
  'apps/admin/src',
  'packages/shared/src',
  'packages/engine/src',
  'packages/board-renderer/src',
  'packages/board-preview/src',
];
const sourceFiles = roots.flatMap(walk);
const violations = [];

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map(
    (match) => match[1]
  );

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
      (specifier.startsWith('@engine') || specifier.startsWith('@board-renderer'))
    ) {
      violations.push(`${file}: admin UI must use board-preview instead of ${specifier}`);
    }
    if (file.startsWith('packages/') && resolved?.startsWith('apps/')) {
      violations.push(`${file}: package imports application code (${specifier})`);
    }
    if (
      file.startsWith('packages/shared/src/') &&
      (specifier.startsWith('@engine') ||
        specifier.startsWith('@board-renderer') ||
        specifier.startsWith('@board-preview') ||
        (resolved !== null && !resolved.startsWith('packages/shared/src/')))
    ) {
      violations.push(`${file}: shared code imports outside its package (${specifier})`);
    }
    if (
      file.startsWith('packages/engine/src/') &&
      (specifier.startsWith('@shared') ||
        specifier.startsWith('@board') ||
        (resolved !== null && !resolved.startsWith('packages/engine/src/')))
    ) {
      violations.push(`${file}: engine imports outside its package (${specifier})`);
    }
    if (
      file.startsWith('packages/board-renderer/src/') &&
      (specifier.startsWith('@board-preview') || resolved?.startsWith('packages/board-preview/'))
    ) {
      violations.push(`${file}: renderer imports board-preview (${specifier})`);
    }
    if (
      file.startsWith('packages/board-preview/src/') &&
      !isExternal(specifier) &&
      !specifier.startsWith('@shared') &&
      !specifier.startsWith('@engine') &&
      !specifier.startsWith('@board-renderer') &&
      !(resolved?.startsWith('packages/board-preview/src/'))
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
  return !specifier.startsWith('.') && !specifier.startsWith('@shared') &&
    !specifier.startsWith('@engine') && !specifier.startsWith('@board');
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
