#!/usr/bin/env node
/**
 * Render the Gammon Rivals brand SVGs into the PNG masters that
 * `@capacitor/assets generate` expects.
 *
 * Why this script exists:
 *   - SVG is the source of truth (versioned, editable, no asset
 *     bloat in git).
 *   - `@capacitor/assets` only accepts PNG inputs.
 *   - Rather than ship hand-exported PNGs from a design tool, we
 *     render them from SVG at build time using `sharp` (already a
 *     dev dependency).
 *
 * Inputs (committed to the repo):
 *   assets/icon-source.svg       Full icon (background + foreground)
 *   assets/icon-foreground.svg   Foreground layer only, transparent bg
 *   assets/splash-source.svg     Splash screen master
 *
 * Outputs (NOT committed -- listed in .gitignore, regenerable):
 *   assets/icon-only.png         1024 px square, full icon
 *   assets/icon-foreground.png   1024 px square, foreground layer
 *   assets/icon-background.png   1024 px square, solid navy
 *   assets/splash.png            2732 px square, splash master
 *   assets/splash-dark.png       2732 px square, dark variant
 *
 * Usage:
 *   npm run android:assets   -- renders PNGs + runs @capacitor/assets
 */
import sharp from 'sharp';
import { readFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'assets');

/** True if a file exists (icon-art override check). */
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render an SVG file at a given square dimension.
 * sharp reads the SVG, rasterises at native scale, exports PNG.
 */
async function svgToPng({ svgPath, outPath, size, background }) {
  const svg = await readFile(svgPath);
  const pipeline = sharp(svg, { density: 300 }).resize(size, size, {
    fit: 'contain',
    background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (background) {
    pipeline.flatten({ background });
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(outPath);
  console.log(`  wrote ${outPath.replace(ASSETS_DIR, 'assets')} (${size} px)`);
}

async function main() {
  await mkdir(ASSETS_DIR, { recursive: true });

  // Art-based icon override: when assets/icon-art.png exists (a full-bleed
  // 1024px square render of the brand icon artwork), it takes precedence
  // over the SVG sources. Layering for Android adaptive icons:
  //   • icon-background.png = the art, full-bleed. The launcher mask
  //     (circle / squircle / rounded square) crops its edges — the art is
  //     designed to survive that (scene continues to the edges).
  //   • icon-foreground.png = fully transparent. All the visual detail is
  //     in the background layer, so the parallax float effect on some
  //     launchers simply doesn't shift the art (safe default).
  //   • icon-only.png       = the same art, used by legacy launchers as-is.
  const iconArt = join(ASSETS_DIR, 'icon-art.png');
  if (await exists(iconArt)) {
    console.log('Using icon-art.png override (full-art icon)...');
    await sharp(iconArt)
      .resize(1024, 1024, { fit: 'cover' })
      .flatten({ background: { r: 10, g: 14, b: 43 } })
      .png({ compressionLevel: 9 })
      .toFile(join(ASSETS_DIR, 'icon-only.png'));
    console.log('  wrote assets/icon-only.png (1024 px, from art)');

    await sharp(iconArt)
      .resize(1024, 1024, { fit: 'cover' })
      .flatten({ background: { r: 10, g: 14, b: 43 } })
      .png({ compressionLevel: 9 })
      .toFile(join(ASSETS_DIR, 'icon-background.png'));
    console.log('  wrote assets/icon-background.png (1024 px, from art)');

    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png({ compressionLevel: 9 })
      .toFile(join(ASSETS_DIR, 'icon-foreground.png'));
    console.log('  wrote assets/icon-foreground.png (transparent, from art)');
  } else {
    console.log('Rendering icon-only.png (full icon, 1024 px)...');
    await svgToPng({
      svgPath: join(ASSETS_DIR, 'icon-source.svg'),
      outPath: join(ASSETS_DIR, 'icon-only.png'),
      size: 1024,
      // Background bakes into the PNG so it works with non-adaptive
      // legacy launchers too.
      background: { r: 10, g: 14, b: 43, alpha: 1 },
    });

    console.log('Rendering icon-foreground.png (transparent bg, 1024 px)...');
    await svgToPng({
      svgPath: join(ASSETS_DIR, 'icon-foreground.svg'),
      outPath: join(ASSETS_DIR, 'icon-foreground.png'),
      size: 1024,
    });

    console.log('Rendering icon-background.png (solid navy, 1024 px)...');
    // Background layer is just a solid color. No need for an SVG;
    // generate a 1024x1024 flat color image directly.
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 10, g: 14, b: 43, alpha: 1 },
      },
    })
      .png({ compressionLevel: 9 })
      .toFile(join(ASSETS_DIR, 'icon-background.png'));
    console.log('  wrote assets/icon-background.png (1024 px)');
  }

  console.log('Rendering splash.png (2732 px)...');
  await svgToPng({
    svgPath: join(ASSETS_DIR, 'splash-source.svg'),
    outPath: join(ASSETS_DIR, 'splash.png'),
    size: 2732,
    background: { r: 10, g: 14, b: 43, alpha: 1 },
  });

  // Dark variant -- same artwork since our brand is already dark.
  // Without this file @capacitor/assets warns; with it we control
  // the dark-mode splash too.
  console.log('Rendering splash-dark.png (2732 px)...');
  await svgToPng({
    svgPath: join(ASSETS_DIR, 'splash-source.svg'),
    outPath: join(ASSETS_DIR, 'splash-dark.png'),
    size: 2732,
    background: { r: 5, g: 5, b: 16, alpha: 1 },
  });

  console.log('\nAll PNG masters rendered. Run `npx @capacitor/assets generate --android` next.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
