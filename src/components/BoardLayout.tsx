import SidePanel from './SidePanel';
import type { PlayerIdentity } from '../lib/identity';

interface PlayerSeat {
  identity: PlayerIdentity | null;
  pipCount?: number;
  scoreLabel?: string;
  isTurn?: boolean;
  bottomSlot?: React.ReactNode;
}

interface Props {
  /** The opponent (top-of-screen / left side panel). */
  opponent: PlayerSeat;
  /** The local player (bottom-of-screen / right side panel). */
  self: PlayerSeat;
  /** Top header (status, match score, nav). */
  header?: React.ReactNode;
  /** The board itself — children render in the centre column. */
  children: React.ReactNode;
  /** Floating action row over the board (Roll / Double / Undo). */
  actionsOverlay?: React.ReactNode;
  /** Modal overlay (cube decision, end-of-game, etc.) — fills the centre. */
  centerOverlay?: React.ReactNode;
}

/**
 * Mobile-first three-column layout: opponent panel | board | self panel.
 * The board fills the centre at full width; the panels are narrow enough
 * to keep the playing surface dominant on small screens, but wide enough
 * to show an avatar + name + pip count comfortably.
 *
 * On desktop the whole layout is centred in the viewport with a max
 * width — same composition, just bounded.
 */
export default function BoardLayout({
  opponent,
  self,
  header,
  children,
  actionsOverlay,
  centerOverlay,
}: Props) {
  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-[#0e1d2f] via-[#0a1424] to-[#06101c]">
      {header}

      <div className="flex-1 flex items-stretch justify-center px-1 sm:px-3 pb-2 sm:pb-3 min-h-0">
        <div
          className="relative w-full max-w-[1400px] grid items-stretch gap-1 sm:gap-2"
          style={{ gridTemplateColumns: 'minmax(72px, 110px) minmax(0, 1fr) minmax(72px, 110px)' }}
        >
          <SidePanel side="left" {...opponent} />

          <div className="relative min-w-0 min-h-0">
            {/* Board wrapper — slight tilt for that "tabletop" feel. */}
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ perspective: '1400px' }}
            >
              <div
                className="relative w-full h-full max-h-full aspect-[3/2] rounded-xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
                style={{
                  transform: 'rotateX(10deg)',
                  transformStyle: 'preserve-3d',
                }}
              >
                {children}
              </div>
            </div>

            {/* Floating action overlay (Roll/Double/Undo) — sits in front
                of the tilted board, NOT tilted itself, so buttons read flat. */}
            {actionsOverlay && (
              <div className="absolute inset-x-0 bottom-2 sm:bottom-4 flex items-end justify-center pointer-events-none z-10">
                <div className="pointer-events-auto">{actionsOverlay}</div>
              </div>
            )}

            {/* Center overlay (cube decision, end-of-game modals). */}
            {centerOverlay && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className="pointer-events-auto">{centerOverlay}</div>
              </div>
            )}
          </div>

          <SidePanel side="right" {...self} />
        </div>
      </div>
    </main>
  );
}
