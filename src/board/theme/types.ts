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
  | 'board'
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

export interface ThemeLayout {
  readonly railWidthRatio?: number;
  readonly barWidthRatio?: number;
  readonly pointHeightRatio?: number;
  readonly topPointYRatio?: number;
  readonly bottomPointYRatio?: number;
  readonly checkerRadiusRatio?: number;
  readonly topPointWidthRatio?: number;
  readonly bottomPointWidthRatio?: number;
  readonly topPlayLeftRatio?: number;
  readonly bottomPlayLeftRatio?: number;
  readonly topBarWidthRatio?: number;
  readonly bottomBarWidthRatio?: number;
  readonly topPointCenterXRatios?: readonly number[];
  readonly bottomPointCenterXRatios?: readonly number[];
  readonly topPointTipXRatios?: readonly number[];
  readonly bottomPointTipXRatios?: readonly number[];
  readonly topCheckerOffsetXRatios?: readonly number[];
  readonly bottomCheckerOffsetXRatios?: readonly number[];
  readonly checkerScaleYRatio?: number;
  readonly checkerStackSpacingRatio?: number;
  readonly topCheckerPaddingRatio?: number;
  readonly bottomCheckerPaddingRatio?: number;
  readonly blackOffTrayXRatio?: number;
  readonly blackOffTrayTopRatio?: number;
  readonly blackOffTrayHeightRatio?: number;
  readonly whiteOffTrayXRatio?: number;
  readonly whiteOffTrayTopRatio?: number;
  readonly whiteOffTrayHeightRatio?: number;
  readonly offCheckerStackSpacingRatio?: number;
}

export interface Theme {
  readonly name: string;
  readonly colors: ThemeColors;
  readonly assets?: ThemeAssets;
  readonly backgroundImage?: string;
  readonly gameplayBackgroundImage?: string;
  readonly layout?: ThemeLayout;
}
