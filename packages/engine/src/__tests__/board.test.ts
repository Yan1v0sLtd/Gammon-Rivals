import {describe, expect, it} from "vitest"

import {initialBoard, pipCount} from "../board"
import {expandDice, seededRng, roll} from "../dice"

describe("initialBoard", () => {
  const state = initialBoard()

  it("has 24 points", () => {
    expect(state.points).toHaveLength(24)
  })

  it("places 15 checkers per side", () => {
    const sum = (p: "white" | "black") =>
      state.points.filter((pt) => pt.owner === p).reduce((s, pt) => s + pt.count, 0)
    expect(sum("white")).toBe(15)
    expect(sum("black")).toBe(15)
  })

  it("starts with empty bar and off-board for both players", () => {
    expect(state.bar).toEqual({white: 0, black: 0})
    expect(state.off).toEqual({white: 0, black: 0})
  })

  it("white moves first by convention", () => {
    expect(state.turn).toBe("white")
  })

  it("pip count is 167 for both sides at start", () => {
    expect(pipCount(state, "white")).toBe(167)
    expect(pipCount(state, "black")).toBe(167)
  })
})

describe("dice", () => {
  it("expands doubles into four dice", () => {
    expect(expandDice([4, 4])).toEqual([4, 4, 4, 4])
  })

  it("expands non-doubles into two dice", () => {
    expect(expandDice([2, 5])).toEqual([2, 5])
  })

  it("seeded RNG is deterministic", () => {
    const a = roll(seededRng(42))
    const b = roll(seededRng(42))
    expect(a).toEqual(b)
  })

  it("all rolls are between 1 and 6", () => {
    const rng = seededRng(1)
    for (let i = 0; i < 200; i++) {
      const [a, b] = roll(rng)
      expect(a).toBeGreaterThanOrEqual(1)
      expect(a).toBeLessThanOrEqual(6)
      expect(b).toBeGreaterThanOrEqual(1)
      expect(b).toBeLessThanOrEqual(6)
    }
  })
})
