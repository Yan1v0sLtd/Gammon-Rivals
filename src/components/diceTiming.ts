export const MAX_SIM_STEPS = 360;
export const SETTLE_MS = 280;
export const HOLD_MS = 240;
export const CENTER_MS = 460;

export const DICE_ANIMATION_MS =
  (MAX_SIM_STEPS / 60) * 1000 + SETTLE_MS + HOLD_MS + CENTER_MS;
