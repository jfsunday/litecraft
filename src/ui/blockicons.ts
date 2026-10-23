// Isometric block icons drawn with the same models/textures as the 3D view (2D canvas, affine texture mapping).
import { describe } from '../blocks/info';
import { proceduralParts } from '../blocks/procmodel';
import { blockTint } from '../blocks/tint';
import type { ModelLibrary } from '../render/mesher';
import { bake, box } from '../render/model';
import { parseKey } from '../world/world';

const BASE = 96;
const ALWAYS_TINT = new Set(['redstone_wire', 'pumpkin_stem', 'melon_stem']);

export class BlockIcons {
  private tex = new Map<string, HTMLCanvasElement>();
  private icons = new Map<string, HTMLCanvasElement>();
  constructor(private lib: ModelLibrary) {}

  reset() { this.tex.clear(); this.icons.clear(); }

  private texture(key: string, tint: number, shade: number): HTMLCanvasElement {
    const k = `${key}|${tint}|${shade}`;
    const hit = this.tex.get(k);
    if (hit) return hit;
    const { px, r } = this.lib.bank.rgba(key);
    const c = document.createElement('canvas');
    c.width = c.height = r;
    const g = c.getContext('2d')!;
    const img = g.createImageData(r, r);
    const tr = tint >= 0 ? ((tint >> 16) & 255) / 255 : 1, tg = tint >= 0 ? ((tint >> 8) & 255) / 255 : 1, tb = tint >= 0 ? (tint & 255) / 255 : 1;
    for (let i = 0; i < r * r; i++) {
      img.data[i * 4] = px[i * 4] * tr * shade;
      img.data[i * 4 + 1] = px[i * 4 + 1] * tg * shade;
      img.data[i * 4 + 2] = px[i * 4 + 2] * tb * shade;
      img.data[i * 4 + 3] = px[i * 4 + 3];
    }
    g.putImageData(img, 0, 0);
    this.tex.set(k, c);
    return c;
  }

  private render(stateKey: string): HTMLCanvasElement {
    const { name, props } = parseKey(stateKey);
    const info = describe(0, name, props);
    const v = this.lib.vanilla?.hasModels && name.startsWith('minecraft:') ? this.lib.vanilla.parts(info.short, info.props) : null;
    let quads = bake(v ?? proceduralParts(info));
    let fluidTint = -1;
    if (!quads.length && info.fluid) {
      const key = info.fluid === 1 ? 'proc:water_still' : 'proc:lava_still';
      quads = bake([{ elements: [box([0, 0, 0], [16, 14, 16], key)] }]);
      if (info.fluid === 1 && this.lib.bank.rgba(key).pack) fluidTint = 0x3f76e4;
    }
    const c = document.createElement('canvas');
    c.width = c.height = BASE;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const k = BASE / 2.25, cx = BASE / 2, cy = BASE / 2 + BASE * 0.02;
    // Flat models (rails, dust, carpets) look better slightly enlarged.
    const proj = (x: number, y: number, z: number): [number, number] => [cx + (x - z) * k * 0.866, cy + ((x - 0.5) + (z - 0.5)) * 0.5 * k - (y - 0.5) * k];
    const visible = quads.map((q) => {
      const e1 = [q.pos[3] - q.pos[0], q.pos[4] - q.pos[1], q.pos[5] - q.pos[2]];
      const e2 = [q.pos[9] - q.pos[0], q.pos[10] - q.pos[1], q.pos[11] - q.pos[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const depth = (q.pos[0] + q.pos[1] + q.pos[2] + q.pos[3] + q.pos[4] + q.pos[5] + q.pos[6] + q.pos[7] + q.pos[8] + q.pos[9] + q.pos[10] + q.pos[11]) / 4;
      return { q, facing: n[0] + n[1] + n[2], depth };
    }).filter((e) => e.facing > 1e-6).sort((a, b) => a.depth - b.depth);
    const SH = [0.62, 0.62, 1, 0.5, 0.82, 0.82];
    for (const { q } of visible) {
      const { pack } = this.lib.bank.rgba(q.tex);
      const tint = fluidTint >= 0 ? fluidTint : q.tint >= 0 && (pack || ALWAYS_TINT.has(info.short)) ? blockTint(info.short, info.props, q.tint, this.lib.colormaps) : -1;
      const tex = this.texture(q.tex, tint, q.shade && q.aligned ? SH[q.dir] : 0.95);
      const R = tex.width;
      const p = [0, 1, 2, 3].map((i) => proj(q.pos[i * 3], q.pos[i * 3 + 1], q.pos[i * 3 + 2]));
      const t = [0, 1, 2, 3].map((i) => [q.uv[i * 2] * R, (1 - q.uv[i * 2 + 1]) * R]);
      const f1 = [t[1][0] - t[0][0], t[1][1] - t[0][1]], f2 = [t[3][0] - t[0][0], t[3][1] - t[0][1]];
      const det = f1[0] * f2[1] - f2[0] * f1[1];
      if (Math.abs(det) < 1e-9) continue;
      const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1]], e2 = [p[3][0] - p[0][0], p[3][1] - p[0][1]];
      // A = [e1 e2] · inverse([f1 f2])
      const i11 = f2[1] / det, i12 = -f2[0] / det, i21 = -f1[1] / det, i22 = f1[0] / det;
      const a = e1[0] * i11 + e2[0] * i21, cc = e1[0] * i12 + e2[0] * i22;
      const b = e1[1] * i11 + e2[1] * i21, d = e1[1] * i12 + e2[1] * i22;
      const e = p[0][0] - (a * t[0][0] + cc * t[0][1]), f = p[0][1] - (b * t[0][0] + d * t[0][1]);
      const mx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, my = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
      g.save();
      g.beginPath();
      p.forEach(([x, y], i) => {
        const dx = x - mx, dy = y - my, l = Math.hypot(dx, dy) || 1;
        const ex = x + (dx / l) * 0.6, ey = y + (dy / l) * 0.6;
        if (i) g.lineTo(ex, ey); else g.moveTo(ex, ey);
      });
      g.closePath();
      g.clip();
      g.setTransform(a, b, cc, d, e, f);
      g.drawImage(tex, 0, 0);
      g.restore();
    }
    if (!visible.length) {
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.setLineDash([4, 4]);
      g.lineWidth = 2;
      g.strokeRect(BASE * 0.22, BASE * 0.22, BASE * 0.56, BASE * 0.56);
    }
    return c;
  }

  /** Draws the icon of a block state into a canvas (sized via CSS, drawn at device resolution). */
  paint(target: HTMLCanvasElement, stateKey: string, cssSize: number) {
    let src = this.icons.get(stateKey);
    if (!src) { src = this.render(stateKey); this.icons.set(stateKey, src); }
    const px = Math.round(cssSize * Math.min(2, window.devicePixelRatio || 1));
    if (target.width !== px) { target.width = px; target.height = px; }
    const g = target.getContext('2d')!;
    g.clearRect(0, 0, px, px);
    g.imageSmoothingEnabled = true;
    g.drawImage(src, 0, 0, px, px);
  }

  canvas(stateKey: string, cssSize: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.className = 'block-icon';
    c.style.width = c.style.height = `${cssSize}px`;
    this.paint(c, stateKey, cssSize);
    return c;
  }
}
