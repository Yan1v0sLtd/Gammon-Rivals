import type {PlayerIdentity} from "../lib/identity"
import {useMediaQuery} from "../lib/useMediaQuery"

import {SidePanel} from "./SidePanel"

const MOBILE_LAYOUT_QUERY = "(max-aspect-ratio: 1.55/1)"

type PlayerSeat = {
  identity: PlayerIdentity | null,
  pipCount?: number,
  scoreLabel?: string,
  doublesLabel?: string,
  level?: number,
  stateLabel?: string,
  coinsLabel?: string,
  isTurn?: boolean,
  timerDeadlineMs?: number,
  timerDurationMs?: number,
  hudSlot?: React.ReactNode,
  bottomSlot?: React.ReactNode,
}

type Props = {
  /** The opponent (top-of-screen / left side panel). */
  opponent: PlayerSeat,
  /** The local player (bottom-of-screen / right side panel). */
  self: PlayerSeat,
  /** Top header (status, match score, nav). */
  header?: React.ReactNode,
  /** The board itself — children render in the centre table. */
  children: React.ReactNode,
  /** Floating action row over the board (Roll / Double / Undo). */
  actionsOverlay?: React.ReactNode,
  /** Modal overlay (cube decision, end-of-game, etc.) — fills the centre. */
  centerOverlay?: React.ReactNode,
  /** Dedicated gameplay background for the selected board, with lobby art as a fallback. */
  backgroundImage?: string,
}

/**
 * Mobile-first game table. Narrow screens get compact player HUDs above
 * the board so the playing surface owns the viewport; wider screens grow
 * into the reference-style side panels around a large central board.
 *
 * Only the layout matching the current aspect ratio is mounted — the hidden
 * variant is not rendered at all, so we don't build its panel DOM (avatars,
 * stat images, timers) on every screen.
 */
export function BoardLayout({
  opponent,
  self,
  header,
  children,
  actionsOverlay,
  centerOverlay,
  backgroundImage,
}: Props) {
  const isMobileLayout = useMediaQuery(MOBILE_LAYOUT_QUERY)

  return (<main className="game-screen">
    {backgroundImage && (<>
      <img
        alt=""
        className="game-background-image"
        draggable={false}
        src={backgroundImage}/>
    </>)}
    <div className="game-background-tone"/>

    <div className="game-content">
      {header}

      <div className="game-stage">
        {isMobileLayout ? (<div className="game-mobile-players">
          <SidePanel
            compact
            side="left"
            {...opponent} />
          <SidePanel
            compact
            side="right"
            {...self} />
        </div>) : (<>
          <div className="game-side-slot game-side-slot--left">
            <SidePanel
              side="left"
              {...opponent} />
          </div>

          <div className="game-side-slot game-side-slot--right">
            <SidePanel
              side="right"
              {...self} />
          </div>
        </>)}

        <div className="game-board-column">
          <div className="game-board-stage">
            <div className="game-board-shell">{children}</div>
          </div>

          {actionsOverlay && (<div className="game-actions-layer">
            <div className="game-actions-inner">{actionsOverlay}</div>
          </div>)}

          {centerOverlay && (<div className="game-center-layer">
            <div className="game-center-inner">{centerOverlay}</div>
          </div>)}
        </div>
      </div>
    </div>
  </main>)
}
