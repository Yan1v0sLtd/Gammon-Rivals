// All four phases shortened by ~20 % from their original values
// (360 / 280 / 240 / 460) so the full roll lands ~20 % faster while
// the relative pacing between phases stays the same.
export const MAX_SIM_STEPS = 288;
export const SETTLE_MS = 224;
export const HOLD_MS = 192;
export const CENTER_MS = 368;

export const DICE_ANIMATION_MS =
  (MAX_SIM_STEPS / 60) * 1000 + SETTLE_MS + HOLD_MS + CENTER_MS;
