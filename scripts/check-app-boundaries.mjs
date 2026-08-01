import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'apps/admin/src', 'packages/shared/src', 'packages/board-preview/src'];
const sourceFiles = roots.flatMap(walk);
const violations = [];

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map(
    (match) => match[1]
  );

  for (const specifier of imports) {
    const resolved = resolveLocalImport(file, specifier);
    if (
      file.startsWith('src/') &&
      (specifier.includes('apps/admin') || resolved?.startsWith('apps/admin/'))
    ) {
      violations.push(`${file}: game source imports the admin app (${specifier})`);
    }
    if (
      file.startsWith('apps/admin/src/') &&
      (specifier.startsWith('@board/') ||
        specifier.startsWith('@engine/') ||
        resolved?.startsWith('src/'))
    ) {
      violations.push(`${file}: admin must use shared packages instead of ${specifier}`);
    }
    if (
      file.startsWith('packages/shared/src/') &&
      (specifier.startsWith('@board') ||
        specifier.startsWith('@engine') ||
        (resolved !== null && !resolved.startsWith('packages/shared/src/')))
    ) {
      violations.push(`${file}: shared code imports code outside its package (${specifier})`);
    }
    if (
      file.startsWith('packages/board-preview/src/') &&
      (specifier.includes('apps/admin') ||
        specifier.includes('/lobby/') ||
        specifier.includes('/game/') ||
        resolved?.startsWith('apps/'))
    ) {
      violations.push(`${file}: board preview imports app code (${specifier})`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Application boundaries OK');
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
