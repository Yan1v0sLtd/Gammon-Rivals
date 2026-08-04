import {describe, expect, it} from "vitest"

import {initialBoard} from "../board"
import {applyMove, endTurn, legalMoves, winner} from "../rules"
import {BAR, OFF} from "../types"
import type {Die, Move} from "../types"

import {makeBoard} from "./helpers"

const moveKey = (m: Move) => `${String(m.from)}->${String(m.to)}@${m.die}`
const keys = (moves: readonly Move[]) => moves.map(moveKey).sort()

describe("legalMoves — initial position", () => {
  it("white opening 3-1 generates the canonical first moves", () => {
    const moves = legalMoves(initialBoard(), [3, 1] as Die[])
    const ks = keys(moves)
    expect(ks).toContain("11->14@3")
    expect(ks).toContain("16->17@1")
    expect(ks.length).toBeGreaterThan(0)
  })

  it("black moves only on black turn", () => {
    const state = {...initialBoard(), turn: "black" as const}
    const moves = legalMoves(state, [3, 1] as Die[])
    expect(moves.every((m) => typeof m.from === "number" || m.from === BAR)).toBe(true)
    const ks = keys(moves)
    expect(ks.some((k) => k.startsWith("12->"))).toBe(true)
  })
})

describe("bar entry priority", () => {
  it("white on bar must enter before any other move", () => {
    const state = makeBoard({
      bar: {white: 1},
      points: {11: ["white", 5], 16: ["white", 3]},
      turn: "white",
    })
    const moves = legalMoves(state, [3, 1] as Die[])
    expect(moves.every((m) => m.from === BAR)).toBe(true)
  })

  it("white enters at point die-1", () => {
    const state = makeBoard({bar: {white: 1}, turn: "white"})
    const moves = legalMoves(state, [4, 5] as Die[])
    const targets = moves.filter((m) => m.from === BAR).map((m) => m.to)
    expect(targets).toContain(3)
    expect(targets).toContain(4)
  })

  it("black enters at point 24-die", () => {
    const state = makeBoard({bar: {black: 1}, turn: "black"})
    const moves = legalMoves(state, [4, 5] as Die[])
    const targets = moves.filter((m) => m.from === BAR).map((m) => m.to)
    expect(targets).toContain(20)
    expect(targets).toContain(19)
  })

  it("blocked entry returns no move for that die", () => {
    const state = makeBoard({
      bar: {white: 1},
      points: {2: ["black", 3], 4: ["black", 2]},
      turn: "white",
    })
    const moves = legalMoves(state, [3, 5] as Die[])
    expect(moves.every((m) => m.from === BAR)).toBe(true)
    const targets = moves.map((m) => m.to)
    expect(targets).not.toContain(2)
    expect(targets).not.toContain(4)
  })

  it("returns empty when both bar entries blocked", () => {
    const state = makeBoard({
      bar: {white: 1},
      points: {2: ["black", 2], 4: ["black", 2]},
      turn: "white",
    })
    expect(legalMoves(state, [3, 5] as Die[])).toEqual([])
  })

  it("two checkers on bar — both must be entered before regular moves", () => {
    const state = makeBoard({
      bar: {white: 2},
      points: {11: ["white", 5]},
      turn: "white",
    })
    const next = applyMove(state, {from: BAR, to: 2, die: 3, hit: false})
    const followUp = legalMoves(next, [1] as Die[])
    expect(followUp.every((m) => m.from === BAR)).toBe(true)
  })
})

describe("hit logic", () => {
  it("landing on a single opponent checker sends it to the bar", () => {
    const state = makeBoard({
      points: {11: ["white", 1], 12: ["black", 1]},
      turn: "black",
    })
    const moves = legalMoves(state, [1] as Die[])
    const hit = moves.find((m) => m.from === 12 && m.to === 11)
    expect(hit).toBeDefined()
    expect(hit!.hit).toBe(true)

    const after = applyMove(state, hit!)
    expect(after.points[11]).toEqual({owner: "black", count: 1})
    expect(after.bar.white).toBe(1)
  })

  it("cannot land on opponent point with 2+ checkers", () => {
    const state = makeBoard({
      points: {12: ["white", 1], 14: ["black", 2]},
      turn: "white",
    })
    const moves = legalMoves(state, [2] as Die[])
    expect(moves.some((m) => m.from === 12 && m.to === 14)).toBe(false)
  })
})

describe("bear-off", () => {
  it("cannot bear off if any checker outside home", () => {
    const state = makeBoard({
      points: {18: ["white", 14], 5: ["white", 1]},
      turn: "white",
    })
    const moves = legalMoves(state, [3] as Die[])
    expect(moves.every((m) => m.to !== OFF)).toBe(true)
  })

  it("white exact bear-off — die 6 from point 18", () => {
    const state = makeBoard({points: {18: ["white", 5]}, turn: "white"})
    const moves = legalMoves(state, [6] as Die[])
    const off = moves.find((m) => m.to === OFF)
    expect(off).toBeDefined()
    expect(off!.from).toBe(18)
  })

  it("white overshoot — bear off from highest occupied below die", () => {
    // checkers only at 19 and 20, die 6 → bear-off from 19 (lowest occupied home)
    const state = makeBoard({points: {19: ["white", 1], 20: ["white", 1]}, turn: "white"})
    const moves = legalMoves(state, [6] as Die[])
    const off = moves.find((m) => m.to === OFF)
    expect(off).toBeDefined()
    expect(off!.from).toBe(19)
  })

  it("white overshoot blocked when lower home point still occupied", () => {
    // checkers at 18 and 20, die 6 → only exact bear-off from 18 (overshoot from 20 not allowed)
    const state = makeBoard({points: {18: ["white", 1], 20: ["white", 1]}, turn: "white"})
    const moves = legalMoves(state, [6] as Die[])
    const offFrom20 = moves.find((m) => m.to === OFF && m.from === 20)
    expect(offFrom20).toBeUndefined()
    const offFrom18 = moves.find((m) => m.to === OFF && m.from === 18)
    expect(offFrom18).toBeDefined()
  })

  it("black exact bear-off — die 1 from point 0", () => {
    const state = makeBoard({points: {0: ["black", 5]}, turn: "black"})
    const moves = legalMoves(state, [1] as Die[])
    const off = moves.find((m) => m.to === OFF)
    expect(off).toBeDefined()
    expect(off!.from).toBe(0)
  })

  it("black overshoot — die 6 with checkers only at 4", () => {
    const state = makeBoard({points: {4: ["black", 2]}, turn: "black"})
    const moves = legalMoves(state, [6] as Die[])
    const off = moves.find((m) => m.to === OFF)
    expect(off).toBeDefined()
    expect(off!.from).toBe(4)
  })

  it("black overshoot blocked when higher home point still occupied", () => {
    const state = makeBoard({points: {3: ["black", 1], 5: ["black", 1]}, turn: "black"})
    const moves = legalMoves(state, [6] as Die[])
    const off = moves.find((m) => m.to === OFF && m.from === 3)
    expect(off).toBeUndefined()
    const offFrom5 = moves.find((m) => m.to === OFF && m.from === 5)
    expect(offFrom5).toBeDefined()
  })
})

describe("forced-move rules", () => {
  it("returns empty when no dice can be played", () => {
    // White boxed in: only checker at 11, die 1, 12 blocked by black, die 2 also blocked
    const state = makeBoard({
      points: {
        11: ["white", 1],
        12: ["black", 3],
        13: ["black", 3],
      },
      turn: "white",
    })
    expect(legalMoves(state, [1, 2] as Die[])).toEqual([])
  })

  it("must use larger die if only one of two is playable", () => {
    // White at 11 only. Die 1 → 12 blocked. Die 4 → 15 open. After 11→15, 15→16 also blocked.
    // So max sequence = 1, and "must use larger" forces die 4.
    const state = makeBoard({
      points: {
        11: ["white", 1],
        12: ["black", 3],
        16: ["black", 3],
      },
      turn: "white",
    })
    const moves = legalMoves(state, [1, 4] as Die[])
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((m) => m.die === 4)).toBe(true)
  })

  it("plays smaller die when larger is unplayable", () => {
    // White at 18. Die 5 → 23 blocked by black 2+. Die 2 → 20 open.
    const state = makeBoard({
      points: {
        18: ["white", 1],
        23: ["black", 3],
      },
      turn: "white",
    })
    const moves = legalMoves(state, [5, 2] as Die[])
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((m) => m.die === 2)).toBe(true)
  })

  it("enforces 2-die sequence when one ordering plays both and the other plays only one", () => {
    // White at 18 only. Die 1 → 19 blocked. Die 4 → 22 open. After 18→22, can play 1 (22→23 if open).
    // Order [1,4]: 1 first blocked → length 0 unless we include 4 first.
    // Order [4,1]: 18→22 (4), then 22→23 (1) → length 2. Max = 2.
    // Legal first moves: only 18→22 (the move that enables both dice).
    const state = makeBoard({
      points: {
        18: ["white", 1],
        19: ["black", 3],
      },
      turn: "white",
    })
    const moves = legalMoves(state, [1, 4] as Die[])
    expect(moves.length).toBe(1)
    expect(moves[0].from).toBe(18)
    expect(moves[0].to).toBe(22)
    expect(moves[0].die).toBe(4)
  })
})

describe("doubles", () => {
  it("black opening 6-6 plays four 6-moves", () => {
    // Sanity: 23→17, 12→6, 7→1 all open at start. Sequence should be length 4.
    const state = {...initialBoard(), turn: "black" as const}
    const moves = legalMoves(state, [6, 6, 6, 6] as Die[])
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((m) => m.die === 6)).toBe(true)
  })

  it("doubles allow up to four moves of the same die", () => {
    const state = makeBoard({points: {18: ["white", 4]}, turn: "white"})
    const moves = legalMoves(state, [2, 2, 2, 2] as Die[])
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((m) => m.die === 2)).toBe(true)
  })
})

describe("applyMove invariants", () => {
  it("checker count is conserved on a regular move", () => {
    const state = initialBoard()
    const moves = legalMoves(state, [3, 1] as Die[])
    const next = applyMove(state, moves[0])
    const total = (s: typeof state, p: "white" | "black") =>
      s.points.filter((pt) => pt.owner === p).reduce((sum, pt) => sum + pt.count, 0)
      + s.bar[p]
      + s.off[p]
    expect(total(next, "white")).toBe(15)
    expect(total(next, "black")).toBe(15)
  })

  it("hit increments opponent bar by exactly one", () => {
    const state = makeBoard({
      points: {11: ["white", 1], 12: ["black", 1]},
      turn: "black",
    })
    const move: Move = {from: 12, to: 11, die: 1, hit: true}
    const next = applyMove(state, move)
    expect(next.bar.white).toBe(1)
    expect(next.points[11]).toEqual({owner: "black", count: 1})
  })

  it("endTurn flips player", () => {
    const s = initialBoard()
    expect(endTurn(s).turn).toBe("black")
    expect(endTurn(endTurn(s)).turn).toBe("white")
  })
})

describe("winner", () => {
  it("returns null when no one has born off all 15", () => {
    expect(winner(initialBoard())).toBeNull()
  })

  it("detects white win", () => {
    const s = makeBoard({off: {white: 15}})
    expect(winner(s)).toBe("white")
  })

  it("detects black win", () => {
    const s = makeBoard({off: {black: 15}})
    expect(winner(s)).toBe("black")
  })
})
