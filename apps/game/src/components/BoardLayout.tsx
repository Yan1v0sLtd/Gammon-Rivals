import {useIsMobileLayout} from "../lib/useMediaQuery"

type Props = {
  /** The opponent (top-of-screen / left side panel). */
  opponentPanel: React.ReactNode,
  /** The local player (bottom-of-screen / right side panel). */
  selfPanel: React.ReactNode,
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
  opponentPanel,
  selfPanel,
  header,
  children,
  actionsOverlay,
  centerOverlay,
  backgroundImage,
}: Props) {
  const isMobileLayout = useIsMobileLayout()

  return (
    <div className="game-screen">
      {backgroundImage && (
        <img
          alt=""
          className="game-background-image"
          draggable={false}
          src={backgroundImage}/>
      )}
      <div className="game-background-tone"/>

      <div className="game-content">
        {header}

        <div className="game-stage">
          {isMobileLayout ? (<div className="game-mobile-players">
            {opponentPanel}
            {selfPanel}
          </div>) : (<>
            <div className="game-side-slot game-side-slot--left">
              {opponentPanel}
            </div>

            <div className="game-side-slot game-side-slot--right">
              {selfPanel}
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
    </div>
  )
}
