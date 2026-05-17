import {
  Application,
  Container,
  FillGradient,
  Graphics,
  Sprite,
  TilingSprite,
  Texture,
} from 'pixi.js';
import { BAR, OFF } from '../../engine/types';
import type { BoardState, Player, Position } from '../../engine/types';
import { checkerCenter, computeLayout, pointCoords, type Layout } from '../coordinates';
import type { LoadedTheme, ThemeAssetKey, ThemeColors, ThemeLayout } from '../theme';

export interface RenderSelection {
  readonly selectedFrom: Position | null;
  readonly validDestinations: readonly Position[];
  readonly legalOrigins: readonly Position[];
  readonly opponentOrigins?: readonly Position[];
  readonly opponentDestinations?: readonly Position[];
  readonly alignmentDebug?: AlignmentDebugSelection;
}

export interface AlignmentDebugSelection {
  readonly enabled: boolean;
  readonly side: 'top' | 'bottom';
  readonly column: number;
  readonly anchor: 'base' | 'tip' | 'topChecker';
  // 'point' (default) edits a point's geometry; 'offWhite' / 'offBlack'
  // switch the overlay + panel to edit one of the bear-off trays.
  readonly target?: 'point' | 'offWhite' | 'offBlack';
}

export type PointClickHandler = (pos: Position) => void;

interface CheckerSkip {
  readonly pos: Position;
  readonly owner: Player;
}

interface MoveAnimation {
  readonly owner: Player;
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
  readonly skip: CheckerSkip | null;
  readonly start: number;
  readonly duration: number;
}

interface DealItem {
  readonly owner: Player;
  readonly pos: number;
  readonly stackIndex: number;
  readonly count: number;
}

interface DealAnimation {
  readonly items: readonly DealItem[];
  readonly start: number;
  readonly itemDuration: number;
  readonly stagger: number;
  readonly totalDuration: number;
}

const DEAL_ITEM_DURATION_MS = 330;
const DEAL_TOTAL_MS = 1750;

// Deterministic LCG for reproducible "wood grain" patterns
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export class BoardRenderer {
  private readonly app: Application;
  private readonly root: Container;
  private layout: Layout;
  private themeLayout: ThemeLayout | undefined;
  private readonly loaded: LoadedTheme;
  private onPointClick: PointClickHandler | null = null;
  private previousState: BoardState | null = null;
  private currentState: BoardState | null = null;
  private currentSelection: RenderSelection | undefined;
  private animation: MoveAnimation | null = null;
  private dealAnimation: DealAnimation | null = null;
  private animationFrame: number | null = null;

  constructor(app: Application, loaded: LoadedTheme) {
    this.app = app;
    this.loaded = loaded;
    this.root = new Container();
    this.app.stage.addChild(this.root);
    this.themeLayout = loaded.theme.layout;
    this.layout = computeLayout(app.screen.width, app.screen.height, this.themeLayout);
  }

  resize(width: number, height: number) {
    this.layout = computeLayout(width, height, this.themeLayout);
  }

  setThemeLayout(themeLayout: ThemeLayout | undefined) {
    this.themeLayout = themeLayout;
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height, this.themeLayout);
  }

  setOnPointClick(fn: PointClickHandler | null) {
    this.onPointClick = fn;
  }

  render(state: BoardState, selection?: RenderSelection) {
    const alignmentMode = Boolean(selection?.alignmentDebug?.enabled);
    const shouldDeal =
      !alignmentMode &&
      this.isStartingPosition(state) &&
      (!this.previousState || !this.isStartingPosition(this.previousState));

    if (shouldDeal) {
      this.startDealAnimation(state);
    }

    if (this.previousState && this.previousState !== state) {
      this.animation = this.detectMoveAnimation(this.previousState, state);
      if (this.animation) this.startAnimationLoop();
    }
    this.previousState = state;
    this.currentState = state;
    this.currentSelection = selection;
    this.drawScene(state, selection);
  }

  private drawScene(state: BoardState, selection?: RenderSelection) {
    this.clearRoot();
    const hasBoardTexture = Boolean(this.texture('board'));
    if (hasBoardTexture) {
      this.drawBoardTexture();
    } else {
      this.drawFrame();
      this.drawRails();
      this.drawFelt();
      this.drawPoints();
      this.drawBar();
      this.drawHinges();
    }
    const animation = this.currentAnimation();
    const dealAnimation = this.currentDealAnimation();
    if (dealAnimation) {
      this.drawDealCheckers(dealAnimation);
    } else {
      this.drawCheckers(state, animation?.skip ?? null);
    }
    this.drawBarCheckers(state, animation?.skip ?? null);
    this.drawOffTrays(state, !hasBoardTexture, animation?.skip ?? null);
    if (selection) this.drawSelectionOverlay(state, selection);
    if (selection?.alignmentDebug?.enabled) {
      this.drawAlignmentDebugOverlay(state, selection.alignmentDebug);
    }
    if (animation) this.drawAnimatedChecker(animation);
    if (this.onPointClick) this.drawHitAreas(state);
  }

  private get colors(): ThemeColors {
    return this.loaded.theme.colors;
  }

  private texture(key: ThemeAssetKey): Texture | undefined {
    return this.loaded.textures[key];
  }

  private clearRoot() {
    const children = this.root.removeChildren();
    for (const child of children) {
      child.destroy({ children: true, texture: false, textureSource: false });
    }
  }

  private currentAnimation(): MoveAnimation | null {
    const animation = this.animation;
    if (!animation) return null;
    if (performance.now() - animation.start >= animation.duration) {
      this.animation = null;
      return null;
    }
    return animation;
  }

  private currentDealAnimation(): DealAnimation | null {
    const animation = this.dealAnimation;
    if (!animation) return null;
    if (performance.now() - animation.start >= animation.totalDuration) {
      this.dealAnimation = null;
      return null;
    }
    return animation;
  }

  private startAnimationLoop() {
    if (this.animationFrame !== null) return;

    const tick = () => {
      this.animationFrame = null;
      if ((!this.animation && !this.dealAnimation) || !this.currentState) return;
      this.drawScene(this.currentState, this.currentSelection);
      if (this.animation || this.dealAnimation) {
        this.animationFrame = requestAnimationFrame(tick);
      }
    };

    this.animationFrame = requestAnimationFrame(tick);
  }

  private startDealAnimation(state: BoardState) {
    const items = this.dealItems(state);
    if (items.length === 0) return;
    const stagger =
      items.length <= 1
        ? 0
        : Math.max(28, (DEAL_TOTAL_MS - DEAL_ITEM_DURATION_MS) / (items.length - 1));
    this.dealAnimation = {
      items,
      start: performance.now(),
      itemDuration: DEAL_ITEM_DURATION_MS,
      stagger,
      totalDuration: Math.min(2000, DEAL_ITEM_DURATION_MS + stagger * (items.length - 1)),
    };
    this.startAnimationLoop();
  }

  private dealItems(state: BoardState): readonly DealItem[] {
    const stacks: DealItem[][] = [];
    for (let pos = 0; pos < 24; pos++) {
      const point = state.points[pos];
      if (!point || !point.owner || point.count <= 0) continue;
      stacks.push(
        Array.from({ length: point.count }, (_, stackIndex) => ({
          owner: point.owner!,
          pos,
          stackIndex,
          count: point.count,
        }))
      );
    }
    stacks.sort((a, b) => {
      const aPos = pointCoords(this.layout, a[0]!.pos);
      const bPos = pointCoords(this.layout, b[0]!.pos);
      return aPos.y - bPos.y || aPos.x - bPos.x;
    });

    const items: DealItem[] = [];
    const tallest = Math.max(0, ...stacks.map((stack) => stack.length));
    for (let n = 0; n < tallest; n++) {
      for (const stack of stacks) {
        const item = stack[n];
        if (item) items.push(item);
      }
    }
    return items;
  }

  private isStartingPosition(state: BoardState): boolean {
    if (state.bar.white !== 0 || state.bar.black !== 0) return false;
    if (state.off.white !== 0 || state.off.black !== 0) return false;
    const expected: Record<number, readonly [Player, number]> = {
      0: ['white', 2],
      5: ['black', 5],
      7: ['black', 3],
      11: ['white', 5],
      12: ['black', 5],
      16: ['white', 3],
      18: ['white', 5],
      23: ['black', 2],
    };

    for (let idx = 0; idx < 24; idx++) {
      const point = state.points[idx];
      const exp = expected[idx];
      if (!exp) {
        if (point?.owner || point?.count) return false;
        continue;
      }
      if (!point || point.owner !== exp[0] || point.count !== exp[1]) return false;
    }
    return true;
  }

  private detectMoveAnimation(previous: BoardState, next: BoardState): MoveAnimation | null {
    const owner = previous.turn;
    const positions: Position[] = [
      ...Array.from({ length: 24 }, (_, idx) => idx),
      BAR,
      OFF,
    ];
    let from: Position | null = null;
    let to: Position | null = null;
    let totalAbsDelta = 0;

    for (const pos of positions) {
      const delta = this.checkerCount(next, pos, owner) - this.checkerCount(previous, pos, owner);
      totalAbsDelta += Math.abs(delta);
      if (delta === -1) {
        if (from !== null) return null;
        from = pos;
      } else if (delta === 1) {
        if (to !== null) return null;
        to = pos;
      } else if (delta !== 0) {
        return null;
      }
    }

    if (totalAbsDelta !== 2 || from === null || to === null) return null;

    const fromAnchor = this.checkerAnchor(previous, from, owner);
    const toAnchor = this.checkerAnchor(next, to, owner);
    if (!fromAnchor || !toAnchor) return null;

    return {
      owner,
      from: fromAnchor,
      to: toAnchor,
      skip: to === BAR ? null : { pos: to, owner },
      start: performance.now(),
      duration: 340,
    };
  }

  private checkerCount(state: BoardState, pos: Position, owner: Player): number {
    if (pos === BAR) return state.bar[owner];
    if (pos === OFF) return state.off[owner];
    const point = state.points[pos];
    return point?.owner === owner ? point.count : 0;
  }

  private checkerAnchor(
    state: BoardState,
    pos: Position,
    owner: Player
  ): { x: number; y: number } | null {
    if (pos === BAR) {
      const count = state.bar[owner];
      if (count <= 0) return null;
      return this.barCheckerAnchor(owner, count - 1);
    }
    if (pos === OFF) return this.offCheckerAnchor(owner, Math.max(0, state.off[owner] - 1));

    const point = state.points[pos];
    if (!point || point.owner !== owner || point.count <= 0) return null;
    const ppos = pointCoords(this.layout, pos);
    return checkerCenter(this.layout, ppos, point.count - 1, point.count);
  }

  private barCheckerAnchor(owner: Player, stackIndex: number): { x: number; y: number } {
    const { barX, barWidth, height, checkerRadius } = this.layout;
    const cx = barX + barWidth / 2;
    const diameter = 2 * checkerRadius;
    const cy =
      owner === 'white'
        ? height / 2 + checkerRadius + 6 + stackIndex * diameter
        : height / 2 - checkerRadius - 6 - stackIndex * diameter;
    return { x: cx, y: cy };
  }

  private offTrayMetrics(owner: Player) {
    const {
      blackOffTrayHeight,
      blackOffTrayTop,
      blackOffTrayX,
      checkerRadius,
      offCheckerStackSpacing,
      railWidth,
      whiteOffTrayHeight,
      whiteOffTrayTop,
      whiteOffTrayX,
    } = this.layout;
    const trayHeight = owner === 'black' ? blackOffTrayHeight : whiteOffTrayHeight;
    const trayTop = owner === 'black' ? blackOffTrayTop : whiteOffTrayTop;
    const trayX = owner === 'black' ? blackOffTrayX : whiteOffTrayX;
    const usable = Math.max(checkerRadius, trayHeight - checkerRadius * 2);
    return {
      x: trayX,
      top: trayTop,
      width: Math.max(checkerRadius * 2.3, railWidth * 0.36),
      height: trayHeight,
      step: Math.min(checkerRadius * offCheckerStackSpacing, usable / 14),
    };
  }

  private offCheckerAnchor(owner: Player, stackIndex = 0): { x: number; y: number } {
    const { checkerRadius } = this.layout;
    const tray = this.offTrayMetrics(owner);
    return {
      x: tray.x,
      y:
        owner === 'black'
          ? tray.top + checkerRadius + stackIndex * tray.step
          : tray.top + tray.height - checkerRadius - stackIndex * tray.step,
    };
  }

  private drawAnimatedChecker(animation: MoveAnimation) {
    const raw = Math.min(1, (performance.now() - animation.start) / animation.duration);
    const eased = 1 - Math.pow(1 - raw, 3);
    const lift = Math.sin(raw * Math.PI) * this.layout.checkerRadius * 0.55;
    const x = animation.from.x + (animation.to.x - animation.from.x) * eased;
    const y = animation.from.y + (animation.to.y - animation.from.y) * eased - lift;
    this.drawChecker(x, y, animation.owner);
  }

  private drawBoardTexture() {
    const tex = this.texture('board');
    if (!tex) return;
    const { width, height } = this.layout;
    const sprite = new Sprite(tex);
    sprite.width = width;
    sprite.height = height;
    this.root.addChild(sprite);
  }

  /**
   * Procedural wood grain. Draws horizontal stripes of varying alpha/thickness
   * over an existing rectangle. Deterministic per-seed.
   */
  private drawWoodGrain(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    seed: number,
    direction: 'horizontal' | 'vertical' = 'horizontal'
  ) {
    const rand = lcg(seed);
    const span = direction === 'horizontal' ? h : w;
    const numStripes = Math.max(8, Math.floor(span / 6));

    for (let i = 0; i < numStripes; i++) {
      const t = (i + rand() * 0.6) / numStripes;
      const offset = t * span;
      const thickness = 0.6 + rand() * 1.6;
      const alpha = 0.04 + rand() * 0.10;
      const dark = rand() > 0.5;
      const color = dark ? 0x000000 : 0xffffff;

      if (direction === 'horizontal') {
        g.rect(x, y + offset, w, thickness).fill({ color, alpha });
      } else {
        g.rect(x + offset, y, thickness, h).fill({ color, alpha });
      }
    }
  }

  private drawFrame() {
    const { width, height } = this.layout;
    const tex = this.texture('frame');
    if (tex) {
      const sprite = new TilingSprite({ texture: tex, width, height });
      this.root.addChild(sprite);
      return;
    }
    const grad = new FillGradient(0, 0, 0, height);
    grad.addColorStop(0, this.colors.frameLight);
    grad.addColorStop(0.55, this.colors.frameDark);
    grad.addColorStop(1, this.colors.frameLight);

    const g = new Graphics();
    g.rect(0, 0, width, height).fill(grad);
    this.drawWoodGrain(g, 0, 0, width, height, 7919, 'horizontal');

    // Bevel highlights — top/bottom edges
    g.rect(0, 0, width, 3).fill({ color: this.colors.frameBevel, alpha: 0.7 });
    g.rect(0, height - 3, width, 3).fill({ color: 0x000000, alpha: 0.5 });
    this.root.addChild(g);
  }

  private drawRails() {
    const { width, height, railWidth } = this.layout;
    const tex = this.texture('rail');
    if (tex) {
      const left = new TilingSprite({ texture: tex, width: railWidth, height });
      const right = new TilingSprite({
        texture: tex,
        width: railWidth,
        height,
        x: width - railWidth,
      });
      this.root.addChild(left, right);
      return;
    }
    const g = new Graphics();

    const gradL = new FillGradient(0, 0, railWidth, 0);
    gradL.addColorStop(0, this.colors.frameDark);
    gradL.addColorStop(0.55, this.colors.rail);
    gradL.addColorStop(1, this.colors.frameInnerEdge);
    g.rect(0, 0, railWidth, height).fill(gradL);
    this.drawWoodGrain(g, 0, 0, railWidth, height, 1709, 'vertical');

    const gradR = new FillGradient(0, 0, railWidth, 0);
    gradR.addColorStop(0, this.colors.frameInnerEdge);
    gradR.addColorStop(0.45, this.colors.rail);
    gradR.addColorStop(1, this.colors.frameDark);
    g.rect(width - railWidth, 0, railWidth, height).fill(gradR);
    this.drawWoodGrain(g, width - railWidth, 0, railWidth, height, 4129, 'vertical');

    this.root.addChild(g);
  }

  private drawFelt() {
    const { playLeft, playWidth, height } = this.layout;
    const tex = this.texture('felt');
    if (tex) {
      const sprite = new TilingSprite({ texture: tex, width: playWidth, height, x: playLeft });
      this.root.addChild(sprite);
      return;
    }
    const g = new Graphics();
    g.rect(playLeft, 0, playWidth, height).fill(this.colors.felt);

    // Vignette: darker stripes at top/bottom edges
    const edge = 14;
    const vigTop = new FillGradient(playLeft, 0, playLeft, edge);
    vigTop.addColorStop(0, this.colors.feltVignette);
    vigTop.addColorStop(1, { r: 0, g: 0, b: 0, a: 0 });
    g.rect(playLeft, 0, playWidth, edge).fill(vigTop);

    const vigBot = new FillGradient(playLeft, height - edge, playLeft, height);
    vigBot.addColorStop(0, { r: 0, g: 0, b: 0, a: 0 });
    vigBot.addColorStop(1, this.colors.feltVignette);
    g.rect(playLeft, height - edge, playWidth, edge).fill(vigBot);

    // Inner dark seam between frame and felt
    g.rect(playLeft - 2, 0, 2, height).fill(this.colors.frameInnerEdge);
    g.rect(playLeft + playWidth, 0, 2, height).fill(this.colors.frameInnerEdge);

    // Bright gold bevel hairline on the felt side of the seam
    g.rect(playLeft, 0, 1, height).fill({ color: this.colors.brass, alpha: 0.55 });
    g.rect(playLeft + playWidth - 1, 0, 1, height).fill({ color: this.colors.brass, alpha: 0.55 });
    this.root.addChild(g);
  }

  private drawPoints() {
    const { pointWidth, topPointHeight, bottomPointHeight } = this.layout;
    const lightTex = this.texture('pointLight');
    const darkTex = this.texture('pointDark');

    for (let i = 0; i < 24; i++) {
      const pos = pointCoords(this.layout, i);
      const isLight = pos.column % 2 === 0;
      const tex = isLight ? lightTex : darkTex;
      // Per-row depth so editing "Point depth (bottom)" only affects
      // the bottom-row triangles (and the same for top).
      const pointHeight = pos.stackDir === 1 ? topPointHeight : bottomPointHeight;

      if (tex) {
        const sprite = new Sprite(tex);
        sprite.width = pointWidth;
        sprite.height = pointHeight;
        sprite.anchor.set(0.5, 0);
        sprite.x = pos.x;
        sprite.y = pos.stackDir === 1 ? pos.y : pos.y - pointHeight;
        if (pos.stackDir === -1) sprite.scale.y = -Math.abs(sprite.scale.y);
        this.root.addChild(sprite);
        continue;
      }

      const baseColor = isLight ? this.colors.pointLightBase : this.colors.pointDarkBase;
      const tipColor = isLight ? this.colors.pointLightTip : this.colors.pointDarkTip;
      const tipY = pos.y + pos.stackDir * pointHeight;

      const grad = new FillGradient(pos.x, pos.y, pos.x, tipY);
      grad.addColorStop(0, baseColor);
      grad.addColorStop(0.85, tipColor);
      grad.addColorStop(1, tipColor);

      const g = new Graphics();
      g.poly([
        pos.x - pointWidth / 2, pos.y,
        pos.x + pointWidth / 2, pos.y,
        pos.x, tipY,
      ])
        .fill(grad)
        .stroke({ color: this.colors.pointOutline, width: 1, alpha: 0.45 });

      // Subtle inner highlight along the long edges of the triangle
      const edgeAlpha = isLight ? 0.25 : 0.15;
      const edgeColor = isLight ? 0xffffff : this.colors.brassDark;
      g.moveTo(pos.x - pointWidth / 2 + 1, pos.y)
        .lineTo(pos.x, tipY)
        .stroke({ color: edgeColor, width: 1, alpha: edgeAlpha });
      this.root.addChild(g);
    }
  }

  private drawBar() {
    const { barX, barWidth, height } = this.layout;
    const tex = this.texture('bar');
    if (tex) {
      const sprite = new TilingSprite({ texture: tex, width: barWidth, height, x: barX });
      this.root.addChild(sprite);
      return;
    }
    const grad = new FillGradient(barX, 0, barX + barWidth, 0);
    grad.addColorStop(0, this.colors.frameInnerEdge);
    grad.addColorStop(0.5, this.colors.barHighlight);
    grad.addColorStop(1, this.colors.frameInnerEdge);

    const g = new Graphics();
    g.rect(barX, 0, barWidth, height).fill(grad);
    this.drawWoodGrain(g, barX, 0, barWidth, height, 2389, 'vertical');

    // Brass corner caps where bar meets frame top/bottom
    const capW = barWidth * 1.05;
    const capH = barWidth * 0.35;
    const cx = barX + barWidth / 2;
    const capGradTop = new FillGradient(0, 0, 0, capH);
    capGradTop.addColorStop(0, this.colors.brass);
    capGradTop.addColorStop(1, this.colors.brassDark);
    g.roundRect(cx - capW / 2, 0, capW, capH, 2).fill(capGradTop);

    const capGradBot = new FillGradient(0, 0, 0, capH);
    capGradBot.addColorStop(0, this.colors.brassDark);
    capGradBot.addColorStop(1, this.colors.brass);
    g.roundRect(cx - capW / 2, height - capH, capW, capH, 2).fill(capGradBot);

    this.root.addChild(g);
  }

  private drawHinges() {
    const { barX, barWidth, height } = this.layout;
    const tex = this.texture('hinge');
    const cx = barX + barWidth / 2;
    const hingeW = barWidth * 1.6;
    const hingeH = Math.min(barWidth * 1.1, height * 0.05);
    const positions = [height * 0.18, height - height * 0.18 - hingeH];

    for (const top of positions) {
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.width = hingeW;
        sprite.height = hingeH;
        sprite.anchor.set(0.5, 0);
        sprite.x = cx;
        sprite.y = top;
        this.root.addChild(sprite);
        continue;
      }

      const g = new Graphics();
      const plateGrad = new FillGradient(0, top, 0, top + hingeH);
      plateGrad.addColorStop(0, this.colors.brass);
      plateGrad.addColorStop(0.4, 0xf5d56a);
      plateGrad.addColorStop(0.65, this.colors.brass);
      plateGrad.addColorStop(1, this.colors.brassDark);

      g.roundRect(cx - hingeW / 2, top, hingeW, hingeH, hingeH * 0.25).fill(plateGrad);
      g.roundRect(cx - hingeW / 2, top, hingeW, hingeH, hingeH * 0.25).stroke({
        color: this.colors.brassDark,
        width: 1.5,
      });

      // Four rivets — corners
      const rivetR = hingeH * 0.13;
      const padX = hingeH * 0.5;
      const padY = hingeH * 0.28;
      const rivets: Array<[number, number]> = [
        [cx - hingeW / 2 + padX, top + padY],
        [cx + hingeW / 2 - padX, top + padY],
        [cx - hingeW / 2 + padX, top + hingeH - padY],
        [cx + hingeW / 2 - padX, top + hingeH - padY],
      ];
      for (const [rx, ry] of rivets) {
        g.circle(rx, ry, rivetR).fill(this.colors.brassDark);
        g.circle(rx - rivetR * 0.3, ry - rivetR * 0.3, rivetR * 0.35).fill({
          color: 0xffffff,
          alpha: 0.4,
        });
      }
      this.root.addChild(g);
    }
  }

  private drawCheckers(state: BoardState, skip: CheckerSkip | null = null) {
    for (let i = 0; i < 24; i++) {
      const point = state.points[i];
      if (!point || point.count === 0 || point.owner === null) continue;
      const pos = pointCoords(this.layout, i);
      // Bottom-row spikes point UP; the bottom of the stack (n=0) is
      // closest to the camera in the slight 3-D tilt, so it should be
      // drawn LAST (on top in z). Reverse the iteration order for those.
      // Top-row spikes already match the natural order — the spike's
      // tip end (n=count-1) is closest to the camera there.
      const reverse = pos.stackDir === -1;
      for (let k = 0; k < point.count; k++) {
        const n = reverse ? point.count - 1 - k : k;
        if (skip?.pos === i && skip.owner === point.owner && n === point.count - 1) continue;
        const center = checkerCenter(this.layout, pos, n, point.count);
        // Bottom-row base (n=0) sits flush against the wooden rail —
        // its shadow would extend past the felt onto the wood frame
        // and read as an artifact. Skip the shadow on that one.
        const withShadow = !(pos.stackDir === -1 && n === 0);
        this.drawChecker(center.x, center.y, point.owner, withShadow);
      }
    }
  }

  private drawDealCheckers(animation: DealAnimation) {
    const elapsed = performance.now() - animation.start;
    const source = {
      x: this.layout.width * 0.5,
      y: Math.max(this.layout.checkerRadius * 1.2, this.layout.height * 0.07),
    };

    for (let idx = 0; idx < animation.items.length; idx++) {
      const item = animation.items[idx]!;
      const itemElapsed = elapsed - idx * animation.stagger;
      if (itemElapsed < 0) continue;

      const pos = pointCoords(this.layout, item.pos);
      const target = checkerCenter(this.layout, pos, item.stackIndex, item.count);
      const t = Math.min(1, itemElapsed / animation.itemDuration);
      const eased = 1 - Math.pow(1 - t, 3);
      const lift = Math.sin(t * Math.PI) * this.layout.checkerRadius * 0.6;
      const fan = (idx % 5 - 2) * this.layout.checkerRadius * 0.18;
      const x = source.x + fan * (1 - eased) + (target.x - source.x) * eased;
      const y = source.y + (target.y - source.y) * eased - lift;
      this.drawChecker(x, y, item.owner);
    }
  }

  private drawChecker(x: number, y: number, owner: Player, withShadow = true) {
    const r = this.layout.checkerRadius;
    const ry = r * this.layout.checkerScaleY;
    const tex = this.texture(owner === 'white' ? 'whiteChecker' : 'blackChecker');

    if (withShadow) {
      // Soft half-circle shadow tucked UNDERNEATH the checker. The chord
      // sits inside the checker's lower portion so the upper half of the
      // shadow is hidden behind the disc itself — the visible bottom
      // half reads as the checker's cast shadow on the felt rather than
      // a separate puddle floating below. Three concentric half-discs
      // at falling alpha + decreasing radius fake the soft edge.
      const cx = x;
      const cy = y + ry * 0.35;
      const shadow = new Graphics();
      const drawHalfDisc = (radius: number, alpha: number) => {
        shadow.moveTo(cx + radius, cy);
        shadow.arc(cx, cy, radius, 0, Math.PI);
        shadow.lineTo(cx + radius, cy);
        shadow.fill({ color: 0x000000, alpha });
      };
      drawHalfDisc(r * 1.05, 0.18);
      drawHalfDisc(r * 0.92, 0.28);
      drawHalfDisc(r * 0.78, 0.38);
      this.root.addChild(shadow);
    }

    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.x = x;
      sprite.y = y;
      sprite.width = r * 2;
      sprite.height = r * 2 * this.layout.checkerScaleY;
      this.root.addChild(sprite);
      return;
    }

    const c = this.colors;
    const rim = owner === 'white' ? c.whiteCheckerRim : c.blackCheckerRim;
    const light = owner === 'white' ? c.whiteCheckerLight : c.blackCheckerLight;
    const dark = owner === 'white' ? c.whiteCheckerDark : c.blackCheckerDark;
    const highlight = owner === 'white' ? c.whiteCheckerHighlight : c.blackCheckerHighlight;

    const g = new Graphics();
    // Outer brass-toned rim
    g.circle(x, y, r).fill(this.colors.brass);
    g.circle(x, y, r).stroke({ color: this.colors.brassDark, width: 1.5 });

    // Inner rim layer (darker, 92% radius)
    g.circle(x, y, r * 0.92).fill(rim);

    // Inner disc with diagonal gradient (light top-left → dark bottom-right)
    const grad = new FillGradient(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7);
    grad.addColorStop(0, light);
    grad.addColorStop(0.55, light);
    grad.addColorStop(1, dark);
    g.circle(x, y, r * 0.78).fill(grad);

    // Concave inset ring
    g.circle(x, y, r * 0.55).stroke({
      color: rim,
      width: Math.max(1.2, r * 0.06),
      alpha: 0.7,
    });

    // Center pip
    g.circle(x, y, r * 0.1).fill({ color: rim, alpha: 0.8 });

    // Specular highlight top-left
    g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.22, r * 0.16).fill({
      color: highlight,
      alpha: 0.85,
    });
    this.root.addChild(g);
  }

  private drawBarCheckers(state: BoardState, skip: CheckerSkip | null = null) {
    const whiteCount = Math.max(
      0,
      state.bar.white - (skip?.pos === BAR && skip.owner === 'white' ? 1 : 0)
    );
    const blackCount = Math.max(
      0,
      state.bar.black - (skip?.pos === BAR && skip.owner === 'black' ? 1 : 0)
    );
    for (let n = 0; n < whiteCount; n++) {
      const { x, y } = this.barCheckerAnchor('white', n);
      this.drawChecker(x, y, 'white');
    }
    for (let n = 0; n < blackCount; n++) {
      const { x, y } = this.barCheckerAnchor('black', n);
      this.drawChecker(x, y, 'black');
    }
  }

  private drawOffTrays(state: BoardState, drawBackground = true, skip: CheckerSkip | null = null) {
    if (drawBackground) {
      const bg = new Graphics();
      for (const owner of ['black', 'white'] as const) {
        const tray = this.offTrayMetrics(owner);
        const left = tray.x - tray.width / 2;
        const grad = new FillGradient(left, 0, left + tray.width, 0);
        grad.addColorStop(0, this.colors.frameInnerEdge);
        grad.addColorStop(0.5, this.colors.trayBg);
        grad.addColorStop(1, this.colors.frameInnerEdge);
        bg.roundRect(left, tray.top, tray.width, tray.height, 6).fill(grad);
        bg.roundRect(left, tray.top, tray.width, tray.height, 6).stroke({
          color: this.colors.brassDark,
          width: 1,
          alpha: 0.6,
        });
      }
      this.root.addChild(bg);
    }

    const blackCount = Math.max(
      0,
      state.off.black - (skip?.pos === OFF && skip.owner === 'black' ? 1 : 0)
    );
    const whiteCount = Math.max(
      0,
      state.off.white - (skip?.pos === OFF && skip.owner === 'white' ? 1 : 0)
    );
    for (let n = 0; n < blackCount; n++) {
      const { x, y } = this.offCheckerAnchor('black', n);
      this.drawChecker(x, y, 'black');
    }
    for (let n = 0; n < whiteCount; n++) {
      const { x, y } = this.offCheckerAnchor('white', n);
      this.drawChecker(x, y, 'white');
    }
  }

  // ---------- Selection overlay ----------

  private drawSelectionOverlay(state: BoardState, selection: RenderSelection) {
    const {
      legalOrigins,
      opponentDestinations = [],
      opponentOrigins = [],
      selectedFrom,
      validDestinations,
    } = selection;

    for (const origin of opponentOrigins) this.drawThreatOriginHint(state, origin);
    for (const dest of opponentDestinations) this.drawThreatDestinationRing(state, dest);

    for (const origin of legalOrigins) {
      if (origin === selectedFrom) continue;
      this.drawOriginHint(state, origin);
    }
    if (selectedFrom !== null) this.drawSelectedRing(state, selectedFrom);
    for (const dest of validDestinations) this.drawDestinationRing(state, dest);
  }

  private originAnchor(state: BoardState, pos: Position): { x: number; y: number } | null {
    const r = this.layout.checkerRadius;
    if (pos === BAR) {
      const cx = this.layout.barX + this.layout.barWidth / 2;
      const cy =
        state.turn === 'white'
          ? this.layout.height / 2 + r + 6
          : this.layout.height / 2 - r - 6;
      return { x: cx, y: cy };
    }
    if (pos === OFF) return null;
    const ppos = pointCoords(this.layout, pos);
    const point = state.points[pos];
    const top = Math.max(0, (point?.count ?? 1) - 1);
    return checkerCenter(this.layout, ppos, top, point?.count ?? 1);
  }

  private destinationAnchor(state: BoardState, pos: Position): { x: number; y: number } | null {
    if (pos === OFF) {
      return this.offCheckerAnchor(state.turn, state.off[state.turn]);
    }
    if (pos === BAR) return null;
    const ppos = pointCoords(this.layout, pos);
    const point = state.points[pos];
    const stackIdx =
      point && point.owner === state.turn ? point.count : 0; // landing on top of own stack, else fresh stack
    return checkerCenter(this.layout, ppos, stackIdx, stackIdx + 1);
  }

  private drawOriginHint(state: BoardState, pos: Position) {
    const a = this.originAnchor(state, pos);
    if (!a) return;
    const r = this.layout.checkerRadius;
    const g = new Graphics();
    g.circle(a.x, a.y, r * 1.18).stroke({ color: 0xffd34d, width: 2, alpha: 0.45 });
    this.root.addChild(g);
  }

  private drawThreatOriginHint(state: BoardState, pos: Position) {
    const a = this.originAnchor(state, pos);
    if (!a) return;
    const r = this.layout.checkerRadius;
    const g = new Graphics();
    g.circle(a.x, a.y, r * 1.2).stroke({ color: 0xff5c5c, width: 2.5, alpha: 0.55 });
    this.root.addChild(g);
  }

  private drawThreatDestinationRing(state: BoardState, pos: Position) {
    const a = this.destinationAnchor(state, pos);
    if (!a) return;
    const r = this.layout.checkerRadius;
    const g = new Graphics();
    g.circle(a.x, a.y, r * 0.98).fill({ color: 0xef4444, alpha: 0.22 });
    g.circle(a.x, a.y, r * 1.08).stroke({ color: 0xff6b6b, width: 2.5, alpha: 0.9 });
    this.root.addChild(g);
  }

  private drawSelectedRing(state: BoardState, pos: Position) {
    const a = this.originAnchor(state, pos);
    if (!a) return;
    const r = this.layout.checkerRadius;
    const g = new Graphics();
    g.circle(a.x, a.y, r * 1.22).stroke({ color: 0xffe58a, width: 4, alpha: 0.95 });
    g.circle(a.x, a.y, r * 1.05).stroke({ color: 0xfff2c2, width: 1.5, alpha: 0.7 });
    this.root.addChild(g);
  }

  private drawDestinationRing(state: BoardState, pos: Position) {
    const a = this.destinationAnchor(state, pos);
    if (!a) return;
    const r = this.layout.checkerRadius;
    const g = new Graphics();
    g.circle(a.x, a.y, r * 0.95).fill({ color: 0x4ade80, alpha: 0.28 });
    g.circle(a.x, a.y, r * 1.05).stroke({ color: 0x6ee7a3, width: 2.5, alpha: 0.9 });
    this.root.addChild(g);
  }

  private pointIndexForColumn(side: 'top' | 'bottom', column: number): number {
    return side === 'bottom' ? 12 + column : 11 - column;
  }

  private drawAlignmentDebugOverlay(state: BoardState, debug: AlignmentDebugSelection) {
    const target = debug.target ?? 'point';
    if (target === 'offWhite' || target === 'offBlack') {
      this.drawOffTrayDebugOverlay(target === 'offWhite' ? 'white' : 'black');
      return;
    }
    const activeColumn = Math.max(0, Math.min(11, debug.column));
    const g = new Graphics();
    const r = this.layout.checkerRadius;

    for (let column = 0; column < 12; column++) {
      const idx = this.pointIndexForColumn(debug.side, column);
      const pos = pointCoords(this.layout, idx);
      // Per-row depth so the alignment overlay matches the actual
      // triangle length for the row being edited.
      const rowPointHeight =
        pos.stackDir === 1 ? this.layout.topPointHeight : this.layout.bottomPointHeight;
      const tipY = pos.y + pos.stackDir * rowPointHeight;
      const selected = column === activeColumn;
      const color = selected ? 0xff4df3 : 0x23d7ff;
      const alpha = selected ? 0.95 : 0.32;
      const width = selected ? 3 : 1.5;

      g.moveTo(pos.x, pos.y)
        .lineTo(pos.tipX, tipY)
        .stroke({ color, width, alpha });

      g.circle(pos.x, pos.y, selected && debug.anchor === 'base' ? r * 0.22 : r * 0.13)
        .fill({ color, alpha: selected && debug.anchor === 'base' ? 0.8 : 0.35 });
      g.circle(pos.tipX, tipY, selected && debug.anchor === 'tip' ? r * 0.22 : r * 0.13)
        .fill({ color, alpha: selected && debug.anchor === 'tip' ? 0.8 : 0.35 });
    }

    const selectedIdx = this.pointIndexForColumn(debug.side, activeColumn);
    const selectedPoint = state.points[selectedIdx];
    const selectedPos = pointCoords(this.layout, selectedIdx);
    const ghostCount = selectedPoint?.count ?? 5;

    for (let n = 0; n < ghostCount; n++) {
      const center = checkerCenter(this.layout, selectedPos, n, ghostCount);
      const activeTopChecker = debug.anchor === 'topChecker' && n === ghostCount - 1;
      g.circle(center.x, center.y, r * 1.08).stroke({
        color: activeTopChecker ? 0x7cff74 : 0xff4df3,
        width: activeTopChecker ? 4 : 2.5,
        alpha: activeTopChecker ? 1 : 0.9,
      });
      g.moveTo(center.x - r * 0.24, center.y)
        .lineTo(center.x + r * 0.24, center.y)
        .stroke({ color: activeTopChecker ? 0x7cff74 : 0xff4df3, width: 1.5, alpha: 0.8 });
      g.moveTo(center.x, center.y - r * 0.24)
        .lineTo(center.x, center.y + r * 0.24)
        .stroke({ color: activeTopChecker ? 0x7cff74 : 0xff4df3, width: 1.5, alpha: 0.8 });
    }

    this.root.addChild(g);
  }

  private drawOffTrayDebugOverlay(owner: Player) {
    const tray = this.offTrayMetrics(owner);
    const r = this.layout.checkerRadius;
    const left = tray.x - tray.width / 2;
    const g = new Graphics();
    // Outline the active tray in magenta + a soft cyan tint for the
    // inactive one so the user can compare positions while editing.
    const other = owner === 'white' ? 'black' : 'white';
    const otherTray = this.offTrayMetrics(other);
    const otherLeft = otherTray.x - otherTray.width / 2;
    g.rect(otherLeft, otherTray.top, otherTray.width, otherTray.height).stroke({
      color: 0x23d7ff,
      width: 1.5,
      alpha: 0.35,
    });
    g.rect(left, tray.top, tray.width, tray.height).stroke({
      color: 0xff4df3,
      width: 3,
      alpha: 0.95,
    });
    // Ghost the 15 stack slots so the user can see where each finished
    // checker would land at the current spacing.
    for (let n = 0; n < 15; n++) {
      const y =
        owner === 'black'
          ? tray.top + r + n * tray.step
          : tray.top + tray.height - r - n * tray.step;
      if (y < tray.top + r * 0.6 || y > tray.top + tray.height - r * 0.6) break;
      g.circle(tray.x, y, r * 0.95).stroke({
        color: 0xff4df3,
        width: 1.5,
        alpha: 0.7,
      });
    }
    this.root.addChild(g);
  }

  // ---------- Hit areas ----------

  private drawHitAreas(state: BoardState) {
    const { width, height, railWidth, barX, barWidth, checkerRadius } = this.layout;
    const cb = this.onPointClick;
    if (!cb) return;
    void state;

    // Build per-row hit rects whose horizontal span fills the gap to the
    // neighboring point's center (capped at the bar / rail edges). On themes
    // with custom pointCenterXs (e.g. premium-purple) the per-point hit
    // rectangle would otherwise be narrower than the inter-center spacing,
    // leaving dead zones between adjacent points where taps fell through.
    const leftRail = railWidth;
    const rightRail = width - railWidth;
    const barLeft = barX;
    const barRight = barX + barWidth;

    const addRow = (isBottom: boolean) => {
      const pointWidth = isBottom ? this.layout.bottomPointWidth : this.layout.topPointWidth;
      const xs: number[] = [];
      for (let c = 0; c < 12; c++) {
        const idx = isBottom ? 12 + c : 11 - c;
        xs.push(pointCoords(this.layout, idx).x);
      }
      const y = isBottom ? height / 2 : 0;
      const h = height / 2;
      // Make sure each rect is at least as wide as the visible checker so
      // taps on the green destination ring always register.
      const minHalf = Math.max(pointWidth, checkerRadius * 2) / 2;
      for (let c = 0; c < 12; c++) {
        const idx = isBottom ? 12 + c : 11 - c;
        const center = xs[c]!;
        let left: number;
        let right: number;
        if (c <= 5) {
          left = c === 0 ? leftRail : (xs[c - 1]! + center) / 2;
          right = c === 5 ? barLeft : (center + xs[c + 1]!) / 2;
        } else {
          left = c === 6 ? barRight : (xs[c - 1]! + center) / 2;
          right = c === 11 ? rightRail : (center + xs[c + 1]!) / 2;
        }
        left = Math.min(left, center - minHalf);
        right = Math.max(right, center + minHalf);
        const hit = new Graphics();
        hit.rect(left, y, right - left, h).fill({ color: 0xffffff, alpha: 0.001 });
        hit.eventMode = 'static';
        hit.cursor = 'pointer';
        hit.on('pointerdown', () => cb(idx));
        this.root.addChild(hit);
      }
    };
    addRow(false);
    addRow(true);

    const barHit = new Graphics();
    barHit.rect(barX, 0, barWidth, height).fill({ color: 0xffffff, alpha: 0.001 });
    barHit.eventMode = 'static';
    barHit.cursor = 'pointer';
    barHit.on('pointerdown', () => cb(BAR));
    this.root.addChild(barHit);

    const offHit = new Graphics();
    offHit
      .rect(width - railWidth, 0, railWidth, height)
      .fill({ color: 0xffffff, alpha: 0.001 });
    offHit.eventMode = 'static';
    offHit.cursor = 'pointer';
    offHit.on('pointerdown', () => cb(OFF));
    this.root.addChild(offHit);
  }

  destroy() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.root.destroy({ children: true, texture: false, textureSource: false });
  }
}
