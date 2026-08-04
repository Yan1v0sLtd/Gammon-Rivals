import {describe, it, expect} from "vitest"

import {initialBoard, pipCount} from "../board"
import {seededRng, roll, expandDice} from "../dice"
import {legalMoves, applyMove, endTurn, winner} from "../rules"
import {BAR, OFF} from "../types"
import type {BoardState, Die, Move, Player} from "../types"

/**
 * Property-based / full-game fuzz harness for the rules engine.
 *
 * The hand-written suites (rules.test.ts / match.test.ts) cover specific
 * scenarios; this file plays hundreds of RANDOM complete games and asserts
 * structural + rule invariants after every single sub-move, plus an
 * INDEPENDENT re-implementation of legal-move generation to cross-check the
 * subtle "you must play the maximum number of dice" rule against the engine's
 * own legalMoves(). Two independent implementations agreeing is the proof.
 *
 * Everything is driven by a seeded RNG so any failure is reproducible.
 */

const PLAYERS: Player[] = ["white", "black"]

function totalCheckers(state: BoardState, p: Player): number {
  let n = state.bar[p] + state.off[p]
  for (const pt of state.points) if (pt.owner === p) n += pt.count
  return n
}

function assertStructural(state: BoardState) {
  for (const p of PLAYERS) {
    expect(totalCheckers(state, p)).toBe(15)
    expect(state.bar[p]).toBeGreaterThanOrEqual(0)
    expect(state.off[p]).toBeLessThanOrEqual(15)
    expect(state.off[p]).toBeGreaterThanOrEqual(0)
  }
  for (const pt of state.points) {
    expect(pt.count).toBeGreaterThanOrEqual(0)
    // count === 0  <=>  owner === null  (no ghost owners, no owned-but-empty)
    if (pt.count === 0) expect(pt.owner).toBeNull()
    else expect(pt.owner).not.toBeNull()
  }
}

// white: low->high, home 18..23, bears off past 23. black: high->low, home
// 0..5, bears off past 0. Used ONLY to cross-check the engine; never imports
// the engine's singleMovesForDie / maxSequenceLength.
function indepInHome(p: Player, i: number): boolean {
  return p === "white" ? i >= 18 && i <= 23 : i >= 0 && i <= 5
}
function indepAllHome(state: BoardState, p: Player): boolean {
  if (state.bar[p] > 0) return false
  for (let i = 0; i < 24; i++) {
    const pt = state.points[i]
    if (pt.owner === p && pt.count > 0 && !indepInHome(p, i)) return false
  }
  return true
}
function indepSingleMoves(state: BoardState, die: Die): {from: number | typeof BAR, to: number | typeof OFF}[] {
  const p = state.turn
  const dir = p === "white" ? 1 : -1
  const canLand = (i: number) => {
    const pt = state.points[i]
    return pt.count === 0 || pt.owner === p || pt.count === 1
  }
  if (state.bar[p] > 0) {
    const entry = p === "white" ? die - 1 : 24 - die
    if (entry < 0 || entry > 23) return []
    return canLand(entry) ? [{from: BAR, to: entry}] : []
  }
  const allHome = indepAllHome(state, p)
  const out: {from: number | typeof BAR, to: number | typeof OFF}[] = []
  for (let from = 0; from < 24; from++) {
    const pt = state.points[from]
    if (pt.owner !== p || pt.count === 0) continue
    const target = from + dir * die
    if (target >= 0 && target < 24) {
      if (canLand(target)) out.push({from, to: target})
    }
    else if (allHome) {
      if (p === "white") {
        if (target === 24) out.push({from, to: OFF})
        else if (target > 24) {
          let blocked = false
          for (let i = 18; i < from; i++) {
            const q = state.points[i]; if (q.owner === "white" && q.count > 0) {
              blocked = true; break
            } 
          }
          if (!blocked) out.push({from, to: OFF})
        }
      }
      else {
        if (target === -1) out.push({from, to: OFF})
        else if (target < -1) {
          let blocked = false
          for (let i = from + 1; i <= 5; i++) {
            const q = state.points[i]; if (q.owner === "black" && q.count > 0) {
              blocked = true; break
            } 
          }
          if (!blocked) out.push({from, to: OFF})
        }
      }
    }
  }
  return out
}
function indepMaxDice(state: BoardState, dice: readonly Die[]): number {
  if (dice.length === 0) return 0
  const orderings: Die[][] =
    dice.length === 2 && dice[0] !== dice[1] ? [[dice[0], dice[1]], [dice[1], dice[0]]] : [[...dice]]
  let best = 0
  for (const ord of orderings) {
    const first = ord[0]
    for (const m of indepSingleMoves(state, first)) {
      const next = applyMove(state, {from: m.from, to: m.to, die: first, hit: false})
      const len = 1 + indepMaxDice(next, ord.slice(1))
      if (len > best) best = len
      if (best === dice.length) return best
    }
  }
  return best
}

function removeOne(dice: readonly Die[], d: Die): Die[] {
  const i = dice.indexOf(d)
  const copy = [...dice]
  if (i >= 0) copy.splice(i, 1)
  return copy
}

describe("engine fuzz — random full games hold all invariants", () => {
  it("plays 120 seeded games to completion with no invariant violation", () => {
    const GAMES = 120
    const TURN_CAP = 5000 // generous; a healthy game ends in ~50-200 turns
    let totalTurns = 0
    let maxDiceChecks = 0

    for (let seed = 1; seed <= GAMES; seed++) {
      const rng = seededRng(seed * 7919 + 13)
      let state = initialBoard()
      let turns = 0

      while (winner(state) === null && turns < TURN_CAP) {
        const before = state
        const mover = before.turn
        const dice = expandDice(roll(rng))
        const expectedMax = indepMaxDice(before, dice)

        let remaining: Die[] = [...dice]
        let played = 0
        let pipBefore = pipCount(state, mover)

        // Greedily follow the engine's own legalMoves. Because legalMoves only
        // returns first-moves that achieve the max sequence, any greedy path
        // through it must consume exactly the maximum number of dice.
        while (remaining.length > 0) {
          const moves: readonly Move[] = legalMoves(state, remaining)
          if (moves.length === 0) break
          const m = moves[Math.floor(rng.next() * moves.length) % moves.length]

          expect(remaining.includes(m.die)).toBe(true)
          if (before.bar[mover] > 0 || state.bar[mover] > 0) {
            // bar priority: while on the bar, the only legal source is BAR
            if (state.bar[mover] > 0) expect(m.from).toBe(BAR)
          }
          if (typeof m.from === "number") {
            const fp = state.points[m.from]
            expect(fp.owner).toBe(mover)
            expect(fp.count).toBeGreaterThan(0)
          }
          if (m.to === OFF) {
            // bear-off only when everything is home
            expect(indepAllHome(state, mover)).toBe(true)
          }

          // applyMove must never throw on a move the engine itself offered
          const next = applyMove(state, m)

          // mover's pip count strictly decreases every sub-move
          const pipAfter = pipCount(next, mover)
          expect(pipAfter).toBeLessThan(pipBefore)
          pipBefore = pipAfter

          state = next
          assertStructural(state)
          remaining = removeOne(remaining, m.die)
          played += 1
        }

        // THE subtle rule: the engine must force the player to use the maximum
        // number of dice — no more, no fewer — verified against the independent
        // generator above.
        expect(played).toBe(expectedMax)
        maxDiceChecks += 1

        state = endTurn(state)
        turns += 1
      }

      // Every game must terminate with a real winner (off === 15). A stuck
      // turn (legalMoves wrongly empty) or a non-terminating bug would blow the
      // cap and fail here.
      expect(turns).toBeLessThan(TURN_CAP)
      const w = winner(state)
      expect(w).not.toBeNull()
      expect(state.off[w!]).toBe(15)
      totalTurns += turns
    }

    // Sanity that the harness actually exercised the engine hard.
    expect(maxDiceChecks).toBeGreaterThan(GAMES * 20)
    expect(totalTurns).toBeGreaterThan(GAMES * 20)
  }, 120000)

  it("legalMoves never offers a move applyMove rejects (1000 random reachable states)", () => {
    const rng = seededRng(424242)
    let checked = 0
    for (let g = 0; g < 60; g++) {
      let state = initialBoard()
      let turns = 0
      while (winner(state) === null && turns < 400) {
        let remaining: Die[] = [...expandDice(roll(rng))]
        while (remaining.length > 0) {
          const moves = legalMoves(state, remaining)
          if (moves.length === 0) break
          for (const m of moves) {
            expect(() => applyMove(state, m)).not.toThrow()
            checked += 1
          }
          const m = moves[Math.floor(rng.next() * moves.length) % moves.length]
          state = applyMove(state, m)
          remaining = removeOne(remaining, m.die)
        }
        state = endTurn(state)
        turns += 1
      }
    }
    expect(checked).toBeGreaterThan(1000)
  }, 60000)
})
