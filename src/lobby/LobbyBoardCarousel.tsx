import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { LobbyBoard, LobbyBoardId } from './lobbyData';

interface LobbyBoardCarouselProps {
  readonly boards: readonly LobbyBoard[];
  readonly selectedId: LobbyBoardId;
  readonly onSelectedIdChange: (id: LobbyBoardId) => void;
  readonly onPlay: () => void;
}

export function LobbyBoardCarousel({
  boards,
  selectedId,
  onSelectedIdChange,
  onPlay,
}: LobbyBoardCarouselProps) {
  const [motion, setMotion] = useState<'next' | 'previous'>('next');
  const [motionKey, setMotionKey] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const dragPointerId = useRef<number | null>(null);

  // Render an empty placeholder until the lobby has at least one board
  // to show (e.g., while the Back Office query is still resolving, or
  // when no boards are enabled there). Returning early avoids touching
  // boards[0] / boards.length math on an empty array.
  if (boards.length === 0) {
    return (
      <section className="lobby-carousel-section relative mx-auto flex w-full max-w-[64rem] items-center justify-center overflow-visible">
        <div className="lobby-carousel-viewport flex aspect-[1.05/1] min-h-[25rem] w-full items-center justify-center text-[#ffd16f]/70 sm:aspect-[1.34/1] lg:min-h-[31rem] xl:min-h-[35rem]">
          <p className="px-6 text-center text-sm font-bold uppercase tracking-[0.18em]">
            Loading boards…
          </p>
        </div>
      </section>
    );
  }

  const selectedIndex = boards.findIndex((board) => board.id === selectedId);
  const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selected = boards[safeIndex]!;
  const previous = boards[(safeIndex - 1 + boards.length) % boards.length]!;
  const next = boards[(safeIndex + 1) % boards.length]!;

  const selectIndex = (nextIndex: number) => {
    if (nextIndex === safeIndex) return;
    const clockwiseDistance = (nextIndex - safeIndex + boards.length) % boards.length;
    setMotion(clockwiseDistance <= boards.length / 2 ? 'next' : 'previous');
    setMotionKey((value) => value + 1);
    onSelectedIdChange(boards[nextIndex]!.id);
  };

  const move = (direction: -1 | 1) => {
    setMotion(direction > 0 ? 'next' : 'previous');
    setMotionKey((value) => value + 1);
    onSelectedIdChange(boards[(safeIndex + direction + boards.length) % boards.length]!.id);
  };

  const resetDrag = () => {
    dragStartX.current = null;
    dragPointerId.current = null;
    setDragOffset(0);
    setIsDragging(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragStartX.current = event.clientX;
    dragPointerId.current = event.pointerId;
    setDragOffset(0);
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    const delta = event.clientX - dragStartX.current;
    setDragOffset(Math.max(-170, Math.min(170, delta)));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    const delta = event.clientX - dragStartX.current;
    if (
      dragPointerId.current !== null &&
      event.currentTarget.hasPointerCapture(dragPointerId.current)
    ) {
      event.currentTarget.releasePointerCapture(dragPointerId.current);
    }
    resetDrag();
    if (Math.abs(delta) < 42) return;
    move(delta < 0 ? 1 : -1);
  };

  const visibleBoards = [
    { board: previous, slot: 'previous' },
    { board: selected, slot: 'selected' },
    { board: next, slot: 'next' },
  ] as const;
  const carouselDragStyle = { '--drag-x': `${dragOffset}px` } as CSSProperties;

  return (
    <section className="lobby-carousel-section relative mx-auto w-full max-w-[64rem] overflow-visible">
      <div
        className="lobby-carousel-viewport relative aspect-[1.05/1] min-h-[25rem] touch-pan-y overflow-visible sm:aspect-[1.34/1] lg:min-h-[31rem] xl:min-h-[35rem]"
        data-dragging={isDragging ? 'true' : 'false'}
        style={carouselDragStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerCancel={() => {
          resetDrag();
        }}
        onPointerUp={handlePointerUp}
      >
        <div className="absolute inset-0 overflow-visible">
          {visibleBoards.map(({ board, slot }) => (
            <div
              key={`${slot}-${board.id}-${motionKey}`}
              data-motion={motion}
              data-slot={slot}
              className="lobby-carousel-board absolute left-1/2 top-[11%] aspect-[4/3] w-[60%] cursor-grab active:cursor-grabbing"
            >
              <img
                src={board.image}
                alt={slot === 'selected' ? `${board.name} board preview` : ''}
                className="lobby-carousel-board-image h-full w-full object-contain drop-shadow-[0_18px_16px_rgba(0,0,0,0.42)]"
                draggable={false}
              />
              {/* Lock icon roughly centred over the board image,
                  nudged 5 px upward. 10 % smaller than the previous
                  11 %. */}
              <img
                src="/lobby/carousel/lock.webp"
                alt=""
                className="lobby-carousel-board-lock pointer-events-none absolute left-1/2 top-[calc(50%-5px)] w-[10%] -translate-x-1/2 -translate-y-1/2 select-none drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)]"
                draggable={false}
              />
              {/* Black pill sitting near the bottom of the board, mostly
                  on the board with just a sliver extending below onto
                  the podium. Width is 40 % of the board. Lifted 30 px
                  off the board's bottom edge per the latest request. */}
              <img
                src="/lobby/carousel/pill.webp"
                alt=""
                className="lobby-carousel-board-pill pointer-events-none absolute bottom-[30px] left-1/2 w-[40%] -translate-x-1/2 translate-y-1/4 select-none"
                draggable={false}
              />
            </div>
          ))}
        </div>

        <img
          src="/lobby/holders/royal-holder.webp"
          alt=""
          className="pointer-events-none absolute bottom-[14%] left-1/2 z-[24] w-[72%] max-w-[47rem] -translate-x-1/2 select-none drop-shadow-[0_22px_24px_rgba(0,0,0,0.36)]"
          draggable={false}
        />

        <div className="absolute left-1/2 top-[3%] z-40 flex h-10 min-w-72 -translate-x-1/2 items-center justify-center bg-[linear-gradient(90deg,transparent,rgba(22,18,17,0.78)_22%,rgba(22,18,17,0.86)_50%,rgba(22,18,17,0.78)_78%,transparent)] px-12 drop-shadow-[0_5px_6px_rgba(0,0,0,0.34)]">
          <div className="font-display text-lg font-black uppercase tracking-[0.12em] text-[#ffe0a0] drop-shadow-[0_2px_0_rgba(0,0,0,0.45)]">
            {selected.name}
          </div>
        </div>

        <button
          type="button"
          aria-label="Previous board"
          onClick={() => move(-1)}
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute left-[14%] top-[43%] z-40 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border-[3px] border-[#d8a04f] bg-[radial-gradient(circle_at_38%_28%,#333942,#151820_70%)] text-4xl font-black leading-none text-[#ffd16f] shadow-[0_8px_14px_rgba(0,0,0,0.48),inset_0_2px_0_rgba(255,255,255,0.20),inset_0_-5px_0_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,216,116,0.18)] transition hover:scale-105 hover:brightness-110 active:scale-95"
        >
          <span className="-mt-1">‹</span>
        </button>
        <button
          type="button"
          aria-label="Next board"
          onClick={() => move(1)}
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute right-[14%] top-[43%] z-40 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border-[3px] border-[#d8a04f] bg-[radial-gradient(circle_at_38%_28%,#333942,#151820_70%)] text-4xl font-black leading-none text-[#ffd16f] shadow-[0_8px_14px_rgba(0,0,0,0.48),inset_0_2px_0_rgba(255,255,255,0.20),inset_0_-5px_0_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,216,116,0.18)] transition hover:scale-105 hover:brightness-110 active:scale-95"
        >
          <span className="-mt-1">›</span>
        </button>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onPlay}
          className="lobby-play-button absolute bottom-4 left-1/2 z-40 h-14 min-w-56 -translate-x-1/2 px-12 font-display text-2xl font-black uppercase tracking-[0.18em] text-[#132109] transition hover:brightness-110 active:translate-y-0.5"
        >
          Play
        </button>

        <div className="absolute bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center justify-center gap-4">
          {boards.map((board) => (
            <button
              key={board.id}
              type="button"
              aria-label={`Select ${board.name}`}
              aria-pressed={selected.id === board.id}
              onClick={() => selectIndex(boards.indexOf(board))}
              className={`h-4 w-4 rounded-full border border-white/80 transition ${
                selected.id === board.id
                  ? 'scale-125 bg-[#ffd35d] shadow-[0_0_8px_rgba(255,211,93,0.72)]'
                  : 'bg-white/72 shadow-[0_1px_3px_rgba(0,0,0,0.32)] hover:bg-white'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
