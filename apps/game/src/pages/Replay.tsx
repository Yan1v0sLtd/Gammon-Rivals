import {useEffect} from "react"

import {Link, useParams, useSearchParams} from "react-router-dom"

import {BoardCanvas} from "../../../../packages/board-renderer/src/BoardCanvas"
import {pipCount} from "../../../../packages/engine/src/board"
import {useBoardThemeConfig} from "../features/lobby/boardTheme"
import {useGetReplayQuery} from "../features/replay/replayApi"
import type {MoveRow} from "../features/replay/replayData"
import {
  selectClampedPly, selectCurrentBoard, selectIsPlaying, selectTotalPlies, type SubMove,
} from "../features/replay/replaySelectors"
import {replayActions} from "../features/replay/replaySlice"
import {useAppDispatch, useAppSelector} from "../store/hooks"

import styles from "./Replay.module.css"

const MODE_LABEL: Record<string, string> = {
  hotseat: "Hot-seat",
  "ai-easy": "AI · Easy",
  "ai-medium": "AI · Medium",
  "ai-hard": "AI · Hard",
}

function describeTurn(moveRow: MoveRow): string {
  const dice = moveRow.dice.join("-")
  const subs = moveRow.sub_moves as unknown as readonly SubMove[]
  if (subs.length === 0) return `rolled ${dice}, no legal play`
  const parts = subs.map((s) => {
    const from = s.from === "bar" ? "bar" : String(s.from)
    const to = s.to === "off" ? "off" : String(s.to)
    const arrow = s.hit ? "×" : "→"
    return `${from}${arrow}${to}`
  })
  return `rolled ${dice}: ${parts.join(", ")}`
}

export function Replay() {
  const {gameId} = useParams<{gameId: string}>()
  const [params] = useSearchParams()
  const dispatch = useAppDispatch()

  const {
    data,
    error,
    isLoading,
  } = useGetReplayQuery(gameId ?? "", {skip: !gameId})

  useEffect(() => {
    if (!gameId) return
    dispatch(replayActions.replayRouteEntered())
    return () => {
      dispatch(replayActions.replayRouteExited())
    }
  }, [dispatch, gameId])

  const totalPlies = useAppSelector((s) => selectTotalPlies(s, data))
  const clampedPly = useAppSelector((s) => selectClampedPly(s, data))
  const currentBoard = useAppSelector((s) => selectCurrentBoard(s, data))
  const isPlaying = useAppSelector((s) => selectIsPlaying(s, data))

  const boardParam = params.get("board")
  const {theme: selectedTheme} = useBoardThemeConfig(boardParam)

  if (error) {
    return (<div className={styles.errorScreen}>
      <div className={styles.errorMessage}>Could not load replay: {error.message}</div>
      <Link
        className={styles.backLink}
        to="/profile">← Back</Link>
    </div>)
  }

  if (isLoading || !data || !currentBoard) {
    return (<div className={styles.loadingScreen}>
      <span className={styles.loadingText}>Loading replay…</span>
    </div>)
  }

  const turnDescription = clampedPly === 0 ? "starting position" : describeTurn(data.moves[clampedPly - 1])

  const modeLabel = MODE_LABEL[data.match.mode] ?? data.match.mode
  const winnerLine = data.game.winner ? `${data.game.winner} ${data.game.dropped_double ? "wins by drop" : data.game.win_type ?? "wins"} +${data.game.points_awarded}` : "unfinished"

  return (<div className={styles.page}>
    <header className={styles.header}>
      <Link
        className={styles.profileLink}
        to="/profile">← Profile</Link>
      <div className={styles.metaLine}>
        <span className={styles.pipWhite}>w {pipCount(currentBoard, "white")}</span>
        <span className={styles.metaSep}>·</span>
        <span className={styles.pipBlack}>b {pipCount(currentBoard, "black")} </span>
        <span className={styles.metaMode}>{modeLabel}</span>
        <span className={styles.metaGame}>game {data.game.game_number}</span>
        <span className={styles.metaWinner}>{winnerLine}</span>
      </div>
      <div className={styles.plyCounter}>
        ply {clampedPly} / {totalPlies}
      </div>
    </header>

    <div className={styles.boardArea}>
      <div className={styles.boardFrame}>
        <BoardCanvas
          state={currentBoard}
          theme={selectedTheme}/>
      </div>
    </div>

    <div className={styles.controls}>
      <div className={styles.turnDescription}>
        {clampedPly > 0 && (<>
          <strong className={styles.turnPlayer}>{data.moves[clampedPly - 1].player}</strong>{" "}
          {turnDescription}
        </>)}
        {clampedPly === 0 && <em>{turnDescription}</em>}
      </div>

      <input
        className={styles.seekSlider}
        max={totalPlies}
        min={0}
        type="range"
        value={clampedPly}
        onChange={(e) => dispatch(replayActions.replaySeek({
          ply: parseInt(e.target.value, 10),
          totalPlies,
        }))}/>

      <div className={styles.buttonRow}>
        <button
          className={styles.navButton}
          onClick={() => dispatch(replayActions.replaySeek({
            ply: 0,
            totalPlies,
          }))}>
          ⏮
        </button>
        <button
          className={styles.navButton}
          disabled={clampedPly === 0}
          onClick={() => dispatch(replayActions.replaySeek({
            ply: clampedPly - 1,
            totalPlies,
          }))}>
          ◀ prev
        </button>
        <button
          className={styles.playButton}
          onClick={() => {
            if (isPlaying) dispatch(replayActions.replayPause()); else dispatch(replayActions.replayPlay({totalPlies}))
          }}>
          {isPlaying ? "pause" : clampedPly >= totalPlies ? "replay" : "play"}
        </button>
        <button
          className={styles.navButton}
          disabled={clampedPly >= totalPlies}
          onClick={() => dispatch(replayActions.replaySeek({
            ply: clampedPly + 1,
            totalPlies,
          }))}>
          next ▶
        </button>
        <button
          className={styles.navButton}
          onClick={() => dispatch(replayActions.replaySeek({
            ply: totalPlies,
            totalPlies,
          }))}>
          ⏭
        </button>
      </div>
    </div>
  </div>)
}
