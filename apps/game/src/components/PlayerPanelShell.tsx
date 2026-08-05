import {memo, type ReactNode} from "react"

type PlayerPanelShellProps = {
  side: "left" | "right",
  compact: boolean,
  isTurn?: boolean,
  identity: ReactNode,
  stats: ReactNode,
  timer: ReactNode,
  bottomSlot?: ReactNode,
  align: string,
}

export const PlayerPanelShell = memo(function PlayerPanelShell({
  side,
  compact,
  isTurn,
  identity,
  stats,
  timer,
  bottomSlot,
  align,
}: PlayerPanelShellProps) {
  const turnClass = isTurn ? "is-turn" : ""

  if (!compact) {
    return (
      <aside
        className={`game-player-panel game-player-panel--${side} ${turnClass}`}>
        <section className="game-player-card">
          <div className="game-player-card-glow"/>
          <div className="game-player-top">
            {identity}
          </div>

          <div className="game-stat-list">
            <img
              alt=""
              className="game-player-stats-art"
              draggable={false}
              src="/gameplay/premium-purple/player-stats.webp"/>
            {stats}
          </div>

          {timer}
        </section>
        {bottomSlot && <div className="game-panel-bottom">{bottomSlot}</div>}
      </aside>
    )
  }

  return (
    <aside
      className={`game-compact-panel game-player-panel--${side} ${turnClass} ${side === "right" ? "justify-self-end" : "justify-self-start"}`}>
      <div className="game-compact-top">
        {identity}
      </div>

      <div className="game-compact-stat-list">
        {stats}
      </div>

      {timer}
      {bottomSlot && <div className={`flex flex-col ${align} gap-2 w-full`}>{bottomSlot}</div>}
    </aside>
  )
})
