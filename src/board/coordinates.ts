export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly railWidth: number;
  readonly playLeft: number;
  readonly playWidth: number;
  readonly barX: number;
  readonly barWidth: number;
  readonly pointWidth: number;
  readonly pointHeight: number;
  readonly checkerRadius: number;
}

export function computeLayout(width: number, height: number): Layout {
  const railWidth = Math.round(width * 0.07);
  const playLeft = railWidth;
  const playWidth = width - 2 * railWidth;
  const barWidth = Math.round(playWidth * 0.08);
  const pointWidth = (playWidth - barWidth) / 12;
  const barX = playLeft + 6 * pointWidth;
  const pointHeight = Math.round(height * 0.44);
  const checkerRadius = Math.floor(pointWidth * 0.42);
  return {
    width,
    height,
    railWidth,
    playLeft,
    playWidth,
    barX,
    barWidth,
    pointWidth,
    pointHeight,
    checkerRadius,
  };
}

export interface PointPos {
  readonly x: number;
  readonly y: number;
  readonly stackDir: -1 | 1;
  readonly column: number;
}

export function pointCoords(layout: Layout, idx: number): PointPos {
  const isBottom = idx >= 12;
  const stackDir: -1 | 1 = isBottom ? -1 : 1;
  const column = isBottom ? idx - 12 : 11 - idx;

  const { playLeft, pointWidth, barWidth, height } = layout;
  const x =
    column < 6
      ? playLeft + (column + 0.5) * pointWidth
      : playLeft + 6 * pointWidth + barWidth + (column - 6 + 0.5) * pointWidth;
  const y = isBottom ? height : 0;
  return { x, y, stackDir, column };
}

export function checkerCenterY(
  layout: Layout,
  pos: PointPos,
  stackIndex: number,
  count: number
): number {
  const { checkerRadius, pointHeight } = layout;
  const diameter = 2 * checkerRadius;
  const usable = pointHeight - checkerRadius;
  const spacing = count > 5 ? usable / (count - 0.5) : diameter;
  return pos.y + pos.stackDir * (checkerRadius + stackIndex * spacing);
}
