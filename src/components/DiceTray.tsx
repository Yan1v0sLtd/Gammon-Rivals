import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Die, DiceRoll } from '../engine/types';
import TumblingDieFace from './TumblingDieFace';

interface Props {
  roll: DiceRoll | null;
  remaining: readonly Die[];
  settleSide?: 'left' | 'right';
  placement?: 'board' | 'hud';
}

interface DiceDisplay {
  readonly value: Die;
  readonly used: boolean;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

type DiceStyle = CSSProperties & {
  '--dice-size': string;
  '--dice-start-x': string;
  '--dice-start-y': string;
  '--dice-hop-a-x': string;
  '--dice-hop-a-y': string;
  '--dice-hop-b-x': string;
  '--dice-hop-b-y': string;
  '--dice-hop-c-x': string;
  '--dice-hop-c-y': string;
  '--dice-bounce-x': string;
  '--dice-bounce-y': string;
  '--dice-end-x': string;
  '--dice-end-y': string;
  '--dice-start-rot': string;
  '--dice-hop-a-rot': string;
  '--dice-hop-b-rot': string;
  '--dice-mid-rot': string;
  '--dice-end-rot': string;
  '--dice-delay': string;
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromRoll(roll: DiceRoll): number {
  return ((roll[0] * 73856093) ^ (roll[1] * 19349663) ^ 0xa5a5a5a5) >>> 0;
}

function diceToShow(roll: DiceRoll, remaining: readonly Die[]): DiceDisplay[] {
  if (roll[0] === roll[1]) {
    const used = 4 - remaining.length;
    return Array.from({ length: 4 }, (_, index) => ({
      value: roll[0],
      used: index < used,
    }));
  }

  const remCopy = [...remaining];
  return ([roll[0], roll[1]] as const).map((value) => {
    const idx = remCopy.indexOf(value);
    if (idx >= 0) {
      remCopy.splice(idx, 1);
      return { value, used: false };
    }
    return { value, used: true };
  });
}

function useElementSize(element: HTMLDivElement | null): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    if (!element) return;
    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return size;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dieStyle({
  index,
  count,
  size,
  settleSide,
  placement,
  seed,
}: {
  index: number;
  count: number;
  size: Size;
  settleSide: 'left' | 'right';
  placement: 'board' | 'hud';
  seed: number;
}): DiceStyle {
  const width = Math.max(size.width, placement === 'hud' ? 160 : 720);
  const height = Math.max(size.height, placement === 'hud' ? 80 : 420);
  const side = settleSide === 'right' ? 1 : -1;
  const rand = seededRandom(seed + index * 977);
  const dieSize =
    placement === 'hud'
      ? clamp(width * 0.23, 30, 42)
      : clamp(width * 0.047, 30, 54);
  const clusterX =
    count === 4
      ? ((index % 2) - 0.5) * dieSize * 1.05
      : 0;
  const clusterY =
    count === 4
      ? (Math.floor(index / 2) - 0.5) * dieSize * 1.05
      : (index - (count - 1) / 2) * dieSize * 1.16;

  if (placement === 'hud') {
    return {
      '--dice-size': `${dieSize}px`,
      '--dice-start-x': `${(-0.5 + index / Math.max(1, count - 1)) * dieSize * 2.4}px`,
      '--dice-start-y': `${-dieSize * 0.3}px`,
      '--dice-hop-a-x': `${clusterX * 0.4}px`,
      '--dice-hop-a-y': `${clusterY - dieSize * 0.5}px`,
      '--dice-hop-b-x': `${clusterX * 0.8}px`,
      '--dice-hop-b-y': `${clusterY + dieSize * 0.18}px`,
      '--dice-hop-c-x': `${clusterX * 0.96}px`,
      '--dice-hop-c-y': `${clusterY - dieSize * 0.25}px`,
      '--dice-bounce-x': `${clusterX}px`,
      '--dice-bounce-y': `${clusterY + dieSize * 0.07}px`,
      '--dice-end-x': `${clusterX}px`,
      '--dice-end-y': `${clusterY}px`,
      '--dice-start-rot': `${side * (260 + rand() * 80)}deg`,
      '--dice-hop-a-rot': `${side * (360 + rand() * 80)}deg`,
      '--dice-hop-b-rot': `${side * (560 + rand() * 110)}deg`,
      '--dice-mid-rot': `${side * (620 + rand() * 140)}deg`,
      '--dice-end-rot': `${side * (8 + rand() * 10)}deg`,
      '--dice-delay': `${index * 55}ms`,
    };
  }

  const jitterX = (rand() - 0.5) * width * 0.05;
  const jitterY = (rand() - 0.5) * height * 0.1;
  const startX = side * width * 0.46;
  const startY = -height * 0.21 + jitterY;
  const hopAX = side * (width * -0.04 + jitterX);
  const hopAY = -height * (0.2 + rand() * 0.08);
  const hopBX = side * (width * 0.18 + jitterX * 0.45);
  const hopBY = height * (0.06 + rand() * 0.05);
  const endX = side * width * 0.405 - clusterX;
  const endY = height * 0.02 + clusterY;

  return {
    '--dice-size': `${dieSize}px`,
    '--dice-start-x': `${startX}px`,
    '--dice-start-y': `${startY}px`,
    '--dice-hop-a-x': `${hopAX}px`,
    '--dice-hop-a-y': `${hopAY}px`,
    '--dice-hop-b-x': `${hopBX}px`,
    '--dice-hop-b-y': `${hopBY}px`,
    '--dice-hop-c-x': `${endX * 0.88}px`,
    '--dice-hop-c-y': `${endY - dieSize * 0.32}px`,
    '--dice-bounce-x': `${endX * 0.98}px`,
    '--dice-bounce-y': `${endY + dieSize * 0.08}px`,
    '--dice-end-x': `${endX}px`,
    '--dice-end-y': `${endY}px`,
    '--dice-start-rot': `${side * (300 + rand() * 90)}deg`,
    '--dice-hop-a-rot': `${side * (420 + rand() * 100)}deg`,
    '--dice-hop-b-rot': `${side * (620 + rand() * 130)}deg`,
    '--dice-mid-rot': `${side * (820 + rand() * 160)}deg`,
    '--dice-end-rot': `${side * (7 + rand() * 12)}deg`,
    '--dice-delay': `${index * 58}ms`,
  };
}

// Pips are now drawn by <DieFace> as inline SVG sprites (DieFace.tsx).
// The old <DiePips> CSS-grid stack is gone; the SVG handles face,
// bevel, pip rendering and highlights in one element.

export default function DiceTray({
  roll,
  remaining,
  settleSide = 'right',
  placement = 'board',
}: Props) {
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const size = useElementSize(wrapperEl);
  const dice = useMemo(() => (roll ? diceToShow(roll, remaining) : []), [roll, remaining]);
  const rollKey = roll ? `${roll[0]}-${roll[1]}-${settleSide}-${placement}` : 'none';
  const seed = roll ? seedFromRoll(roll) : 0;

  if (roll === null) return null;

  const rootClass =
    placement === 'hud'
      ? 'game-dice-tray game-dice-tray--hud'
      : 'game-dice-tray game-dice-tray--board';

  if (size.width <= 0 || size.height <= 0) {
    return <div ref={setWrapperEl} className={rootClass} aria-hidden="true" />;
  }

  return (
    <div ref={setWrapperEl} className={rootClass} aria-label={`Dice roll ${roll[0]} and ${roll[1]}`}>
      <div key={rollKey} className="game-dice-stage">
        {dice.map((die, index) => (
          <span
            key={`${rollKey}-${index}`}
            className={die.used ? 'game-die is-used' : 'game-die'}
            style={dieStyle({
              index,
              count: dice.length,
              size,
              settleSide,
              placement,
              seed,
            })}
          >
            <span className="game-die-shadow" />
            <span className="game-die-cube">
              <span className="game-die-side game-die-side--right" />
              <span className="game-die-side game-die-side--bottom" />
              <span className="game-die-face">
                <TumblingDieFace
                  value={die.value}
                  variant="white"
                  delayMs={index * 58}
                  tumbleMs={720}
                  animate={!die.used}
                />
              </span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
