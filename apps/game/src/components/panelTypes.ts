export type PanelMode = "hotseat" | "online"
export type PanelSeat = "self" | "opponent"

export type MatchProps = {
  readonly mode: PanelMode,
  readonly matchId?: string,
}

export type SeatProps = MatchProps & {
  readonly seat: PanelSeat,
  readonly compact?: boolean,
}
