/**
 * Single source for the identity strings the site repeats: company, contact,
 * legal jurisdiction, and the shared marketing lines. Pages and components
 * import from here so a change to an address, mailbox, or legal date is made
 * once and can never drift between Terms, Privacy, and marketing copy.
 */
export const site = {
  /** Product name as players know it. */
  name: "Gammon Rivals",
  /** Registered company that operates the app and is party to the Terms. */
  legalName: "Yanivos Ltd",
  /** Public brand the company trades under. */
  tradeName: "Gammon Rivals",
  /** Postal address shown in the legal contact blocks. */
  mailingAddress: "Tel Aviv, Israel",
  /** Canonical origin, without a trailing slash. */
  url: "https://gammonrivals.com",
  /** Mailbox for players: help, purchases, account requests. */
  supportEmail: "support@gammonrivals.com",
  /** Mailbox for data-protection requests. Same inbox as support today —
      split the two only when a dedicated mailbox exists. */
  privacyEmail: "support@gammonrivals.com",
  /** Governing law and venue named in the Terms. */
  jurisdiction: "Israel",
  /** Minimum age stated in the Terms and Privacy Policy. */
  minimumAge: 18,
  /** Store listings. Empty until the app is published — /download then shows a
      "tell me when it is out" prompt instead of a dead button. */
  appStoreUrl: "",
  googlePlayUrl: "",
  /** Date the current Terms and Privacy Policy took effect. Update it in the
      same commit that changes either document. */
  legalEffectiveDate: "4 August 2026",
  /** Default one-line pitch, used as the fallback meta description. */
  description:
    "Classic backgammon for quick matches on your phone. Play real opponents or AI, on boards you unlock as you go.",
  /** Standing no-gambling statement. Required wording for app stores and
      repeated wherever the currency is mentioned. */
  disclaimer:
    "Coins and Gems are virtual currency with no cash value. Gammon Rivals is not a gambling app: no real-money stakes, no prizes, no cash-out.",
} as const
