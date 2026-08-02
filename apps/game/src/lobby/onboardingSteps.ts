// First-run onboarding tour content. Kept in its own module (not the
// component file) so editing copy never risks the component's fast-refresh
// boundary, and so the wording lives in one obvious place.

export interface TourStep {
  readonly id: string;
  /** CSS selector for the element to spotlight. Omit for a centered card. */
  readonly anchor?: string;
  readonly title: string;
  /** One <p> per array entry. */
  readonly body: readonly string[];
  /** Primary button label. */
  readonly cta: string;
}

// Ordered. Anchors map to live hooks: the currency pills in LobbyTopBar carry
// data-fly-target; the board carousel's PLAY button carries data-tour="play".
export const ONBOARDING_STEPS: readonly TourStep[] = [{
  id: 'welcome',
  title: 'Welcome to Gammon Rivals',
  body: ['Master the board, challenge rivals worldwide, and rise through the ranks.', "Let's take a quick tour before your first match.",],
  cta: "Let's Go",
}, {
  id: 'gold',
  anchor: '[data-fly-target="coins"]',
  title: 'Gold',
  body: ['Gold is used to enter matches and compete for bigger rewards.', 'Win games and unlock higher stakes competition.',],
  cta: 'Next',
}, {
  id: 'gems',
  anchor: '[data-fly-target="gems"]',
  title: 'Gems',
  body: ['Gems unlock exclusive boards and premium content.', 'Earn them through Daily Missions, bonuses, events, and special sales in the Shop.',],
  cta: 'Next',
}, {
  id: 'play',
  anchor: '[data-tour="play"]',
  title: 'Your First Match Awaits',
  body: ['Choose a board and tap Play to enter the arena.'],
  cta: "Let's Play!",
},];
