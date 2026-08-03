import { useCallback, useRef, useState } from 'react';
import type { FlightCurrency, RewardFlightSpec } from './RewardFlight';

/**
 * Flying-token spawner. Start/end coordinates are DOM measurements taken at
 * spawn time, so this stays in React (LobbyScreen renders the flights).
 */
export function useRewardFlights() {
  const [flights, setFlights] = useState<readonly RewardFlightSpec[]>([]);
  const nextFlightIdRef = useRef(0);

  /** Spawn `count` tokens flying from sourceEl to the matching wallet pill, staggered. */
  const spawnFlights = useCallback(
    (currency: FlightCurrency, sourceEl: Element, count: number) => {
      const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`);
      if (!target) return;
      const src = sourceEl.getBoundingClientRect();
      const dst = target.getBoundingClientRect();
      const startX = src.left + src.width / 2;
      const startY = src.top + src.height / 2;
      const endX = dst.left + dst.width / 2;
      const endY = dst.top + dst.height / 2;
      const additions: RewardFlightSpec[] = [];
      for (let i = 0; i < count; i++) {
        additions.push({
          id: nextFlightIdRef.current++,
          currency,
          startX: startX + (Math.random() - 0.5) * 14,
          startY: startY + (Math.random() - 0.5) * 14,
          endX,
          endY,
          delayMs: i * 70,
          durationMs: 800,
        });
      }
      setFlights((prev) => [...prev, ...additions]);
    },
    []
  );

  const removeFlight = useCallback((id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return { flights, spawnFlights, removeFlight };
}
