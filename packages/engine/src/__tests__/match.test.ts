import {describe, expect, it} from "vitest"

import {
  acceptDouble,
  canOfferDouble,
  classifyWin,
  dropDouble,
  gameWonByBearOff,
  isCrawfordGame,
  newMatch,
  offerDouble,
  type MatchState,
} from "../match"

import {makeBoard} from "./helpers"

describe("newMatch", () => {
  it("starts with zero score, cube=1 in center, no winner", () => {
    const m = newMatch(7)
    expect(m.target).toBe(7)
    expect(m.score).toEqual({white: 0, black: 0})
    expect(m.gameNumber).toBe(1)
    expect(m.cube).toEqual({value: 1, owner: null})
    expect(m.cubeOffer).toBeNull()
    expect(m.crawfordGameNumber).toBeNull()
    expect(m.winner).toBeNull()
  })

  it("rejects target < 1", () => {
    expect(() => newMatch(0)).toThrow()
  })
})

describe("classifyWin", () => {
  it("single: loser has at least one off", () => {
    const s = makeBoard({off: {white: 15, black: 1}})
    expect(classifyWin(s, "white")).toBe("single")
  })

  it("gammon: loser has none off, no bar, no checkers in winner home", () => {
    const s = makeBoard({
      off: {white: 15, black: 0},
      points: {0: ["black", 15]},
    })
    expect(classifyWin(s, "white")).toBe("gammon")
  })

  it("backgammon: loser has checker on the bar", () => {
    const s = makeBoard({
      off: {white: 15, black: 0},
      bar: {black: 1},
      points: {0: ["black", 14]},
    })
    expect(classifyWin(s, "white")).toBe("backgammon")
  })

  it("backgammon: loser has checker in winner's home", () => {
    const s = makeBoard({
      off: {white: 15, black: 0},
      points: {18: ["black", 1], 0: ["black", 14]},
    })
    expect(classifyWin(s, "white")).toBe("backgammon")
  })

  it("backgammon for black: checker on white bar or black home (0-5)", () => {
    const s = makeBoard({
      off: {black: 15, white: 0},
      points: {5: ["white", 1], 23: ["white", 14]},
    })
    expect(classifyWin(s, "black")).toBe("backgammon")
  })
})

describe("doubling cube", () => {
  it("center cube: either player can offer", () => {
    const m = newMatch(5)
    expect(canOfferDouble(m, "white")).toBe(true)
    expect(canOfferDouble(m, "black")).toBe(true)
  })

  it("1-point match: cube is dead — neither player can offer", () => {
    const m = newMatch(1)
    expect(canOfferDouble(m, "white")).toBe(false)
    expect(canOfferDouble(m, "black")).toBe(false)
  })

  it("owned cube: only owner can offer", () => {
    const m: MatchState = {...newMatch(5), cube: {value: 2, owner: "white"}}
    expect(canOfferDouble(m, "white")).toBe(true)
    expect(canOfferDouble(m, "black")).toBe(false)
  })

  it("cannot double if cube at 64", () => {
    const m: MatchState = {...newMatch(5), cube: {value: 64, owner: null}}
    expect(canOfferDouble(m, "white")).toBe(false)
  })

  it("cannot double if offer already pending", () => {
    const m: MatchState = {...newMatch(5), cubeOffer: "white"}
    expect(canOfferDouble(m, "black")).toBe(false)
  })

  it("cannot double after match has a winner", () => {
    const m: MatchState = {...newMatch(5), winner: "white"}
    expect(canOfferDouble(m, "white")).toBe(false)
  })

  it("offerDouble sets cubeOffer; cube value unchanged until accepted", () => {
    const m = newMatch(5)
    const after = offerDouble(m, "white")
    expect(after.cubeOffer).toBe("white")
    expect(after.cube.value).toBe(1)
  })

  it("offerDouble throws when not allowed", () => {
    const m: MatchState = {...newMatch(5), cube: {value: 64, owner: null}}
    expect(() => offerDouble(m, "white")).toThrow()
  })

  it("acceptDouble doubles value and transfers ownership", () => {
    const m = offerDouble(newMatch(5), "white")
    const after = acceptDouble(m)
    expect(after.cube).toEqual({value: 2, owner: "black"})
    expect(after.cubeOffer).toBeNull()
  })

  it("chained doubles: 1 → 2 → 4 → 8", () => {
    let m = newMatch(99)
    m = acceptDouble(offerDouble(m, "white")) // 2, owner black
    m = acceptDouble(offerDouble(m, "black")) // 4, owner white
    m = acceptDouble(offerDouble(m, "white")) // 8, owner black
    expect(m.cube).toEqual({value: 8, owner: "black"})
  })

  it("non-owner cannot redouble after cube is owned", () => {
    let m = newMatch(99)
    m = acceptDouble(offerDouble(m, "white")) // owner: black
    expect(canOfferDouble(m, "white")).toBe(false)
    expect(canOfferDouble(m, "black")).toBe(true)
  })

  it("dropDouble awards offerer the pre-double cube value, ends game", () => {
    const m = offerDouble(
      {...newMatch(7), cube: {value: 2, owner: "black"}},
      "black",
    )
    const after = dropDouble(m)
    expect(after.score).toEqual({white: 0, black: 2})
    expect(after.gameNumber).toBe(2)
    expect(after.cube).toEqual({value: 1, owner: null})
  })

  it("throws on accept/drop with no pending offer", () => {
    expect(() => acceptDouble(newMatch(5))).toThrow()
    expect(() => dropDouble(newMatch(5))).toThrow()
  })
})

describe("gameWonByBearOff scoring", () => {
  it("single win awards 1 × cube", () => {
    const m = newMatch(7)
    const s = makeBoard({off: {white: 15, black: 1}})
    const after = gameWonByBearOff(m, s, "white")
    expect(after.score.white).toBe(1)
  })

  it("gammon awards 2 × cube (cube=2 → 4 points)", () => {
    const m: MatchState = {...newMatch(7), cube: {value: 2, owner: "white"}}
    const s = makeBoard({off: {white: 15, black: 0}, points: {0: ["black", 15]}})
    const after = gameWonByBearOff(m, s, "white")
    expect(after.score.white).toBe(4)
  })

  it("backgammon awards 3 × cube", () => {
    const m = newMatch(11)
    const s = makeBoard({
      off: {white: 15, black: 0},
      bar: {black: 1},
      points: {0: ["black", 14]},
    })
    const after = gameWonByBearOff(m, s, "white")
    expect(after.score.white).toBe(3)
  })

  it("cube and offer reset between games", () => {
    const m: MatchState = {...newMatch(7), cube: {value: 4, owner: "black"}, cubeOffer: null}
    const s = makeBoard({off: {white: 15, black: 1}})
    const after = gameWonByBearOff(m, s, "white")
    expect(after.cube).toEqual({value: 1, owner: null})
    expect(after.cubeOffer).toBeNull()
  })

  it("match ends when a player reaches target", () => {
    const m: MatchState = {...newMatch(5), score: {white: 3, black: 0}}
    const s = makeBoard({off: {white: 15, black: 0}, points: {0: ["black", 15]}})
    const after = gameWonByBearOff(m, s, "white") // gammon × 1 = 2
    expect(after.winner).toBe("white")
    expect(after.score).toEqual({white: 5, black: 0})
  })

  it("game number stays put when match ends, advances otherwise", () => {
    const a: MatchState = {...newMatch(5), score: {white: 4, black: 0}, gameNumber: 5}
    const s = makeBoard({off: {white: 15, black: 1}})
    const afterMatchOver = gameWonByBearOff(a, s, "white") // 4 + 1 = 5 → match over
    expect(afterMatchOver.gameNumber).toBe(5)
    expect(afterMatchOver.winner).toBe("white")

    const b: MatchState = {...newMatch(7), score: {white: 1, black: 0}, gameNumber: 2}
    const afterContinues = gameWonByBearOff(b, s, "white")
    expect(afterContinues.gameNumber).toBe(3)
    expect(afterContinues.winner).toBeNull()
  })
})

describe("Crawford rule", () => {
  it("does not trigger when reaching scores below target-1", () => {
    const m = newMatch(5)
    const s = makeBoard({off: {white: 15, black: 1}}) // single → 1 pt
    const after = gameWonByBearOff(m, s, "white")
    expect(after.crawfordGameNumber).toBeNull()
  })

  it("triggers the next game when a player first reaches target-1", () => {
    const m: MatchState = {...newMatch(5), score: {white: 3, black: 0}, gameNumber: 4}
    const s = makeBoard({off: {white: 15, black: 1}}) // single → 1 → score 4 = target-1
    const after = gameWonByBearOff(m, s, "white")
    expect(after.crawfordGameNumber).toBe(5)
    expect(after.gameNumber).toBe(5)
    expect(isCrawfordGame(after)).toBe(true)
  })

  it("does not re-trigger after the first time", () => {
    let m: MatchState = {
      ...newMatch(7),
      score: {white: 6, black: 0},
      gameNumber: 7,
      crawfordGameNumber: 7,
    }
    const blackWins = makeBoard({off: {black: 15, white: 1}})
    m = gameWonByBearOff(m, blackWins, "black")
    expect(m.crawfordGameNumber).toBe(7)
    expect(m.gameNumber).toBe(8)
    expect(isCrawfordGame(m)).toBe(false)
  })

  it("canOfferDouble returns false during Crawford game", () => {
    const m: MatchState = {
      ...newMatch(5),
      gameNumber: 5,
      crawfordGameNumber: 5,
      score: {white: 4, black: 2},
    }
    expect(canOfferDouble(m, "white")).toBe(false)
    expect(canOfferDouble(m, "black")).toBe(false)
  })

  it("post-Crawford: doubling resumes", () => {
    const m: MatchState = {
      ...newMatch(7),
      gameNumber: 8,
      crawfordGameNumber: 7,
      score: {white: 6, black: 1},
    }
    expect(canOfferDouble(m, "white")).toBe(true)
    expect(canOfferDouble(m, "black")).toBe(true)
  })

  it("match can end during Crawford", () => {
    const m: MatchState = {
      ...newMatch(5),
      score: {white: 4, black: 2},
      gameNumber: 5,
      crawfordGameNumber: 5,
    }
    const s = makeBoard({off: {white: 15, black: 1}})
    const after = gameWonByBearOff(m, s, "white")
    expect(after.winner).toBe("white")
  })

  it("skips straight past target-1 when win is large enough", () => {
    // White at 0 wins backgammon × cube 2 = 6 in a target-7 match → goes to 6 = target-1 → Crawford
    const m: MatchState = {...newMatch(7), cube: {value: 2, owner: "black"}}
    const s = makeBoard({
      off: {white: 15, black: 0},
      bar: {black: 1},
      points: {0: ["black", 14]},
    })
    const after = gameWonByBearOff(m, s, "white")
    expect(after.score.white).toBe(6)
    expect(after.crawfordGameNumber).toBe(2)
  })

  it("no Crawford if player jumps directly past target-1 to victory", () => {
    // White at 4 wins backgammon × cube 1 = 3 in a target-5 → goes to 7, match over.
    // No Crawford ever set (skipped target-1 but match is over so it doesn't matter).
    const m: MatchState = {...newMatch(5), score: {white: 4, black: 0}}
    const s = makeBoard({
      off: {white: 15, black: 0},
      bar: {black: 1},
      points: {0: ["black", 14]},
    })
    const after = gameWonByBearOff(m, s, "white")
    expect(after.winner).toBe("white")
    // crawford remains null (match ended on this game; never reached target-1 going in)
    expect(after.crawfordGameNumber).toBeNull()
  })
})

describe("applyGameResult", () => {
  it("keeps cube max at 64 (no overflow into cube state)", () => {
    const m: MatchState = {...newMatch(99), cube: {value: 64, owner: "white"}}
    expect(() => acceptDouble({...m, cubeOffer: "white" as const})).toThrow()
  })

  it("voids cube state on game end regardless of prior value", () => {
    const m: MatchState = {...newMatch(99), cube: {value: 32, owner: "white"}}
    const s = makeBoard({off: {white: 15, black: 1}})
    const after = gameWonByBearOff(m, s, "white")
    expect(after.cube.value).toBe(1)
    expect(after.cube.owner).toBeNull()
  })
})
