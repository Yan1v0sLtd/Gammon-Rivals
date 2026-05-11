import { Assets, Texture } from 'pixi.js';
import type { Theme, ThemeAssetKey } from './types';

export interface LoadedTheme {
  readonly theme: Theme;
  readonly textures: Partial<Record<ThemeAssetKey, Texture>>;
}

export async function loadTheme(theme: Theme): Promise<LoadedTheme> {
  const textures: Partial<Record<ThemeAssetKey, Texture>> = {};
  if (!theme.assets) return { theme, textures };

  const entries = Object.entries(theme.assets) as [ThemeAssetKey, string][];
  await Promise.all(
    entries.map(async ([key, path]) => {
      try {
        const head = await fetch(path, { method: 'HEAD' });
        if (!head.ok) return;
        let tex = await Assets.load<Texture>(path);
        if (tex.destroyed || tex.source.destroyed) {
          await Assets.unload(path).catch(() => undefined);
          tex = await Assets.load<Texture>(path);
        }
        textures[key] = tex;
      } catch {
        // Asset missing — silent fallback to procedural rendering
      }
    })
  );
  return { theme, textures };
}
