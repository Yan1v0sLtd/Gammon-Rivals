export const adminSections = [
  {label: "Dashboard", path: "dashboard"},
  {label: "Users", path: "users"},
  {label: "Currencies", path: "currencies"},
  {label: "Economy Grants", path: "economy-grants"},
  {label: "Level System", path: "level-system"},
  {label: "Daily Bonus", path: "daily-bonus"},
  {label: "Hourly Wheel", path: "hourly-wheel"},
  {label: "Daily Missions", path: "daily-missions"},
  {label: "Difficulties", path: "difficulties"},
  {label: "RTP Analytics", path: "rtp-analytics"},
  {label: "Board Themes", path: "board-themes"},
  {label: "Lobby Features", path: "lobby-features"},
  {label: "Shop", path: "shop"},
  {label: "Admin Access", path: "admin-access"},
] as const

export type Section = typeof adminSections[number]["label"]
