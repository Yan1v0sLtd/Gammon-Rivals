import type {BoardState, Die} from "../../engine/src/types"

import {pickMove} from "./picker"
import type {AILevel} from "./types"

type PickRequest = {
  type: "pick",
  requestId: number,
  state: BoardState,
  remaining: Die[],
  level: AILevel,
}

self.addEventListener("message", (e: MessageEvent<PickRequest>) => {
  const data = e.data
  if (data?.type !== "pick") return
  try {
    const result = pickMove(data.state, data.remaining, data.level);
    (self as unknown as Worker).postMessage({
      type: "result",
      requestId: data.requestId,
      moves: result.moves,
      evaluation: result.evaluation,
    })
  }
  catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      requestId: data.requestId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
