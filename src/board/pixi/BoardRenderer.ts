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
import { checkerCenterY, computeLayout, pointCoords, type Layout } from '../coordinates';
import type { LoadedTheme, ThemeAssetKey, ThemeColors } from '../theme';

export interface RenderSelection {
  readonly selectedFrom: Position | null;
  readonly validDestinations: readonly Position[];
  readonly legalOrigins: readonly Position[];
}

export type PointClickHandler = (pos: Position) => void;

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
  private readonly loaded: LoadedTheme;
  private onPointClick: PointClickHandler | null = null;

  constructor(app: Application, loaded: LoadedTheme) {
    this.app = app;
    this.loaded = loaded;
    this.root = new Container();
    this.app.stage.addChild(this.root);
    this.layout = computeLayout(app.screen.width, app.screen.height);
  }

  resize(width: number, height: number) {
    this.layout = computeLayout(width, height);
  }

  setOnPointClick(fn: PointClickHandler | null) {
    this.onPointClick = fn;
  }

  render(state: BoardState, selection?: RenderSelection) {
    this.root.removeChildren();
    this.drawFrame();
    this.drawRails();
    this.drawFelt();
    this.drawPoints();
    this.drawBar();
    this.drawHinges();
    this.drawCheckers(state);
    this.drawBarCheckers(state);
    this.drawOffTrays(state);
    if (selection) this.drawSelectionOverlay(state, selection);
    if (this.onPointClick) this.drawHitAreas(state);
  }

  private get colors(): ThemeColors {
    return this.loaded.theme.colors;
  }

  private texture(key: ThemeAssetKey): Texture | undefined {
    return this.loaded.textures[key];
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
    const { pointWidth, pointHeight } = this.layout;
    const lightTex = this.texture('pointLight');
    const darkTex = this.texture('pointDark');

    for (let i = 0; i < 24; i++) {
      const pos = pointCoords(this.layout, i);
      const isLight = pos.column % 2 === 0;
      const tex = isLight ? lightTex : darkTex;

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

  private drawCheckers(state: BoardState) {
    for (let i = 0; i < 24; i++) {
      const point = state.points[i];
      if (!point || point.count === 0 || point.owner === null) continue;
      const pos = pointCoords(this.layout, i);
      for (let n = 0; n < point.count; n++) {
        const cy = checkerCenterY(this.layout, pos, n, point.count);
        this.drawChecker(pos.x, cy, point.owner);
      }
    }
  }

  private drawChecker(x: number, y: number, owner: Player) {
    const r = this.layout.checkerRadius;
    const tex = this.texture(owner === 'white' ? 'whiteChecker' : 'blackChecker');

    // Stronger drop shadow — wider, darker, slightly lower
    const shadow = new Graphics();
    shadow
      .ellipse(x + 2, y + r * 0.32, r * 1.0, r * 0.42)
      .fill({ color: 0x000000, alpha: 0.55 });
    this.root.addChild(shadow);

    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.x = x;
      sprite.y = y;
      sprite.width = r * 2;
      sprite.height = r * 2;
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

  private drawBarCheckers(state: BoardState) {
    const { barX, barWidth, height, checkerRadius } = this.layout;
    const cx = barX + barWidth / 2;
    const diameter = 2 * checkerRadius;

    for (let n = 0; n < state.bar.white; n++) {
      const cy = height / 2 + checkerRadius + 6 + n * diameter;
      this.drawChecker(cx, cy, 'white');
    }
    for (let n = 0; n < state.bar.black; n++) {
      const cy = height / 2 - checkerRadius - 6 - n * diameter;
      this.drawChecker(cx, cy, 'black');
    }
  }

  private drawOffTrays(state: BoardState) {
    const { width, height, railWidth } = this.layout;
    const trayPadding = 12;
    const trayWidth = railWidth - 2 * trayPadding;
    const trayHeight = height * 0.42;
    const trayCx = width - railWidth / 2;
    const trayLeft = trayCx - trayWidth / 2;

    const bg = new Graphics();
    const grad = new FillGradient(trayLeft, 0, trayLeft + trayWidth, 0);
    grad.addColorStop(0, this.colors.frameInnerEdge);
    grad.addColorStop(0.5, this.colors.trayBg);
    grad.addColorStop(1, this.colors.frameInnerEdge);
    bg.roundRect(trayLeft, trayPadding, trayWidth, trayHeight, 6).fill(grad);
    bg.roundRect(trayLeft, height - trayPadding - trayHeight, trayWidth, trayHeight, 6).fill(grad);
    bg.roundRect(trayLeft, trayPadding, trayWidth, trayHeight, 6).stroke({
      color: this.colors.brassDark,
      width: 1,
      alpha: 0.6,
    });
    bg.roundRect(trayLeft, height - trayPadding - trayHeight, trayWidth, trayHeight, 6).stroke({
      color: this.colors.brassDark,
      width: 1,
      alpha: 0.6,
    });
    this.root.addChild(bg);

    const slabHeight = 5;
    const slabGap = 2;
    for (let n = 0; n < state.off.black; n++) {
      const y = trayPadding + 6 + n * (slabHeight + slabGap);
      const g = new Graphics();
      g.roundRect(trayLeft + 4, y, trayWidth - 8, slabHeight, 1)
        .fill(this.colors.blackCheckerDark)
        .stroke({ color: this.colors.brass, width: 1 });
      this.root.addChild(g);
    }
    for (let n = 0; n < state.off.white; n++) {
      const y = height - trayPadding - 6 - slabHeight - n * (slabHeight + slabGap);
      const g = new Graphics();
      g.roundRect(trayLeft + 4, y, trayWidth - 8, slabHeight, 1)
        .fill(this.colors.whiteCheckerLight)
        .stroke({ color: this.colors.brass, width: 1 });
      this.root.addChild(g);
    }
  }

  // ---------- Selection overlay ----------

  private drawSelectionOverlay(state: BoardState, selection: RenderSelection) {
    const { legalOrigins, selectedFrom, validDestinations } = selection;

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
    return { x: ppos.x, y: checkerCenterY(this.layout, ppos, top, point?.count ?? 1) };
  }

  private destinationAnchor(state: BoardState, pos: Position): { x: number; y: number } | null {
    if (pos === OFF) {
      const { width, height, railWidth } = this.layout;
      const trayCx = width - railWidth / 2;
      const cy = state.turn === 'white' ? height * 0.78 : height * 0.22;
      return { x: trayCx, y: cy };
    }
    if (pos === BAR) return null;
    const ppos = pointCoords(this.layout, pos);
    const point = state.points[pos];
    const stackIdx =
      point && point.owner === state.turn ? point.count : 0; // landing on top of own stack, else fresh stack
    return { x: ppos.x, y: checkerCenterY(this.layout, ppos, stackIdx, stackIdx + 1) };
  }

  private drawOriginHint(state: BoardState, pos: Position) {
    const a = this.originAnchor(state, pos);
    if (!a) return;
    const r = this.layout.checkerRadius;
    const g = new Graphics();
    g.circle(a.x, a.y, r * 1.18).stroke({ color: 0xffd34d, width: 2, alpha: 0.45 });
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

  // ---------- Hit areas ----------

  private drawHitAreas(state: BoardState) {
    const { width, height, railWidth, pointWidth, barX, barWidth } = this.layout;
    const cb = this.onPointClick;
    if (!cb) return;
    void state;

    for (let i = 0; i < 24; i++) {
      const pos = pointCoords(this.layout, i);
      const isBottom = i >= 12;
      const x = pos.x - pointWidth / 2;
      const y = isBottom ? height / 2 : 0;
      const h = height / 2;

      const hit = new Graphics();
      hit.rect(x, y, pointWidth, h).fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointerdown', () => cb(i));
      this.root.addChild(hit);
    }

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
    this.root.destroy({ children: true });
  }
}
