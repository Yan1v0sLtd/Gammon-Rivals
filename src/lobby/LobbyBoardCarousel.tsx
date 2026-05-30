import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type { LobbyBoard, LobbyBoardId } from './lobbyData';
import type { BoardOwnershipState } from './useUserBoardInventory';
import { PlayButton } from '../components/PlayButton';
import { UnlockPill } from '../components/UnlockPill';
import { useActivePodium } from './useActivePodium';

interface LobbyBoardCarouselProps {
  readonly boards: readonly LobbyBoard[];
  readonly selectedId: LobbyBoardId;
  readonly onSelectedIdChange: (id: LobbyBoardId) => void;
  readonly onPlay: () => void;
  readonly getBoardState: (board: LobbyBoard) => BoardOwnershipState;
  readonly onLockedTap: (board: LobbyBoard) => void;
  readonly onPurchaseTap: (board: LobbyBoard) => void;
  /** Player's current gem balance — decides whether tapping a
   *  gem-gated board's pill opens the purchase modal or expands a
   *  "Get more Gems" nudge. */
  readonly walletGems: number;
}

// A tap is a pointer event that travels less than this distance, total.
// Anything beyond gets treated as a drag.
const TAP_MAX_DISTANCE_PX = 8;

// Velocity is averaged across pointer-move samples within this window.
const VELOCITY_WINDOW_MS = 110;

// Default snap-back duration; scaled down for faster flicks.
const SNAP_DURATION_MS = 320;
const SNAP_MIN_DURATION_MS = 170;

// How far (in slot-units) the user has to drag, or how fast (slot-units/ms)
// they have to flick, to commit to the next/previous board on release.
const COMMIT_THRESHOLD_FRACTION = 0.18;
const COMMIT_THRESHOLD_VELOCITY = 0.0018;

// How many slots out from center we render. Beyond this, boards are dropped
// from the DOM. 2 gives the "next-next" peek that the original keyframes
// produced when transitioning.
const RENDER_RADIUS = 2;

// Fallback layout (matches the base .lobby-carousel-board CSS vars). Used
// before we've measured the actual values from CSS, and as a safety net if
// a custom property comes back as NaN.
interface Layout {
  readonly slotX: number;
  readonly slotScale: number;
  readonly slotRot: number;
  readonly farX: number;
  readonly farScale: number;
  readonly farRot: number;
}

const DEFAULT_LAYOUT: Layout = {
  slotX: 34,
  slotScale: 0.82,
  slotRot: 6,
  farX: 70,
  farScale: 0.72,
  farRot: 8,
};

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function modulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// Translate / scale / rotate for a board at signed continuous distance `d`
// from the centered slot. d=0 → centered; d=±1 → side slot; d=±2 → off-stage
// "incoming" position. Values between are linearly interpolated so dragging
// looks smooth at any sub-slot offset.
function boardTransform(d: number, layout: Layout): CSSProperties {
  const abs = Math.abs(d);
  const sign = abs === 0 ? 0 : Math.sign(d);

  const tx =
    abs <= 1
      ? lerp(0, layout.slotX, abs) * sign
      : lerp(layout.slotX, layout.farX, clamp(abs - 1, 0, 1)) * sign;

  const scale =
    abs <= 1
      ? lerp(1, layout.slotScale, abs)
      : lerp(layout.slotScale, layout.farScale, clamp(abs - 1, 0, 1));

  const rotMag =
    abs <= 1
      ? lerp(0, layout.slotRot, abs)
      : lerp(layout.slotRot, layout.farRot, clamp(abs - 1, 0, 1));
  const rot = rotMag * sign;

  // Fade boards out past the side slot so the "incoming" board ghosts in
  // rather than popping. Past RENDER_RADIUS we drop it entirely.
  const opacity =
    abs >= RENDER_RADIUS
      ? 0
      : abs > 1
      ? lerp(1, 0.5, clamp(abs - 1, 0, 1))
      : 1;

  // Stack so the centered board is on top, side boards behind, far behind.
  const zIndex = Math.max(0, Math.round(30 - abs * 10));

  return {
    transform: `translateX(-50%) translateX(${tx}%) scale(${scale}) rotate(${rot}deg)`,
    zIndex,
    opacity,
  };
}

function readLayoutFromSample(sample: HTMLElement | null): Layout {
  if (!sample) return DEFAULT_LAYOUT;
  const cs = getComputedStyle(sample);
  const pick = (name: string, fallback: number): number => {
    const raw = cs.getPropertyValue(name).trim();
    if (!raw) return fallback;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  // CSS stores prev/next rotations as signed values; we want magnitudes
  // (`Math.abs`) since the sign comes from `d` at render time.
  return {
    slotX: Math.abs(pick('--lobby-next-x', DEFAULT_LAYOUT.slotX)),
    slotScale: pick('--lobby-side-scale', DEFAULT_LAYOUT.slotScale),
    slotRot: Math.abs(pick('--lobby-next-rotation', DEFAULT_LAYOUT.slotRot)),
    farX: Math.abs(pick('--lobby-incoming-next-x', DEFAULT_LAYOUT.farX)),
    farScale: pick('--lobby-incoming-scale', DEFAULT_LAYOUT.farScale),
    farRot: Math.abs(pick('--lobby-incoming-next-rotation', DEFAULT_LAYOUT.farRot)),
  };
}

function layoutsEqual(a: Layout, b: Layout): boolean {
  return (
    a.slotX === b.slotX &&
    a.slotScale === b.slotScale &&
    a.slotRot === b.slotRot &&
    a.farX === b.farX &&
    a.farScale === b.farScale &&
    a.farRot === b.farRot
  );
}

interface DragState {
  pointerId: number;
  startX: number;
  startTime: number;
  startPosition: number;
  samples: { t: number; x: number }[];
  moved: boolean;
  tappedSignedIdx: number | null;
}

export function LobbyBoardCarousel({
  boards,
  selectedId,
  onSelectedIdChange,
  onPlay,
  getBoardState,
  // onLockedTap is unused — level-locked boards expand the centered
  // lock inline (UnlockPill), and the gem pill defers to it when the
  // player is under-level. Kept in the props type for LobbyScreen
  // back-compat, just not destructured.
  onPurchaseTap,
  walletGems,
}: LobbyBoardCarouselProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Global BO-managed podium (the stand under the board). Falls back to
  // the bundled royal-holder asset until Supabase resolves the active one.
  // A board with its own holder_image overrides this — see `podiumImage`
  // below, derived from the selected board.
  const activePodium = useActivePodium();

  // Continuous carousel position. round(position) mod boards.length is the
  // currently centered board; fractional part is drag/animation offset.
  const initialPosition = (() => {
    const idx = boards.findIndex((b) => b.id === selectedId);
    return idx >= 0 ? idx : 0;
  })();
  const [position, setPositionState] = useState(initialPosition);
  const positionRef = useRef(position);
  const setPosition = useCallback((value: number) => {
    positionRef.current = value;
    setPositionState(value);
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // True while an external selectedId change is being animated. Suppresses
  // mid-animation notifications back to the parent (which would otherwise
  // briefly report an id we're animating through, not toward).
  const externalAnimRef = useRef(false);

  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);

  // Which board has an expanded lock pill ("Reach level N to unlock")
  // or an expanded gem pill ("Get more Gems"). Only one of either at a
  // time; a click anywhere else collapses both. The pills stop
  // propagation on their own click, so this document listener only
  // fires for outside clicks.
  const [expandedLockId, setExpandedLockId] = useState<string | null>(null);
  const [expandedGemsId, setExpandedGemsId] = useState<string | null>(null);
  const expandLock = useCallback((id: string) => {
    setExpandedLockId(id);
    setExpandedGemsId(null);
  }, []);
  const expandGems = useCallback((id: string) => {
    setExpandedGemsId(id);
    setExpandedLockId(null);
  }, []);
  useEffect(() => {
    if (!expandedLockId && !expandedGemsId) return;
    const collapse = () => {
      setExpandedLockId(null);
      setExpandedGemsId(null);
    };
    document.addEventListener('click', collapse);
    return () => document.removeEventListener('click', collapse);
  }, [expandedLockId, expandedGemsId]);

  // ----- Animation control -----

  const cancelAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  // Animate `position` from current value to `target` over `duration` ms.
  // The optional `notifyOnLand` flag controls whether the parent is told
  // about the new selection when the animation lands. External-source
  // animations (driven by selectedId prop changes) pass `false` to avoid
  // echoing the same value back.
  const animateTo = useCallback(
    (target: number, duration: number, notifyOnLand: boolean) => {
      cancelAnimation();
      const from = positionRef.current;
      if (Math.abs(target - from) < 0.001 || duration <= 0) {
        setPosition(target);
        if (notifyOnLand) {
          // notify happens via the integer-landed effect below
        }
        return;
      }
      externalAnimRef.current = !notifyOnLand;

      // Eagerly notify the parent about the destination *at the start* of
      // the slide, so the lobby background can fade in parallel with the
      // carousel animation instead of waiting for it to land. The
      // integer-landed effect below guards on lastNotifiedRef, so it
      // won't double-fire when the slide actually finishes.
      if (notifyOnLand && boards.length > 0) {
        const targetIdx = modulo(Math.round(target), boards.length);
        const targetId = boards[targetIdx]!.id;
        if (targetId !== lastNotifiedRef.current) {
          lastNotifiedRef.current = targetId;
          onSelectedIdChange(targetId);
        }
      }

      const start = performance.now();
      const tick = (now: number) => {
        const t = clamp((now - start) / duration, 0, 1);
        const eased = easeOutCubic(t);
        const value = from + (target - from) * eased;
        if (t < 1) {
          setPosition(value);
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          animFrameRef.current = null;
          setPosition(target);
          externalAnimRef.current = false;
        }
      };
      animFrameRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation, setPosition, boards, onSelectedIdChange]
  );

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  // ----- CSS-var layout sync -----
  //
  // The slot positions / scales / rotations live in responsive CSS rules on
  // .lobby-carousel-board. We mirror them into state so the JS-driven
  // transforms match the breakpoint that's currently active.
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => {
      const sample = node.querySelector<HTMLElement>('.lobby-carousel-board');
      const next = readLayoutFromSample(sample);
      setLayout((prev) => (layoutsEqual(prev, next) ? prev : next));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(node);
    return () => obs.disconnect();
  }, [boards.length]);

  // ----- Parent <-> position sync -----

  const lastNotifiedRef = useRef<LobbyBoardId>(selectedId);

  // When parent flips selectedId externally (e.g. URL nav), animate the
  // carousel to that board along the shortest path around the loop.
  useEffect(() => {
    if (boards.length === 0) return;
    const idx = boards.findIndex((b) => b.id === selectedId);
    if (idx < 0) return;
    if (selectedId === lastNotifiedRef.current) return;
    lastNotifiedRef.current = selectedId;
    if (dragRef.current) return; // user is mid-drag; their pointer wins.
    const len = boards.length;
    const candidates = [idx, idx - len, idx + len];
    const current = positionRef.current;
    const target = candidates.reduce(
      (best, c) => (Math.abs(c - current) < Math.abs(best - current) ? c : best),
      candidates[0]!
    );
    if (Math.abs(target - current) < 0.001) return;
    animateTo(target, SNAP_DURATION_MS, false);
  }, [selectedId, boards, animateTo]);

  // When position lands on a new integer slot, tell the parent. Skipped
  // during external animations (otherwise we'd echo the same id back).
  useEffect(() => {
    if (boards.length === 0) return;
    if (externalAnimRef.current) return;
    // Only notify when we're settled near an integer (drag at rest, or
    // animation finished). Avoids flapping through ids during a multi-slot
    // tween.
    const distanceToInteger = Math.abs(position - Math.round(position));
    if (distanceToInteger > 0.001) return;
    const idx = modulo(Math.round(position), boards.length);
    const id = boards[idx]!.id;
    if (id === lastNotifiedRef.current) return;
    lastNotifiedRef.current = id;
    onSelectedIdChange(id);
  }, [position, boards, onSelectedIdChange]);

  // ----- Pointer handlers -----

  const slotWidthPx = useCallback((): number => {
    const node = viewportRef.current;
    if (!node) return 1;
    // One "slot" of carousel travel = the distance each board has to
    // translate to slide from one slot into the next. The CSS expresses
    // that translation as `translateX(slotX%)` of the BOARD's width — not
    // the viewport's — so a 1:1 finger-to-board-movement ratio requires
    // dividing finger pixels by the board's natural (untransformed) width
    // times slotX/100. offsetWidth ignores transform: scale().
    const sample = node.querySelector<HTMLElement>('.lobby-carousel-board');
    const boardWidthPx = sample?.offsetWidth ?? node.clientWidth * 0.6;
    return Math.max(40, (boardWidthPx * layout.slotX) / 100);
  }, [layout.slotX]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    cancelAnimation();
    const target = event.target as HTMLElement | null;
    const slotEl = target?.closest<HTMLElement>('[data-board-signed-idx]');
    const tappedSignedIdx = slotEl
      ? parseInt(slotEl.dataset.boardSignedIdx ?? '', 10)
      : null;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startTime: performance.now(),
      startPosition: positionRef.current,
      samples: [{ t: performance.now(), x: event.clientX }],
      moved: false,
      tappedSignedIdx: Number.isFinite(tappedSignedIdx) ? tappedSignedIdx : null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const now = performance.now();
    drag.samples.push({ t: now, x: event.clientX });
    while (drag.samples.length > 2 && now - drag.samples[0]!.t > VELOCITY_WINDOW_MS) {
      drag.samples.shift();
    }
    if (!drag.moved && Math.abs(dx) > TAP_MAX_DISTANCE_PX) {
      drag.moved = true;
      setIsDragging(true);
    }
    if (drag.moved) {
      // Swiping left (dx < 0) advances the carousel forward (position +).
      const delta = -dx / slotWidthPx();
      setPosition(drag.startPosition + delta);
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);

    // Tap path: the pointer barely moved. If they tapped a side board,
    // animate that board into the center; if they tapped the centered
    // board or empty space, do nothing.
    if (!drag.moved) {
      if (
        drag.tappedSignedIdx !== null &&
        drag.tappedSignedIdx !== Math.round(positionRef.current)
      ) {
        animateTo(drag.tappedSignedIdx, SNAP_DURATION_MS, true);
      }
      return;
    }

    // Drag path: decide whether to commit to a neighbouring slot or snap
    // back, based on both how far they dragged AND how fast they were
    // moving at release.
    const samples = drag.samples;
    let vxPxPerMs = 0;
    if (samples.length >= 2) {
      const first = samples[0]!;
      const last = samples[samples.length - 1]!;
      const dt = last.t - first.t;
      if (dt > 0) vxPxPerMs = (last.x - first.x) / dt;
    }
    const vSlotsPerMs = -vxPxPerMs / slotWidthPx();

    const draggedSlots = positionRef.current - drag.startPosition;
    let target: number;
    if (
      Math.abs(draggedSlots) >= COMMIT_THRESHOLD_FRACTION ||
      Math.abs(vSlotsPerMs) >= COMMIT_THRESHOLD_VELOCITY
    ) {
      // Step exactly one slot in whichever direction wins (drag or flick).
      // Limiting to one prevents a single hard flick from skipping past
      // several boards, which feels uncontrollable.
      const direction = Math.sign(draggedSlots || vSlotsPerMs) || 1;
      target = Math.round(drag.startPosition) + direction;
    } else {
      target = Math.round(drag.startPosition);
    }

    // Velocity-aware duration: a fast flick finishes the remaining travel
    // in less time, so the motion feels continuous with the user's hand
    // rather than bouncing through a fixed-length animation.
    const remaining = Math.abs(target - positionRef.current);
    const baseDuration = SNAP_DURATION_MS * clamp(remaining, 0.4, 1);
    const speedFactor = clamp(Math.abs(vSlotsPerMs) * 220, 0, 1);
    const duration = Math.max(SNAP_MIN_DURATION_MS, baseDuration * (1 - 0.55 * speedFactor));
    animateTo(target, duration, true);
  };

  // ----- Arrow / dot navigation -----

  // animateByOffset was used by the prev/next arrows that were
  // removed in v12. Kept as a comment placeholder so future
  // surfaces (e.g. keyboard arrow keys) can re-add a one-liner.
  // const animateByOffset = (delta: -1 | 1) => {
  //   cancelAnimation();
  //   animateTo(Math.round(positionRef.current) + delta, SNAP_DURATION_MS, true);
  // };

  const animateToBoardIdx = (idx: number) => {
    if (boards.length === 0) return;
    const len = boards.length;
    const candidates = [idx, idx - len, idx + len];
    const current = positionRef.current;
    const target = candidates.reduce(
      (best, c) => (Math.abs(c - current) < Math.abs(best - current) ? c : best),
      candidates[0]!
    );
    cancelAnimation();
    animateTo(target, SNAP_DURATION_MS, true);
  };

  // ----- Render -----

  // Empty placeholder (e.g. while Back Office query resolves).
  if (boards.length === 0) {
    return (
      <section className="lobby-carousel-section relative mx-auto flex w-full max-w-[64rem] items-center justify-center overflow-visible">
        <div
          ref={viewportRef}
          className="lobby-carousel-viewport flex aspect-[1.05/1] min-h-[25rem] w-full items-center justify-center text-[#ffd16f]/70 sm:aspect-[1.34/1] lg:min-h-[31rem] xl:min-h-[35rem]"
        >
          <p className="px-6 text-center text-sm font-bold uppercase tracking-[0.18em]">
            Loading boards…
          </p>
        </div>
      </section>
    );
  }

  // Build the list of rendered boards (signed index, distance from center).
  // We anchor on floor(position) so the leading edge of the drag always has
  // a "next" board to peek at. RENDER_RADIUS + 1 on the upper bound makes
  // sure that peek board exists when we're partway between slots.
  const baseIdx = Math.floor(position);
  type RenderedBoard = { board: LobbyBoard; signedIdx: number; d: number; key: string };
  const rendered: RenderedBoard[] = [];
  for (let off = -RENDER_RADIUS; off <= RENDER_RADIUS + 1; off++) {
    const signedIdx = baseIdx + off;
    const d = signedIdx - position;
    if (Math.abs(d) > RENDER_RADIUS + 0.05) continue;
    const wrappedIdx = modulo(signedIdx, boards.length);
    rendered.push({
      board: boards[wrappedIdx]!,
      signedIdx,
      d,
      // Lap-stable key: stays the same across re-renders for the same
      // logical board at the same loop iteration, so React reuses the
      // DOM node and the image doesn't flicker as the carousel scrolls.
      key: `${wrappedIdx}@${Math.floor(signedIdx / Math.max(1, boards.length))}`,
    });
  }

  const selectedBoardIdx = modulo(Math.round(position), boards.length);
  const selected = boards[selectedBoardIdx]!;
  // The centered board's own holder image wins; the global active podium
  // is the fallback when this board has no dedicated holder.
  const podiumImage = selected.holderImage || activePodium;
  // Show the inline PLAY button when the board is fully playable for
  // this user. Two states qualify:
  //   - 'owned'       — bought (or admin-granted) into inventory
  //   - 'free-unlock' — level requirement met AND no gem price, so
  //                     there's nothing to purchase. These play for free.
  // 'level-locked' shows the padlock; 'purchasable' shows the gem-price
  // PLAY-on-board check now lives inside the per-board loop
  // (showPlayHere combines isCenter with the same state check).
  // The pill / lock overlay logic for locked/purchasable boards
  // still uses getBoardState(board) inside the loop.

  return (
    <section className="lobby-carousel-section relative mx-auto w-full max-w-[64rem] overflow-visible">
      <div
        ref={viewportRef}
        className="lobby-carousel-viewport relative aspect-[1.05/1] min-h-[25rem] touch-pan-y overflow-visible sm:aspect-[1.34/1] lg:min-h-[31rem] xl:min-h-[35rem]"
        data-dragging={isDragging ? 'true' : 'false'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div className="absolute inset-0 overflow-visible">
          {rendered.map(({ board, signedIdx, d, key }) => {
            const state = getBoardState(board);
            // Two independent gates, two pills:
            //   showLock  (centered) → LEVEL gate. Only when the player
            //             is under the required level. Expands to
            //             "Reach level N to unlock".
            //   showGems  (bottom)   → GEM gate. Whenever the board
            //             costs gems (level-locked OR purchasable). Its
            //             tap behavior depends on state (see below).
            const showLock = state === 'level-locked';
            const showGems = state === 'level-locked' || state === 'purchasable';
            const isCenter = Math.abs(d) < 0.5;
            // PLAY button now lives ON the centered board (same as
            // the lock) — only renders when the board is playable
            // AND it's the visually-centred slot. Sharing the per-
            // board coordinate system means the play + lock use
            // identical centering math (top: calc(50% - 5px)) so
            // they visually swap into the same position depending
            // on the board's state.
            const showPlayHere =
              isCenter && (state === 'owned' || state === 'free-unlock');
            const style = boardTransform(d, layout);
            return (
              <div
                key={key}
                data-board-signed-idx={signedIdx}
                data-state={state}
                className="lobby-carousel-board absolute left-1/2 top-[11%] aspect-[4/3] w-[60%] cursor-grab active:cursor-grabbing [container-type:inline-size]"
                style={style}
              >
                <img
                  src={board.image}
                  alt={isCenter ? `${board.name} board preview` : ''}
                  className="lobby-carousel-board-image h-full w-full object-contain drop-shadow-[0_18px_16px_rgba(0,0,0,0.42)]"
                  draggable={false}
                />
                {showLock ? (
                  // Expandable lock pill. Collapsed size tracks the old
                  // w-[12%] lock via 12cqi (board is a container). Tap
                  // expands it inline to "Reach level N to unlock" using
                  // the board's real unlockLevel. Same centering math as
                  // the PLAY button.
                  <UnlockPill
                    variant="lock"
                    level={board.unlockLevel}
                    open={expandedLockId === board.id}
                    onOpen={() => expandLock(board.id)}
                    ariaLabel={`${board.name} locked`}
                    wrapStyle={{ fontSize: '12cqi' }}
                    wrapClassName="absolute left-1/2 top-[calc(50%-5px)] z-40 -translate-x-1/2 -translate-y-1/2"
                  />
                ) : null}
                {/* PLAY button on the centered + playable board. Same
                    `top: calc(50% - 5px)` / `-translate-y-1/2` math
                    as the lock so the two badges sit at exactly the
                    same visual position depending on board state.
                    Touch-event isolation (pointer/touch start+end
                    stopPropagation + touch-action: manipulation) is
                    needed because the carousel viewport calls
                    setPointerCapture on its own pointerdown, which
                    would otherwise eat the button's onClick on
                    Android WebView. */}
                {showPlayHere ? (
                  // Sized off the board's own width (container-query
                  // units — the board sets container-type: inline-size)
                  // so it tracks the previous percentage-based button
                  // instead of the viewport. Sparkles off to match the
                  // plain original. Same centering math as the lock.
                  <PlayButton
                    label="Play"
                    size="lg"
                    sparkles={false}
                    aria-label={`Play on ${board.name}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onTouchStart={(event) => event.stopPropagation()}
                    onTouchEnd={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPlay();
                    }}
                    style={{ touchAction: 'manipulation' }}
                    wrapStyle={{ fontSize: 'clamp(7px, 4.5cqi, 22px)' }}
                    wrapClassName="absolute left-1/2 top-[calc(50%-5px)] z-40 -translate-x-1/2 -translate-y-1/2"
                  />
                ) : null}
                {showGems ? (
                  // GEM gate pill (gem badge, bottom). Tap behavior:
                  //   under-level (level-locked) → expand the centered
                  //       LEVEL lock — you must clear the level first.
                  //   at-level + not enough gems → expand this pill to
                  //       "Get more Gems".
                  //   at-level + enough gems → open the purchase popup.
                  <UnlockPill
                    variant="gem"
                    text="Get more Gems"
                    open={expandedGemsId === board.id}
                    onOpen={() => {
                      if (state === 'level-locked') {
                        expandLock(board.id);
                      } else if (walletGems >= board.priceGems) {
                        onPurchaseTap(board);
                      } else {
                        expandGems(board.id);
                      }
                    }}
                    ariaLabel={`Unlock ${board.name} for ${board.priceGems} gems`}
                    wrapStyle={{ fontSize: '12cqi' }}
                    wrapClassName="absolute bottom-[8%] left-1/2 z-40 -translate-x-1/2"
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <img
          src={podiumImage}
          alt=""
          className="pointer-events-none absolute bottom-[14%] left-1/2 z-[24] w-[72%] max-w-[47rem] -translate-x-1/2 select-none drop-shadow-[0_22px_24px_rgba(0,0,0,0.36)]"
          draggable={false}
        />

        <div className="absolute left-1/2 top-[3%] z-40 flex h-10 min-w-72 -translate-x-1/2 items-center justify-center bg-[linear-gradient(90deg,transparent,rgba(22,18,17,0.78)_22%,rgba(22,18,17,0.86)_50%,rgba(22,18,17,0.78)_78%,transparent)] px-12 drop-shadow-[0_5px_6px_rgba(0,0,0,0.34)]">
          <div className="font-display text-lg font-black uppercase tracking-[0.12em] text-[#ffe0a0] drop-shadow-[0_2px_0_rgba(0,0,0,0.45)]">
            {selected.name}
          </div>
        </div>

        {/* Prev/Next navigation arrows removed per operator
            direction — board switching is now drag/swipe-only (and
            the bottom dot indicators handle taps for accessibility). */}

        {/* PLAY button used to live here at the carousel level
            (top: 44%). It now renders INSIDE the per-board container
            (see the loop above) using the same centering math as the
            .lobby-carousel-board-lock-button so the two badges swap
            into the exact same position. */}

        <div className="absolute bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center justify-center gap-4">
          {boards.map((board, idx) => (
            <button
              key={board.id}
              type="button"
              aria-label={`Select ${board.name}`}
              aria-pressed={selected.id === board.id}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => animateToBoardIdx(idx)}
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
