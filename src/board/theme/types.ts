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
  /** Per-row overrides for point depth. If omitted, falls back to the
   *  shared pointHeightRatio. */
  readonly topPointHeightRatio?: number;
  readonly bottomPointHeightRatio?: number;
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
  /** Per-row overrides for checker stack spacing. If omitted, falls
   *  back to the shared checkerStackSpacingRatio. */
  readonly topCheckerStackSpacingRatio?: number;
  readonly bottomCheckerStackSpacingRatio?: number;
  readonly topCheckerPaddingRatio?: number;
  readonly bottomCheckerPaddingRatio?: number;
  /** Inner top-left corner of the painted felt rectangle, expressed as
   *  [xRatio, yRatio] of the board image. The engine maps points / bar
   *  to fit between these corners and feltInnerBottomRightRatio so a
   *  board with a wide ornate frame and a board with a thin frame both
   *  align without retuning. When omitted the play area falls back to
   *  the legacy railWidth-derived rectangle. */
  readonly feltInnerTopLeftRatio?: readonly [number, number];
  readonly feltInnerTopRightRatio?: readonly [number, number];
  readonly feltInnerBottomLeftRatio?: readonly [number, number];
  readonly feltInnerBottomRightRatio?: readonly [number, number];
  /** PER-HALF felt quads — the fully art-agnostic positioning model.
   *  Each half of the board (6 points left of the bar, 6 right) gets its
   *  own four corners, so the painted bar's true width, unequal half
   *  widths, vertical offsets and even per-half perspective all come from
   *  measurement instead of assumption. When BOTH halves provide at least
   *  TL + BR (TR / BL default axis-aligned, like the single-quad keys),
   *  the engine positions each half's points inside its own quad and the
   *  bar is simply the measured gap between the two — checkers can never
   *  overlap the painted bar. When absent, the legacy single-quad model
   *  above applies unchanged (bar width assumed via barWidthRatio). */
  readonly feltLeftHalfTopLeftRatio?: readonly [number, number];
  readonly feltLeftHalfTopRightRatio?: readonly [number, number];
  readonly feltLeftHalfBottomLeftRatio?: readonly [number, number];
  readonly feltLeftHalfBottomRightRatio?: readonly [number, number];
  readonly feltRightHalfTopLeftRatio?: readonly [number, number];
  readonly feltRightHalfTopRightRatio?: readonly [number, number];
  readonly feltRightHalfBottomLeftRatio?: readonly [number, number];
  readonly feltRightHalfBottomRightRatio?: readonly [number, number];
  /** Optional perspective depth-scale: checkers near the front of the
   *  felt (v=1) get scaled up by `1 + feltDepthScaleRatio`, checkers
   *  at the back (v=0) by `1 - feltDepthScaleRatio`. Defaults to 0
   *  (no scaling). Reserved for a later step. */
  readonly feltDepthScaleRatio?: number;
  readonly blackOffTrayXRatio?: number;
  readonly blackOffTrayTopRatio?: number;
  readonly blackOffTrayHeightRatio?: number;
  readonly whiteOffTrayXRatio?: number;
  readonly whiteOffTrayTopRatio?: number;
  readonly whiteOffTrayHeightRatio?: number;
  readonly offCheckerStackSpacingRatio?: number;
  /** Felt-anchored bear-off trays. When the theme provides felt corners,
   *  the trays are DERIVED from the right felt edge + the felt's vertical
   *  extent (see computeLayout), so they auto-track each board's felt
   *  instead of needing absolute per-board positions. These shared knobs
   *  tune that derivation; sensible global defaults mean most boards need
   *  no per-board tray config at all.
   *    offTrayInsetRatio  — tray centre across the right rail (0 = felt
   *                         edge, 1 = board edge). Default 0.5.
   *    offTrayMarginRatio — vertical inset from felt top/bottom (fraction
   *                         of felt height). Default 0.06.
   *    offTrayMidGapRatio — gap between the two trays at the felt midline
   *                         (fraction of felt height). Default 0.22.
   *  The absolute *OffTray*Ratio keys below are the legacy fallback (used
   *  only for corner-less themes or an explicit per-board override). */
  readonly offTrayInsetRatio?: number;
  readonly offTrayMarginRatio?: number;
  readonly offTrayMidGapRatio?: number;
  /** Angle (deg) tilting the off-tray stack axis away from vertical.
   *  0 stacks straight up/down; positive tilts checkers' top right. */
  readonly blackOffTrayTiltDeg?: number;
  readonly whiteOffTrayTiltDeg?: number;
}

export interface Theme {
  readonly name: string;
  readonly colors: ThemeColors;
  readonly assets?: ThemeAssets;
  readonly backgroundImage?: string;
  readonly gameplayBackgroundImage?: string;
  readonly layout?: ThemeLayout;
  /** Optional theme-provided dice artwork. Must be a single image
   *  laid out as a **3 columns × 2 rows** sprite sheet, with face
   *  values 1–6 in reading order (face 1 top-left, face 6
   *  bottom-right). Rendered by src/components/DiceTray.tsx via
   *  CSS background-image + background-position per face.
   *
   *  Falls back to the default white-cube-with-red-pips CSS dice
   *  when omitted.
   *
   *  Sourced from board_theme_configs.dice_image (see
   *  src/board/theme/remote.ts → themeFromBoardConfig). */
  readonly diceImage?: string;
}
