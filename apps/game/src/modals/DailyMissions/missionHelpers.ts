import {type SyntheticEvent} from "react"

export function hideImg(e: SyntheticEvent<HTMLImageElement>) {
  (e.currentTarget).style.visibility = "hidden"
}

export function formatAmount(n: number): string {
  // Full number with thousands separators (e.g. 11100 -> "11,100"). Easier to
  // read than K-abbreviation for the larger cashback coin rewards.
  return n.toLocaleString("en-US")
}
