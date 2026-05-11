import SidePanel from './SidePanel';
import type { PlayerIdentity } from '../lib/identity';

interface PlayerSeat {
  identity: PlayerIdentity | null;
  pipCount?: number;
  scoreLabel?: string;
  isTurn?: boolean;
  hudSlot?: React.ReactNode;
  bottomSlot?: React.ReactNode;
}

interface Props {
  /** The opponent (top-of-screen / left side panel). */
  opponent: PlayerSeat;
  /** The local player (bottom-of-screen / right side panel). */
  self: PlayerSeat;
  /** Top header (status, match score, nav). */
  header?: React.ReactNode;
  /** The board itself — children render in the centre table. */
  children: React.ReactNode;
  /** Floating action row over the board (Roll / Double / Undo). */
  actionsOverlay?: React.ReactNode;
  /** Modal overlay (cube decision, end-of-game, etc.) — fills the centre. */
  centerOverlay?: React.ReactNode;
}

/**
 * Mobile-first game table. Narrow screens get compact player HUDs above
 * the board so the playing surface owns the viewport; wider screens grow
 * into the reference-style side panels around a large central board.
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
    <main className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-[radial-gradient(circle_at_center,#13243a_0%,#091525_58%,#050c17_100%)]">
      {header}

      <div className="relative flex-1 min-h-0 w-full px-2 pb-3 sm:px-3">
        <div className="mx-auto grid h-full w-full max-w-[1920px] grid-rows-[auto_minmax(0,1fr)] gap-2 2xl:grid-cols-[clamp(128px,15vw,230px)_minmax(0,1fr)_clamp(128px,15vw,230px)] 2xl:grid-rows-1 2xl:gap-3">
          <div className="z-20 flex items-start justify-between 2xl:hidden">
            <SidePanel side="left" compact {...opponent} />
            <SidePanel side="right" compact {...self} />
          </div>

          <div className="hidden min-h-0 2xl:block">
            <SidePanel side="left" {...opponent} />
          </div>

          <div className="relative min-h-0 min-w-0">
            <div className="absolute inset-0 flex items-start justify-center pt-1 2xl:items-center 2xl:pt-0">
              <div className="relative aspect-[4/3] h-auto max-h-full w-full max-w-[calc((100dvh-8.5rem)*1.333)] overflow-visible 2xl:max-w-none">
                <div className="absolute inset-0 rounded-[10px] bg-[#091525] shadow-[0_26px_70px_rgba(0,0,0,0.72)]" />
                <div className="absolute inset-0 overflow-visible rounded-[10px] ring-1 ring-black/50">
                  {children}
                </div>
              </div>
            </div>

            {actionsOverlay && (
              <div className="absolute inset-x-0 bottom-2 z-10 flex items-end justify-center pointer-events-none sm:bottom-4">
                <div className="pointer-events-auto">{actionsOverlay}</div>
              </div>
            )}

            {centerOverlay && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto">{centerOverlay}</div>
              </div>
            )}
          </div>

          <div className="hidden min-h-0 2xl:block">
            <SidePanel side="right" {...self} />
          </div>
        </div>
      </div>
    </main>
  );
}
