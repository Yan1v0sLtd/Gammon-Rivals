export interface ThemeColors {
  frameLight: number;
  frameDark: number;
  frameBevel: number;
  frameInnerEdge: number;
  felt: number;
  feltVignette: number;
  pointLightBase: number;
  pointLightTip: number;
  pointDarkBase: number;
  pointDarkTip: number;
  pointOutline: number;
  bar: number;
  barHighlight: number;
  rail: number;
  brass: number;
  brassDark: number;
  whiteCheckerRim: number;
  whiteCheckerLight: number;
  whiteCheckerDark: number;
  whiteCheckerHighlight: number;
  blackCheckerRim: number;
  blackCheckerLight: number;
  blackCheckerDark: number;
  blackCheckerHighlight: number;
  trayBg: number;
}

export type ThemeAssetKey =
  | 'frame'
  | 'felt'
  | 'rail'
  | 'bar'
  | 'pointLight'
  | 'pointDark'
  | 'hinge'
  | 'whiteChecker'
  | 'blackChecker';

export type ThemeAssets = Partial<Record<ThemeAssetKey, string>>;

export interface Theme {
  readonly name: string;
  readonly colors: ThemeColors;
  readonly assets?: ThemeAssets;
}
