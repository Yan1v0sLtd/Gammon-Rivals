import {defaultTheme} from "./default"
import type {Theme} from "./types"

// Color palette base for premiumTheme. Not rendered directly: the renderer
// requires a full `board` texture plus `whiteChecker`/`blackChecker`, which
// premiumTheme provides. This theme exists only to share the wood palette.
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
}
