import { defaultTheme } from './default';
import type { Theme } from './types';

// Image-based theme. Drop matching files into public/themes/wood/ to activate.
// Any missing file gracefully falls back to procedural rendering using the
// inherited color palette below.
export const woodTheme: Theme = {
  name: 'wood',
  colors: {
    ...defaultTheme.colors,
    frameLight: 0x6b4220,
    frameDark: 0x2d1a08,
    felt: 0xc9a86b,
  },
  assets: {
    frame: '/themes/wood/frame.jpg',
    felt: '/themes/wood/felt.jpg',
    rail: '/themes/wood/rail.jpg',
    bar: '/themes/wood/rail.jpg',
  },
};
