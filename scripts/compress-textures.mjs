import sharp from 'sharp';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const dir = 'packages/brand-assets/public/themes/wood';
const TARGET_SIZE = 512;
const QUALITY = 82;

const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
for (const file of files) {
  const inPath = join(dir, file);
  const outPath = join(dir, file.replace('.png', '.jpg'));
  const beforeBytes = statSync(inPath).size;

  await sharp(inPath)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover' })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(outPath);

  const afterBytes = statSync(outPath).size;
  console.log(
    `${file}: ${(beforeBytes / 1024).toFixed(0)}KB → ${file.replace('.png', '.jpg')}: ${(
      afterBytes / 1024
    ).toFixed(0)}KB`
  );
}
