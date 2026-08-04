import {defaultTheme} from "./default"
import type {Theme} from "./types"

// Image-based theme. Drop matching files into public/themes/wood/ to activate.
// Any missing file gracefully falls back to procedural rendering using the
// inherited color palette below.
export const woodTheme: Theme = {
  name: "wood",
  colors: {
    ...defaultTheme.colors,
    frameLight: 0xa45f32,
    frameDark: 0x4a2411,
    frameBevel: 0xd38a4b,
    felt: 0xe0ad63,
    pointLightBase: 0xffe7a7,
    pointLightTip: 0xd19145,
    pointDarkBase: 0xbd6133,
    pointDarkTip: 0x773018,
    trayBg: 0x7b1718,
  },
  assets: {
    frame: "/themes/wood/frame.jpg",
    felt: "/themes/wood/felt.jpg",
    rail: "/themes/wood/rail.jpg",
    bar: "/themes/wood/rail.jpg",
  },
}
