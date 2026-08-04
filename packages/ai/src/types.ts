export type AILevel = "easy" | "medium" | "hard"

export const AI_LEVELS: readonly AILevel[] = ["easy", "medium", "hard"] as const

export const AI_LEVEL_LABEL: Readonly<Record<AILevel, string>> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
}
