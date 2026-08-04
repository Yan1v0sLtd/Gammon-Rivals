import type {Die, DiceRoll} from "./types"

export type Rng = {
  next(): number,
}

export const cryptoRng: Rng = {
  next: () => {
    const arr = new Uint32Array(1)
    crypto.getRandomValues(arr)
    return arr[0] / 0x1_0000_0000
  },
}

export function seededRng(seed: number): Rng {
  let s = seed >>> 0
  return {
    next: () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 0x1_0000_0000
    },
  }
}

export function roll(rng: Rng = cryptoRng): DiceRoll {
  const a = (Math.floor(rng.next() * 6) + 1) as Die
  const b = (Math.floor(rng.next() * 6) + 1) as Die
  return [a, b]
}

export function expandDice([a, b]: DiceRoll): readonly Die[] {
  return a === b ? [a, a, a, a] : [a, b]
}
