import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AI_LEVEL_LABEL, type AILevel } from '../ai';

type OpponentChoice = 'hotseat' | AILevel;

const OPPONENTS: ReadonlyArray<{ value: OpponentChoice; label: string; sub: string }> = [
  { value: 'hotseat', label: 'Hot-seat', sub: 'Two humans, one device' },
  { value: 'easy', label: AI_LEVEL_LABEL.easy, sub: 'AI plays random legal moves' },
  { value: 'medium', label: AI_LEVEL_LABEL.medium, sub: 'AI uses positional heuristic' },
  { value: 'hard', label: AI_LEVEL_LABEL.hard, sub: 'AI looks one move ahead' },
];

const TARGETS: readonly number[] = [1, 3, 5, 7, 11];

export default function Home() {
  const navigate = useNavigate();
  const [opponent, setOpponent] = useState<OpponentChoice>('medium');
  const [target, setTarget] = useState<number>(7);

  const start = () => {
    const params = new URLSearchParams();
    params.set('opp', opponent);
    params.set('target', String(target));
    navigate(`/hotseat?${params.toString()}`);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-6 bg-gradient-to-b from-[#1a1410] to-[#0d0907]">
      <div className="text-center">
        <h1 className="font-display text-5xl text-board-accent mb-2">Backgammon</h1>
        <p className="text-board-felt/60 text-sm">Pick your opponent and match length.</p>
      </div>

      <div className="w-full max-w-md flex flex-col gap-6">
        <section>
          <div className="text-xs uppercase tracking-wider text-board-felt/50 mb-2">Opponent</div>
          <div className="grid grid-cols-2 gap-2">
            {OPPONENTS.map((o) => (
              <button
                key={o.value}
                onClick={() => setOpponent(o.value)}
                className={`flex flex-col items-start text-left p-3 rounded-md border transition ${
                  opponent === o.value
                    ? 'bg-amber-700/30 border-amber-500 text-board-accent'
                    : 'bg-board-felt/5 border-board-felt/20 text-board-felt/80 hover:border-board-felt/40'
                }`}
              >
                <div className="font-display text-base">{o.label}</div>
                <div className="text-[11px] text-board-felt/50">{o.sub}</div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="text-xs uppercase tracking-wider text-board-felt/50 mb-2">
            Match length
          </div>
          <div className="flex gap-2 flex-wrap">
            {TARGETS.map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className={`min-w-[3.5rem] py-2 px-3 rounded-md border transition font-display ${
                  target === t
                    ? 'bg-amber-700/30 border-amber-500 text-board-accent'
                    : 'bg-board-felt/5 border-board-felt/20 text-board-felt/80 hover:border-board-felt/40'
                }`}
              >
                {t === 1 ? '1 game' : `to ${t}`}
              </button>
            ))}
          </div>
        </section>

        <button
          onClick={start}
          className="mt-2 py-3 rounded-md bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 font-display text-lg shadow-lg border-2 border-amber-700 hover:brightness-110 active:scale-[0.98] transition"
        >
          Start
        </button>
      </div>
    </main>
  );
}
