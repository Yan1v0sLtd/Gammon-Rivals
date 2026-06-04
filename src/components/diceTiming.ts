// The dice tumble is a 1.5s CSS transition on .dice-cube (see src/index.css).
// DICE_ANIMATION_MS is how long the game waits after a roll before revealing the
// resulting move / letting the AI play — the visual length plus a small settle
// buffer, so play resumes right as the dice come to rest.
//
// (Was ~5.6s of legacy physics-sim timing from the old Three.js dice, which left
// a multi-second dead pause after every roll while the CSS dice had already
// settled in 1.5s. If you ever change the .dice-cube transition duration, keep
// this in sync.)
export const DICE_ANIMATION_MS = 1650;
