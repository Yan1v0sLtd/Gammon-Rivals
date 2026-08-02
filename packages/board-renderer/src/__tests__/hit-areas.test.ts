import { describe, expect, it } from 'vitest';
import { BAR, OFF } from '@engine/types';
import { computeLayout, pointCoords, checkerCenter } from '../coordinates';
import {
  computeHitRects,
  destinationAnchorForEmptyPoint,
  hitTest,
} from '../hit-areas';
import { defaultTheme, premiumTheme, woodTheme } from '../theme';
import type { ThemeLayout } from '../theme';

// Marble-kingdom is a remote-only theme (the layout overrides live
// in `board_theme_configs.metadata`). It's the theme the user is
// actively running, so we test it here with the same layout payload
// that the live database returns.
const marbleKingdomLayout: ThemeLayout = {
  ...premiumTheme.layout,
  pointHeightRatio: 0.32,
  feltInnerTopLeftRatio: [0.1744, 0.082],
  feltInnerTopRightRatio: [0.8256, 0.087],
  checkerStackSpacingRatio: 0.68,
  feltInnerBottomLeftRatio: [0.1308, 0.9317],
  feltInnerBottomRightRatio: [0.8664, 0.9217],
};

// The themes that ship in code are tested directly; marble-kingdom
// is appended as a synthetic Theme so the same machinery exercises
// the live tilted layout.
const themesUnderTest = [
  { name: 'default', layout: defaultTheme.layout },
  { name: 'wood', layout: woodTheme.layout },
  { name: 'premium', layout: premiumTheme.layout },
  { name: 'marble-kingdom (tilted)', layout: marbleKingdomLayout },
];

// Two canvas sizes — a typical desktop board (16:10) and a portrait
// mobile-ish board — so we catch any aspect-ratio-only bug. Real
// players resize all over the place; if the hit map only works on
// one shape we'll keep getting reports.
const CANVAS_SIZES = [
  { label: '1200x720', width: 1200, height: 720 },
  { label: '900x675', width: 900, height: 675 },
  { label: '600x900', width: 600, height: 900 },
];

const ALL_POINT_POSITIONS: number[] = Array.from({ length: 24 }, (_, i) => i);

describe('hit-areas: every point is clickable on every theme', () => {
  for (const theme of themesUnderTest) {
    for (const size of CANVAS_SIZES) {
      describe(`${theme.name} @ ${size.label}`, () => {
        const layout = computeLayout(size.width, size.height, theme.layout);
        const rects = computeHitRects(layout);

        it('produces 27 hit rects (24 points + bar + 2 off trays)', () => {
          expect(rects.length).toBe(27);
        });

        it.each(ALL_POINT_POSITIONS)(
          'destination ring on empty point %i resolves to point %i',
          (idx) => {
            // For an empty target point we render the green ring at
            // the FIRST checker's centre. The renderer-side anchor
            // function is identical so this is exactly the pixel the
            // player taps when they click the green dot.
            const anchor = destinationAnchorForEmptyPoint(layout, 'white', idx);
            const hit = hitTest(rects, anchor.x, anchor.y);
            expect(hit, `expected point ${idx} (anchor ${anchor.x.toFixed(1)},${anchor.y.toFixed(1)})`).toBe(idx);
          },
        );

        it.each(ALL_POINT_POSITIONS)(
          'top-of-stack of point %i is still clickable when the point has 5 of own checkers',
          (idx) => {
            // After we've stacked our own checkers, the new
            // destination anchor moves further INTO the felt
            // (stackIdx grows). Verify the deep-stack click still
            // routes to the right idx.
            const ppos = pointCoords(layout, idx);
            const stackIdx = 5;
            const anchor = checkerCenter(layout, ppos, stackIdx, stackIdx + 1);
            const hit = hitTest(rects, anchor.x, anchor.y);
            expect(hit, `expected point ${idx} at stackIdx=5 (anchor ${anchor.x.toFixed(1)},${anchor.y.toFixed(1)})`).toBe(idx);
          },
        );

        it.each(ALL_POINT_POSITIONS)(
          'centre of point %i routes to %i',
          (idx) => {
            const ppos = pointCoords(layout, idx);
            const cx = ppos.x;
            // Use a y that's inside the playing area but not at the
            // very tip — the visual centre of the first checker.
            const anchor = checkerCenter(layout, ppos, 0, 1);
            const hit = hitTest(rects, cx, anchor.y);
            expect(hit).toBe(idx);
          },
        );

        it('bar clicks resolve to BAR', () => {
          const cx = layout.barX + layout.barWidth / 2;
          const cy = layout.height / 2;
          expect(hitTest(rects, cx, cy)).toBe(BAR);
        });

        it('bear-off tray clicks resolve to OFF', () => {
          // Black tray (top-right area)
          const blackTrayCx = layout.blackOffTrayX + 8;
          const blackTrayCy = layout.blackOffTrayTop + layout.blackOffTrayHeight / 2;
          expect(hitTest(rects, blackTrayCx, blackTrayCy)).toBe(OFF);

          // White tray (bottom-right area)
          const whiteTrayCx = layout.whiteOffTrayX + 8;
          const whiteTrayCy = layout.whiteOffTrayTop + layout.whiteOffTrayHeight / 2;
          expect(hitTest(rects, whiteTrayCx, whiteTrayCy)).toBe(OFF);
        });

        it('no point centre falls inside the OFF tray rect (regression: premium right rail bug)', () => {
          // The earlier "can't move to rightmost point" bug was the
          // OFF hit rectangle swallowing the centre of points whose
          // visual x crept into the right rail. Verify that for
          // every point, the click on its centre routes to the point
          // and NOT to OFF.
          for (const idx of ALL_POINT_POSITIONS) {
            const ppos = pointCoords(layout, idx);
            const anchor = checkerCenter(layout, ppos, 0, 1);
            const target = hitTest(rects, ppos.x, anchor.y);
            expect(target, `point ${idx} centre routes to OFF instead of ${idx}`).not.toBe(OFF);
            expect(target).toBe(idx);
          }
        });

        it('no two point hit rects horizontally overlap by more than 1 pixel', () => {
          // A small sliver of overlap is fine (boundary pixels); a
          // big overlap means one rect is swallowing another's
          // legitimate area. Compare same-row neighbours only.
          // Collect all overlaps before failing so the error
          // message shows the full picture, not just the first.
          const overlaps: string[] = [];
          for (let c = 0; c < 11; c++) {
            // The renderer pushes top row idx=11..idx=0 into rects
            // [0..11], so rects[idx] is the rect for that idx.
            const topA = rects.find((r) => r.target === (11 - c))!;
            const topB = rects.find((r) => r.target === (11 - c - 1))!;
            const botA = rects.find((r) => r.target === (12 + c))!;
            const botB = rects.find((r) => r.target === (12 + c + 1))!;

            // Skip the bar-crossing pair (c=5 → c=6) which is
            // separated by the bar hit rect.
            const isBarCrossing = c === 5;

            if (!isBarCrossing) {
              const topGap = Math.min(topA.left, topB.left) === topA.left
                ? topB.left - topA.right
                : topA.left - topB.right;
              const botGap = Math.min(botA.left, botB.left) === botA.left
                ? botB.left - botA.right
                : botA.left - botB.right;
              if (topGap < -1) {
                overlaps.push(`top idx ${topA.target} ↔ ${topB.target}: overlap ${(-topGap).toFixed(1)}px`);
              }
              if (botGap < -1) {
                overlaps.push(`bot idx ${botA.target} ↔ ${botB.target}: overlap ${(-botGap).toFixed(1)}px`);
              }
            }
          }
          expect(overlaps, overlaps.join('\n')).toEqual([]);
        });
      });
    }
  }
});
