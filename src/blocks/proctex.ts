// Procedural 16×16 textures used when no Minecraft jar is loaded. Deterministic per texture name.
import { colorFor, CONCRETE, dyeOf, GLASS, hashString, materialColor, mix, type RGB, scale, TERRACOTTA, WOOD, woodOf, WOOL } from './colors';

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class P {
  d = new Uint8ClampedArray(1024);
  constructor(public r: () => number) {}
  set(x: number, y: number, c: RGB, a = 255) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = (y * 16 + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x: number, y: number): RGB { const i = (y * 16 + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  alpha(x: number, y: number, a: number) { this.d[(y * 16 + x) * 4 + 3] = a; }
  mul(x: number, y: number, f: number) { if (x < 0 || y < 0 || x > 15 || y > 15) return; this.set(x, y, scale(this.get(x, y), f), this.d[(y * 16 + x) * 4 + 3]); }
  fill(c: RGB, a = 255) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, c, a); }
  clear() { this.d.fill(0); }
  noise(c: RGB, amt = 0.1, coarse = 0.5, levels = 4) {
    const cg = Array.from({ length: 64 }, () => this.r() * 2 - 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = (this.r() * 2 - 1) * (1 - coarse) + cg[(y >> 1) * 8 + (x >> 1)] * coarse;
      const q = Math.round(v * levels) / levels;
      this.set(x, y, scale(c, 1 + q * amt));
    }
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c, a); }
  shadeRect(x0: number, y0: number, x1: number, y1: number, f: number) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.mul(x, y, f); }
  bevel(light = 1.18, dark = 0.78, inset = 0) {
    for (let i = inset; i < 16 - inset; i++) { this.mul(i, inset, light); this.mul(inset, i, light); this.mul(i, 15 - inset, dark); this.mul(15 - inset, i, dark); }
  }
  speck(c: RGB, n: number, a = 255) { for (let i = 0; i < n; i++) this.set(Math.floor(this.r() * 16), Math.floor(this.r() * 16), c, a); }
  blob(cx: number, cy: number, c: RGB, size = 2) {
    for (let i = 0; i < size + 2; i++) this.set(cx + Math.floor(this.r() * size) - (size >> 1), cy + Math.floor(this.r() * size) - (size >> 1), scale(c, 0.85 + this.r() * 0.3));
  }
}

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const STONE = hex(0x7d7d7d);
const DIRT = hex(0x866043);
const GRASS = hex(0x6fa64a);

function cobble(p: P, c: RGB) {
  const seeds = Array.from({ length: 11 }, () => [p.r() * 16, p.r() * 16, 0.8 + p.r() * 0.35]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let d1 = 99, d2 = 99, best = 0;
    for (let i = 0; i < seeds.length; i++) {
      for (const [ox, oy] of [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]]) {
        const d = Math.hypot(x - seeds[i][0] - ox, y - seeds[i][1] - oy);
        if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
      }
    }
    const f = d2 - d1 < 1.1 ? 0.55 : seeds[best][2] * (1 + (p.r() - 0.5) * 0.12) * (d1 < 1.5 ? 1.12 : 1);
    p.set(x, y, scale(c, f));
  }
}

function planks(p: P, c: RGB) {
  p.noise(c, 0.06, 0.2, 3);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    for (let x = 0; x < 16; x++) { p.mul(x, y0 + 3, 0.68); if (p.r() < 0.35) p.mul(x, y0 + 1, 0.92); }
    const seam = (row * 5 + Math.floor(p.r() * 4) + (row % 2 ? 8 : 2)) % 16;
    for (let y = y0; y < y0 + 3; y++) p.mul(seam, y, 0.7);
  }
}

function logSide(p: P, c: RGB, mark?: RGB) {
  p.noise(c, 0.08, 0.1, 3);
  for (let x = 0; x < 16; x++) {
    const f = p.r() < 0.3 ? 0.78 : p.r() < 0.5 ? 1.1 : 1;
    for (let y = 0; y < 16; y++) if (p.r() < 0.85) p.mul(x, y, f);
  }
  if (mark) for (let i = 0; i < 6; i++) { const y = Math.floor(p.r() * 16), x = Math.floor(p.r() * 14); p.rect(x, y, x + 1 + Math.floor(p.r() * 2), y, mark); }
}

function logTop(p: P, inner: RGB, bark: RGB) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    p.set(x, y, ring > 6.6 ? scale(bark, 0.9 + p.r() * 0.2) : scale(inner, (Math.floor(ring) % 2 ? 0.88 : 1) * (0.96 + p.r() * 0.08)));
  }
}

function bricks(p: P, brick: RGB, mortar: RGB) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, off = row % 2 ? 4 : 0;
    const isMortar = y % 4 === 3 || (x + off) % 8 === 7;
    p.set(x, y, isMortar ? scale(mortar, 0.95 + p.r() * 0.1) : scale(brick, 0.88 + p.r() * 0.2));
  }
}

function stoneBricks(p: P, c: RGB) {
  p.noise(c, 0.07, 0.4, 3);
  for (let x = 0; x < 16; x++) { p.mul(x, 7, 0.62); p.mul(x, 15, 0.62); p.mul(x, 0, 1.12); p.mul(x, 8, 1.12); }
  for (let y = 0; y < 7; y++) { p.mul(15, y, 0.62); p.mul(0, y, 1.1); }
  for (let y = 8; y < 15; y++) { p.mul(7, y, 0.62); p.mul(8, y, 1.1); }
}

function tiles(p: P, c: RGB) {
  p.noise(c, 0.07, 0.4, 3);
  for (let i = 0; i < 16; i++) { p.mul(i, 7, 0.62); p.mul(i, 15, 0.62); p.mul(7, i, 0.62); p.mul(15, i, 0.62); p.mul(i, 0, 1.1); p.mul(i, 8, 1.1); p.mul(0, i, 1.1); p.mul(8, i, 1.1); }
}

function ore(p: P, base: RGB, oreC: RGB) {
  p.noise(base, 0.1, 0.5);
  for (let i = 0; i < 5; i++) {
    const cx = 2 + Math.floor(p.r() * 12), cy = 2 + Math.floor(p.r() * 12);
    p.set(cx, cy, oreC); p.set(cx + 1, cy, scale(oreC, 1.15)); p.set(cx, cy + 1, scale(oreC, 0.8));
    if (p.r() < 0.6) p.set(cx - 1, cy + 1, scale(oreC, 0.9));
  }
}

function glass(p: P, c: RGB, center: number) {
  p.clear();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) p.set(x, y, scale(c, 0.92), center ? 220 : 255);
    else if (center) p.set(x, y, c, center);
  }
  for (const [x, y] of [[3, 2], [2, 3], [4, 3], [3, 4], [11, 9], [12, 10], [10, 10]]) p.set(x, y, mix(c, [255, 255, 255], 0.6), center ? 200 : 255);
}

function leaves(p: P, c: RGB) {
  p.noise(c, 0.18, 0.4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (p.r() < 0.16) p.alpha(x, y, 0);
}

function metal(p: P, c: RGB) {
  p.noise(c, 0.04, 0.3, 2);
  for (let y = 2; y < 14; y += 4) for (let x = 1; x < 15; x++) p.mul(x, y, 0.94);
  p.bevel(1.18, 0.75);
}

function gem(p: P, c: RGB) {
  p.noise(c, 0.05, 0.3, 2);
  for (let i = 1; i < 15; i++) { p.mul(i, i, 1.12); p.mul(15 - i, i, 0.9); }
  p.bevel(1.25, 0.72);
}

function wool(p: P, c: RGB) {
  p.noise(c, 0.07, 0.3, 3);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 3) % 4 === 0) p.mul(x, y, 0.94);
}

function grassSide(p: P, dirt: RGB, green: RGB, snowy = false) {
  p.noise(dirt, 0.12, 0.5);
  const top = snowy ? hex(0xf0f6f6) : green;
  for (let x = 0; x < 16; x++) {
    const depth = 2 + Math.floor(p.r() * 3);
    for (let y = 0; y < depth; y++) p.set(x, y, scale(top, 0.88 + p.r() * 0.22));
  }
}

function crossSprite(p: P, draw: (p: P) => void) { p.clear(); draw(p); }

function stalks(p: P, c: RGB, height: number, n = 5, head?: RGB) {
  for (let i = 0; i < n; i++) {
    const x = 1 + Math.floor(((i + 0.5) / n) * 14), h = Math.max(2, Math.round(height * (0.75 + p.r() * 0.25)));
    for (let y = 15; y > 15 - h; y--) p.set(x + (y % 5 === 0 && p.r() < 0.5 ? 1 : 0), y, scale(c, 0.85 + p.r() * 0.3));
    if (head) { p.set(x, 16 - h, head); p.set(x + 1, 16 - h, scale(head, 0.85)); p.set(x, 17 - h, scale(head, 0.9)); }
  }
}

function flower(p: P, petal: RGB) {
  const stem = hex(0x3f7a2a);
  for (let y = 8; y < 16; y++) p.set(7, y, stem);
  p.set(6, 11, stem); p.set(8, 12, stem); p.set(5, 10, stem); p.set(9, 13, stem);
  for (const [x, y] of [[7, 4], [6, 5], [8, 5], [7, 6], [6, 4], [8, 6], [6, 6], [8, 4], [7, 3], [5, 5], [9, 5], [7, 7]]) p.set(x, y, scale(petal, 0.85 + p.r() * 0.3));
  p.set(7, 5, mix(petal, [255, 230, 80], 0.6));
}

function dust(p: P) {
  p.clear();
  const w: RGB = [255, 255, 255];
  p.rect(6, 6, 9, 9, w);
}

/** Redstone dust overlay for a connection mask (bits: n=1, e=2, s=4, w=8). */
function dustLines(p: P, mask: number) {
  p.clear();
  const w: RGB = [235, 235, 235];
  p.rect(6, 6, 9, 9, w);
  if (mask & 1) p.rect(7, 0, 8, 6, w);
  if (mask & 4) p.rect(7, 9, 8, 15, w);
  if (mask & 2) p.rect(9, 7, 15, 8, w);
  if (mask & 8) p.rect(0, 7, 6, 8, w);
  for (let i = 0; i < 18; i++) { const x = Math.floor(p.r() * 16), y = Math.floor(p.r() * 16); if (p.d[(y * 16 + x) * 4 + 3]) p.mul(x, y, 0.8); }
}

function rail(p: P, metalC: RGB, curved: boolean, accent?: RGB) {
  p.clear();
  const wood = hex(0x6b5131);
  if (!curved) {
    for (const y of [1, 5, 9, 13]) p.rect(2, y, 13, y + 1, wood);
    for (let y = 0; y < 16; y++) { p.set(3, y, metalC); p.set(12, y, metalC); if (accent && y % 4 === 2) { p.set(4, y, accent); p.set(11, y, accent); } }
  } else {
    for (const [x, y] of [[13, 2], [9, 6], [5, 10], [2, 13]]) p.rect(x - 1, y - 1, x + 1, y + 1, wood);
    for (let i = 0; i < 16; i++) {
      const r1 = 12.5, r2 = 3.5;
      const a = (i / 15) * (Math.PI / 2);
      p.set(Math.round(15.5 - Math.cos(a) * r1), Math.round(15.5 - Math.sin(a) * r1), metalC);
      p.set(Math.round(15.5 - Math.cos(a) * r2), Math.round(15.5 - Math.sin(a) * r2), metalC);
    }
  }
}

function door(p: P, c: RGB, top: boolean, iron: boolean) {
  if (iron) metal(p, hex(0xc9c9c9)); else planks(p, c);
  p.bevel(1.12, 0.7);
  if (top && !iron) { p.clear(); planks(p, c); p.bevel(1.1, 0.7); for (const [x0, y0] of [[3, 3], [9, 3]]) for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 4; x++) p.alpha(x, y, 0); }
  if (!top) { p.set(12, 2, hex(0x333333)); p.set(12, 3, hex(0x333333)); }
}

function trapdoor(p: P, c: RGB, iron: boolean) {
  if (iron) metal(p, hex(0xc9c9c9)); else planks(p, c);
  p.bevel(1.12, 0.7);
  for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]]) for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) if (!iron || (x + y) % 2) p.alpha(x, y, 0);
}

function machineSide(p: P, c: RGB) { p.noise(c, 0.1, 0.5); p.bevel(1.1, 0.75); }

function face(p: P, base: RGB, kind: string) {
  machineSide(p, base);
  const dark = hex(0x1c1c1c);
  if (kind === 'furnace') { p.rect(4, 8, 11, 13, dark); p.rect(4, 3, 11, 4, scale(base, 0.7)); }
  if (kind === 'furnace_on') { p.rect(4, 8, 11, 13, hex(0x2a1a0a)); p.rect(5, 10, 10, 13, hex(0xf2a22a)); p.rect(6, 11, 9, 12, hex(0xffe17a)); }
  if (kind === 'dispenser') { p.rect(5, 5, 10, 10, dark); p.rect(6, 4, 9, 11, dark); p.rect(4, 6, 11, 9, dark); }
  if (kind === 'dropper') { p.rect(5, 5, 10, 10, dark); }
}

function gen(name: string): (p: P) => void {
  const n = name;
  const dye = dyeOf(n);
  const wood = woodOf(n);
  const base = colorFor(n);

  // --- exact names ---
  switch (n) {
    case 'missing': return (p) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, ((x >> 3) + (y >> 3)) % 2 ? [248, 0, 248] : [0, 0, 0]); };
    case 'stone': return (p) => p.noise(STONE, 0.09, 0.55);
    case 'smooth_stone': return (p) => { p.noise(hex(0x9e9e9e), 0.04, 0.5, 2); p.bevel(1.08, 0.82); };
    case 'cobblestone': return (p) => cobble(p, hex(0x7f7f7f));
    case 'mossy_cobblestone': return (p) => { cobble(p, hex(0x7a7a7a)); for (let i = 0; i < 40; i++) p.set(Math.floor(p.r() * 16), Math.floor(p.r() * 16), scale(hex(0x5a7a35), 0.8 + p.r() * 0.4)); };
    case 'cobbled_deepslate': return (p) => cobble(p, hex(0x505056));
    case 'deepslate': case 'deepslate_top': return (p) => { p.noise(hex(0x505055), 0.1, 0.3); for (let y = 1; y < 16; y += 3) for (let x = 0; x < 16; x++) if (p.r() < 0.6) p.mul(x, y, 0.82); };
    case 'dirt': case 'farmland_side': return (p) => { p.noise(DIRT, 0.14, 0.5); p.speck(scale(DIRT, 0.7), 12); };
    case 'coarse_dirt': return (p) => { p.noise(hex(0x77553b), 0.16, 0.6); p.speck(hex(0x8f8a84), 10); };
    case 'rooted_dirt': return (p) => { p.noise(hex(0x90674c), 0.12, 0.5); p.speck(hex(0x6b4a2c), 14); };
    case 'grass_block_top': return (p) => p.noise(GRASS, 0.14, 0.45);
    case 'grass_block_side': return (p) => grassSide(p, DIRT, GRASS);
    case 'grass_block_snow': return (p) => grassSide(p, DIRT, GRASS, true);
    case 'mycelium_top': return (p) => { p.noise(hex(0x6f6265), 0.14, 0.5); p.speck(hex(0x9c8f94), 18); };
    case 'mycelium_side': return (p) => grassSide(p, DIRT, hex(0x6f6265));
    case 'podzol_top': return (p) => { p.noise(hex(0x5b3f18), 0.14, 0.5); p.speck(hex(0x7a5a2a), 14); };
    case 'podzol_side': return (p) => grassSide(p, DIRT, hex(0x5b3f18));
    case 'dirt_path_top': return (p) => { p.noise(hex(0x947a41), 0.1, 0.5); p.speck(hex(0x7a6232), 12); };
    case 'dirt_path_side': return (p) => grassSide(p, DIRT, hex(0x947a41));
    case 'farmland': return (p) => { p.noise(hex(0x7a5536), 0.1, 0.3); for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) p.mul(x, y, 0.75); p.bevel(1.05, 0.8); };
    case 'farmland_moist': return (p) => { p.noise(hex(0x4a2f18), 0.1, 0.3); for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) p.mul(x, y, 0.72); p.bevel(1.05, 0.8); };
    case 'sand': return (p) => { p.noise(hex(0xdbd3a0), 0.05, 0.3, 3); p.speck(hex(0xc7bb85), 20); };
    case 'red_sand': return (p) => { p.noise(hex(0xbe6621), 0.06, 0.3, 3); p.speck(hex(0xa3561a), 20); };
    case 'gravel': return (p) => { p.noise(hex(0x837f7e), 0.2, 0.7); p.speck(hex(0x5f5a58), 16); p.speck(hex(0xa8a4a2), 14); };
    case 'clay': return (p) => p.noise(hex(0xa0a6b3), 0.05, 0.5, 2);
    case 'mud': return (p) => p.noise(hex(0x3c3a3d), 0.08, 0.6);
    case 'snow': case 'snow_block': case 'powder_snow': return (p) => p.noise(hex(0xf2f8f8), 0.03, 0.5, 2);
    case 'ice': case 'frosted_ice': return (p) => { p.noise(hex(0x91b7fd), 0.06, 0.6); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.alpha(x, y, 180); for (let i = 3; i < 12; i++) p.set(i, 15 - i, hex(0xd9e7ff), 220); };
    case 'packed_ice': return (p) => { p.noise(hex(0x8db4fa), 0.06, 0.6); for (let i = 3; i < 12; i++) p.set(i, 15 - i, hex(0xd0e0ff)); };
    case 'blue_ice': return (p) => { p.noise(hex(0x74a8fd), 0.07, 0.6); for (let i = 2; i < 13; i++) p.set(i, 14 - i, hex(0xbcd6ff)); };
    case 'water_still': case 'water_flow': return (p) => { p.noise(hex(0x2f5fd0), 0.12, 0.7); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.alpha(x, y, 165); };
    case 'lava_still': case 'lava_flow': return (p) => { p.noise(hex(0xd45a12), 0.18, 0.7); for (let i = 0; i < 24; i++) p.blob(Math.floor(p.r() * 16), Math.floor(p.r() * 16), hex(0xffb43c)); };
    case 'obsidian': return (p) => { p.noise(hex(0x140f22), 0.25, 0.6); p.speck(hex(0x3b2a5c), 10); };
    case 'crying_obsidian': return (p) => { p.noise(hex(0x1a0f2e), 0.25, 0.6); p.speck(hex(0x9a3df0), 14); };
    case 'bedrock': return (p) => { p.noise(hex(0x555555), 0.35, 0.8); };
    case 'netherrack': return (p) => { p.noise(hex(0x6a2828), 0.18, 0.6); p.speck(hex(0x4a1717), 20); };
    case 'soul_sand': return (p) => { p.noise(hex(0x513e32), 0.12, 0.5); for (const [x, y] of [[3, 4], [10, 3], [6, 10], [12, 11]]) { p.set(x, y, hex(0x2d2018)); p.set(x + 2, y, hex(0x2d2018)); p.set(x + 1, y + 2, hex(0x2d2018)); } };
    case 'soul_soil': return (p) => p.noise(hex(0x4b392e), 0.12, 0.5);
    case 'end_stone': return (p) => { p.noise(hex(0xdbde9e), 0.06, 0.5); p.speck(hex(0xc2c47e), 18); };
    case 'glowstone': return (p) => { p.noise(hex(0xc89a52), 0.2, 0.6); for (let i = 0; i < 20; i++) p.blob(Math.floor(p.r() * 16), Math.floor(p.r() * 16), hex(0xffe9a6)); };
    case 'sea_lantern': return (p) => { p.noise(hex(0xacc7be), 0.08, 0.5); p.bevel(1.2, 0.8); p.rect(4, 4, 11, 11, hex(0xe6f2ec)); p.rect(6, 6, 9, 9, hex(0xffffff)); };
    case 'shroomlight': return (p) => { p.noise(hex(0xf19347), 0.12, 0.6); p.speck(hex(0xffd08a), 16); };
    case 'magma_block': return (p) => { p.noise(hex(0x5c2a16), 0.15, 0.6); for (let i = 0; i < 6; i++) { const y = Math.floor(p.r() * 16); for (let x = 0; x < 16; x++) if (p.r() < 0.7) p.set(x, (y + Math.round(Math.sin(x) * 1.2)) & 15, hex(0xd8661a)); } };
    case 'quartz_block_side': case 'quartz_block_top': case 'quartz_block_bottom': case 'quartz_block': case 'smooth_quartz': return (p) => { p.noise(hex(0xebe5de), 0.025, 0.5, 2); p.bevel(1.03, 0.9); };
    case 'sandstone': return (p) => { p.noise(hex(0xd8cb9b), 0.05, 0.3, 3); for (const y of [3, 4, 11]) for (let x = 0; x < 16; x++) p.mul(x, y, 0.9); };
    case 'sandstone_top': case 'sandstone_bottom': case 'cut_sandstone': return (p) => { p.noise(hex(0xdccfa0), 0.04, 0.4, 3); p.bevel(1.05, 0.9); };
    case 'red_sandstone': return (p) => { p.noise(hex(0xba631d), 0.05, 0.3, 3); for (const y of [3, 4, 11]) for (let x = 0; x < 16; x++) p.mul(x, y, 0.88); };
    case 'red_sandstone_top': case 'red_sandstone_bottom': case 'cut_red_sandstone': return (p) => { p.noise(hex(0xbd6620), 0.04, 0.4, 3); p.bevel(1.05, 0.9); };
    case 'prismarine': return (p) => { p.noise(hex(0x63a09a), 0.12, 0.6); p.speck(hex(0x4a7f8a), 16); };
    case 'purpur_block': return (p) => tiles(p, hex(0xa97ea9));
    case 'iron_bars': return (p) => { p.clear(); for (let y = 0; y < 16; y++) for (const x of [1, 6, 9, 14]) p.set(x, y, hex(0x8a8d8f)); for (const y of [1, 14]) p.rect(0, y, 15, y, hex(0x6e7072)); };
    case 'ladder': return (p) => { p.clear(); const w = hex(0x7d6038); for (let y = 0; y < 16; y++) { p.set(2, y, w); p.set(13, y, w); } for (const y of [2, 6, 10, 14]) p.rect(2, y, 13, y, scale(w, 1.1)); };
    case 'cobweb': return (p) => { p.clear(); const c: RGB = [230, 230, 230]; for (let i = 0; i < 16; i++) { p.set(i, i, c); p.set(15 - i, i, c); p.set(7, i, c); p.set(i, 8, c); } };
    case 'bookshelf': return (p) => { planks(p, WOOD.oak.planks); const cols = [0x8b2b2b, 0x2b4f8b, 0x2b8b4f, 0x8b7a2b, 0x5a2b8b]; for (const y0 of [1, 9]) for (let x = 1; x < 15; x++) { const c = hex(cols[Math.floor(p.r() * cols.length)]); for (let y = y0; y < y0 + 6; y++) p.set(x, y, scale(c, 0.85 + (x % 2) * 0.15)); } };
    case 'crafting_table_top': return (p) => { planks(p, hex(0x9c7344)); for (let i = 1; i < 15; i++) { p.set(i, 4, hex(0x5a3d1e)); p.set(i, 11, hex(0x5a3d1e)); p.set(4, i, hex(0x5a3d1e)); p.set(11, i, hex(0x5a3d1e)); } };
    case 'crafting_table_side': case 'crafting_table_front': return (p) => { planks(p, hex(0x8a6a3e)); p.rect(0, 0, 15, 2, hex(0x6b4c2a)); p.rect(4, 6, 6, 12, hex(0x7a7a7a)); p.rect(10, 6, 11, 13, hex(0x5a3d1e)); };
    case 'tnt_side': return (p) => { p.noise(hex(0xc8372a), 0.08, 0.3); p.rect(0, 5, 15, 10, hex(0xe8e8e8)); p.rect(3, 6, 12, 9, hex(0x2a2a2a)); };
    case 'tnt_top': case 'tnt_bottom': return (p) => { p.noise(hex(0xc8372a), 0.08, 0.3); p.rect(6, 6, 9, 9, hex(0x6a6a6a)); };
    case 'pumpkin_side': return (p) => { p.noise(hex(0xc07615), 0.06, 0.2); for (const x of [0, 4, 8, 12]) for (let y = 0; y < 16; y++) p.mul(x, y, 0.8); };
    case 'pumpkin_top': return (p) => { p.noise(hex(0xc07615), 0.06, 0.2); p.rect(6, 6, 9, 9, hex(0x6f6a1a)); };
    case 'carved_pumpkin': case 'jack_o_lantern': { const lit = n === 'jack_o_lantern'; return (p) => { gen('pumpkin_side')(p); const c = lit ? hex(0xffd24a) : hex(0x2a1708); for (const [x, y] of [[3, 4], [4, 4], [11, 4], [12, 4], [3, 5], [12, 5]]) p.set(x, y, c); p.rect(3, 9, 12, 11, c); p.set(5, 9, hex(0xc07615)); p.set(10, 9, hex(0xc07615)); }; }
    case 'melon_side': return (p) => { p.noise(hex(0x6f9118), 0.08, 0.3); for (const x of [1, 5, 9, 13]) for (let y = 0; y < 16; y++) p.set(x, y, scale(hex(0xa8c039), 0.9 + p.r() * 0.2)); };
    case 'melon_top': return (p) => { p.noise(hex(0x7a9a22), 0.08, 0.3); p.rect(6, 6, 9, 9, hex(0x8f8a2a)); };
    case 'hay_block_side': return (p) => { p.noise(hex(0xb79a1d), 0.12, 0.1); for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (p.r() < 0.25) p.mul(x, y, 0.85); for (const y of [3, 12]) p.rect(0, y, 15, y + 1, hex(0x8f2d18)); };
    case 'hay_block_top': return (p) => { p.noise(hex(0xbaa02a), 0.15, 0.4); p.bevel(1.05, 0.85); };
    case 'bone_block_side': return (p) => { p.noise(hex(0xe1ddc9), 0.04, 0.3, 2); for (const y of [2, 7, 12]) for (let x = 0; x < 16; x++) p.mul(x, y, 0.85); };
    case 'bone_block_top': return (p) => { p.noise(hex(0xe1ddc9), 0.04, 0.3, 2); p.rect(5, 5, 10, 10, hex(0xc9c4ab)); };
    case 'cactus_side': return (p) => { p.noise(hex(0x5a8a2b), 0.08, 0.2); for (const x of [2, 7, 12]) for (let y = 0; y < 16; y++) p.mul(x, y, 0.75); for (let i = 0; i < 10; i++) p.set(1 + Math.floor(p.r() * 14), Math.floor(p.r() * 16), hex(0xd8d8a0)); for (const x of [0, 15]) for (let y = 0; y < 16; y++) p.alpha(x, y, 0); };
    case 'cactus_top': return (p) => { p.noise(hex(0x6a9a35), 0.08, 0.4); p.bevel(1.1, 0.75, 1); p.rect(6, 6, 9, 9, hex(0x7fb04a)); };
    case 'cactus_bottom': return (p) => p.noise(hex(0x7a9a55), 0.06, 0.4);
    case 'slime_block': return (p) => { p.fill(hex(0x6fc05b), 170); p.rect(3, 3, 12, 12, hex(0x83d46c), 220); p.rect(5, 5, 10, 10, hex(0x5aa84a), 220); };
    case 'honey_block': return (p) => { p.fill(hex(0xf0a020), 190); p.rect(2, 2, 13, 13, hex(0xf7b52e), 205); };
    case 'honeycomb_block': return (p) => { p.noise(hex(0xe59a1e), 0.1, 0.5); for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) p.mul(x, y, 0.8); };
    case 'sponge': case 'wet_sponge': return (p) => { p.noise(n === 'sponge' ? hex(0xc4b34c) : hex(0xa69a3a), 0.1, 0.5); for (let i = 0; i < 12; i++) p.set(Math.floor(p.r() * 16), Math.floor(p.r() * 16), hex(0x8c7d2a)); };
    case 'redstone_lamp': return (p) => { p.noise(hex(0x5f3a1e), 0.12, 0.5); p.rect(3, 3, 12, 12, hex(0x7a4a22)); p.bevel(1.05, 0.7); };
    case 'redstone_lamp_on': return (p) => { p.noise(hex(0xd78c3a), 0.12, 0.5); p.rect(3, 3, 12, 12, hex(0xffd08a)); p.bevel(1.05, 0.7); };
    case 'target_side': case 'target_top': return (p) => { p.fill(hex(0xe8dcc8)); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); if (r < 2 || (r > 3.5 && r < 5.5)) p.set(x, y, hex(0xc83030)); } };
    case 'note_block': case 'jukebox_side': return (p) => { planks(p, hex(0x6b4a2e)); p.bevel(1.1, 0.7); };
    case 'jukebox_top': return (p) => { planks(p, hex(0x6b4a2e)); p.rect(3, 3, 12, 12, hex(0x2a1a10)); };
    case 'furnace_front': case 'smoker_front': case 'blast_furnace_front': return (p) => face(p, hex(0x6e6e6e), 'furnace');
    case 'furnace_front_on': case 'smoker_front_on': case 'blast_furnace_front_on': return (p) => face(p, hex(0x6e6e6e), 'furnace_on');
    case 'furnace_side': case 'smoker_side': case 'blast_furnace_side': return (p) => machineSide(p, hex(0x737373));
    case 'furnace_top': case 'smoker_top': case 'blast_furnace_top': return (p) => { p.noise(hex(0x8a8a8a), 0.06, 0.5); p.bevel(1.08, 0.8); };
    case 'dispenser_front': case 'dispenser_front_vertical': return (p) => face(p, hex(0x737373), 'dispenser');
    case 'dropper_front': case 'dropper_front_vertical': return (p) => face(p, hex(0x737373), 'dropper');
    case 'observer_front': return (p) => { p.noise(hex(0x5f5f5f), 0.08, 0.5); p.bevel(1.1, 0.7); p.rect(2, 4, 13, 6, hex(0x2a2a2a)); p.rect(2, 9, 13, 11, hex(0x2a2a2a)); p.rect(4, 5, 5, 5, hex(0x8a8a8a)); p.rect(10, 5, 11, 5, hex(0x8a8a8a)); p.rect(4, 10, 11, 10, hex(0x444444)); };
    case 'observer_back': return (p) => { p.noise(hex(0x5f5f5f), 0.08, 0.5); p.bevel(1.1, 0.7); p.rect(6, 6, 9, 9, hex(0x3a1c1c)); };
    case 'observer_back_on': return (p) => { p.noise(hex(0x5f5f5f), 0.08, 0.5); p.bevel(1.1, 0.7); p.rect(6, 6, 9, 9, hex(0xff2a2a)); };
    case 'observer_side': return (p) => { p.noise(hex(0x6a6a6a), 0.08, 0.5); p.bevel(1.1, 0.7); for (let y = 3; y < 13; y++) p.set(7, y, hex(0x3a3a3a)); };
    case 'observer_top': return (p) => { p.noise(hex(0x6a6a6a), 0.08, 0.5); p.bevel(1.1, 0.7); for (let y = 4; y < 13; y++) p.set(7, y, hex(0x8a2a2a)); for (let i = 0; i < 4; i++) { p.set(7 - i, 4 + i, hex(0x8a2a2a)); p.set(7 + i, 4 + i, hex(0x8a2a2a)); } };
    case 'piston_top': case 'piston_top_sticky': return (p) => { planks(p, hex(0xa58a5a)); p.bevel(1.1, 0.75); if (n.endsWith('sticky')) p.rect(2, 2, 13, 13, hex(0x7fc76a)); else p.rect(5, 5, 10, 10, hex(0x9a9a9a)); };
    case 'piston_side': return (p) => { cobble(p, hex(0x777777)); p.rect(0, 0, 15, 3, hex(0xa58a5a)); for (let x = 0; x < 16; x++) p.mul(x, 3, 0.7); p.rect(6, 4, 9, 13, hex(0x8f8f8f)); };
    case 'piston_bottom': case 'piston_inner': return (p) => { cobble(p, hex(0x777777)); p.rect(5, 5, 10, 10, hex(0x5a5a5a)); };
    case 'hopper': case 'hopper_outside': case 'hopper_inside': case 'hopper_top': return (p) => { metal(p, hex(0x4a4a4c)); p.rect(3, 3, 12, 12, hex(0x37373a)); };
    case 'chest_top': return (p) => { planks(p, hex(0xa1702c)); p.bevel(1.1, 0.6); };
    case 'chest_side': return (p) => { planks(p, hex(0x9a6a28)); p.bevel(1.1, 0.6); p.rect(0, 5, 15, 5, hex(0x3a2810)); };
    case 'chest_front': return (p) => { gen('chest_side')(p); p.rect(7, 4, 8, 7, hex(0xc8c8c8)); };
    case 'ender_chest': return (p) => { p.noise(hex(0x1a2a2a), 0.2, 0.5); p.bevel(1.2, 0.6); p.rect(7, 4, 8, 7, hex(0x2ad1a0)); };
    case 'barrel_side': return (p) => { planks(p, hex(0x7a5a33)); for (const y of [2, 13]) p.rect(0, y, 15, y, hex(0x3a3a3a)); };
    case 'barrel_top': case 'barrel_top_open': case 'barrel_bottom': return (p) => { planks(p, hex(0x8a6a3a)); p.bevel(1.1, 0.65); p.rect(5, 5, 10, 10, n.endsWith('open') ? hex(0x2a1a0e) : hex(0x6a4a2a)); };
    case 'composter_side': case 'composter': return (p) => { planks(p, hex(0x7a5a33)); p.bevel(1.1, 0.7); };
    case 'cauldron': case 'cauldron_side': return (p) => metal(p, hex(0x4a4a4c));
    case 'anvil': return (p) => metal(p, hex(0x444446));
    case 'spawner': return (p) => { p.clear(); for (let i = 0; i < 16; i++) for (const j of [0, 5, 10, 15]) { p.set(i, j, hex(0x2a3a4a)); p.set(j, i, hex(0x2a3a4a)); } };
    case 'enchanting_table_top': return (p) => { p.noise(hex(0x7a1f1f), 0.1, 0.4); p.bevel(1.1, 0.7); p.rect(6, 6, 9, 9, hex(0x2aa8c8)); };
    case 'enchanting_table_side': return (p) => { p.noise(hex(0x140f22), 0.2, 0.5); p.rect(0, 0, 15, 3, hex(0x7a1f1f)); };
    case 'end_portal_frame_top': return (p) => { p.noise(hex(0x5f7a5a), 0.08, 0.4); p.bevel(1.15, 0.7); p.rect(4, 4, 11, 11, hex(0x2c4a40)); };
    case 'end_portal_frame_side': return (p) => { p.noise(hex(0xdbde9e), 0.06, 0.4); p.rect(0, 0, 15, 2, hex(0x4a6a5a)); };
    case 'daylight_detector_top': return (p) => { metal(p, hex(0x9a8a6a)); p.rect(2, 2, 13, 13, hex(0x3a5a8a)); p.rect(3, 3, 6, 6, hex(0x7aa0d8)); };
    case 'daylight_detector_side': return (p) => planks(p, hex(0x8a6a3e));
    case 'lantern': case 'soul_lantern': return (p) => { p.clear(); p.rect(4, 2, 11, 15, hex(0x3a3a40)); p.rect(5, 4, 10, 13, n === 'lantern' ? hex(0xffc35a) : hex(0x5ad8e8)); };
    case 'iron_chain': case 'copper_chain': return (p) => { p.clear(); for (let y = 0; y < 16; y++) if (y % 4 !== 3) { p.set(7, y, hex(0x55585e)); p.set(8, y, hex(0x3a3c40)); } };
    case 'end_rod': return (p) => { p.clear(); p.rect(6, 0, 9, 15, hex(0xf2ece0)); };
    case 'lightning_rod': return (p) => { p.clear(); p.rect(6, 0, 9, 15, hex(0xc06c50)); };
    case 'flower_pot': return (p) => { p.noise(hex(0x7a4430), 0.08, 0.4); p.bevel(1.1, 0.75); };
    case 'scaffolding_side': case 'scaffolding_top': return (p) => { p.clear(); const c = hex(0xb08a43); for (let i = 0; i < 16; i++) { p.set(i, 0, c); p.set(i, 15, c); p.set(0, i, c); p.set(15, i, c); p.set(i, i, c); } };
    case 'bamboo_stalk': return (p) => { p.clear(); for (let y = 0; y < 16; y++) for (let x = 6; x < 10; x++) p.set(x, y, scale(hex(0x7a9a2c), y % 6 === 0 ? 0.75 : 0.95 + p.r() * 0.1)); };
    case 'kelp': case 'kelp_plant': case 'seagrass': case 'tall_seagrass_top': case 'tall_seagrass_bottom':
      return (p) => crossSprite(p, (q) => { for (let i = 0; i < 4; i++) { let x = 3 + i * 3; for (let y = 15; y >= 1; y--) { if (q.r() < 0.35) x += q.r() < 0.5 ? -1 : 1; q.set(Math.max(0, Math.min(15, x)), y, scale(hex(0x4a8a2a), 0.8 + q.r() * 0.3)); } } });
    case 'sugar_cane': return (p) => crossSprite(p, (q) => { for (const x of [3, 7, 12]) for (let y = 0; y < 16; y++) { q.set(x, y, scale(hex(0x8fc45a), y % 5 === 0 ? 0.75 : 0.95)); q.set(x + 1, y, scale(hex(0x7ab04a), 0.95)); } for (const [x, y] of [[2, 4], [5, 9], [10, 3], [14, 11]]) q.set(x, y, hex(0x5a9a3a)); });
    case 'short_grass': case 'tall_grass_top': case 'tall_grass_bottom': case 'fern': case 'large_fern_top': case 'large_fern_bottom': case 'bush': case 'short_dry_grass': case 'tall_dry_grass':
      return (p) => crossSprite(p, (q) => stalks(q, n.includes('dry') ? hex(0xb8a060) : hex(0x5f9e3a), n.startsWith('short') || n === 'fern' ? 10 : 15, 7));
    case 'dead_bush': return (p) => crossSprite(p, (q) => stalks(q, hex(0x7a5a2a), 11, 5));
    case 'nether_wart_stage0': case 'nether_wart_stage1': case 'nether_wart_stage2':
      return (p) => crossSprite(p, (q) => stalks(q, hex(0x8a1c1c), 4 + Number(n.slice(-1)) * 4, 5, hex(0xb83232)));
    case 'red_mushroom': case 'brown_mushroom': case 'crimson_fungus': case 'warped_fungus':
      return (p) => crossSprite(p, (q) => { q.rect(7, 9, 8, 15, hex(0xd8d0c0)); const cap = n.startsWith('red') ? hex(0xc8282a) : n.startsWith('brown') ? hex(0x9a6a4a) : n.startsWith('crimson') ? hex(0x9a1a2a) : hex(0x1a8a7a); q.rect(4, 6, 11, 9, cap); q.rect(5, 5, 10, 5, cap); if (n.startsWith('red')) { q.set(6, 7, [255, 255, 255]); q.set(9, 6, [255, 255, 255]); } });
    case 'torch': case 'soul_torch': case 'redstone_torch': case 'redstone_torch_off': case 'copper_torch':
      return (p) => { p.clear(); p.rect(7, 8, 8, 15, hex(0x6b5131)); p.set(8, 9, hex(0x54401f)); const flame = n === 'soul_torch' ? hex(0x5ad8e8) : n === 'redstone_torch' ? hex(0xff3a2a) : n === 'redstone_torch_off' ? hex(0x5a1a1a) : n === 'copper_torch' ? hex(0x8ae89a) : hex(0xffd24a); p.rect(7, 6, 8, 7, flame); p.set(7, 6, mix(flame, [255, 255, 255], 0.5)); };
    case 'nether_portal': return (p) => { p.noise(hex(0x6a1ad8), 0.25, 0.7); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.alpha(x, y, 175); };
    case 'fire_0': case 'soul_fire_0': return (p) => crossSprite(p, (q) => { const c = n.startsWith('soul') ? hex(0x4ac8e8) : hex(0xf28a1a); for (let x = 0; x < 16; x++) { const h = 6 + Math.floor(q.r() * 10); for (let y = 15; y > 15 - h; y--) q.set(x, y, mix(c, [255, 240, 120], (y - (15 - h)) / h * 0.7)); } });
    case 'vine': return (p) => { p.clear(); for (let i = 0; i < 70; i++) p.set(Math.floor(p.r() * 16), Math.floor(p.r() * 16), scale(hex(0x4a7a2a), 0.8 + p.r() * 0.4)); };
    case 'lily_pad': return (p) => { p.clear(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 7.5 && !(x > 7 && Math.abs(y - 7.5) < 1.2)) p.set(x, y, scale(hex(0x2f7a2a), 0.85 + p.r() * 0.3)); } };
    case 'redstone_dust_dot': return dust;
    case 'cocoa_stage0': case 'cocoa_stage1': case 'cocoa_stage2': return (p) => { p.noise(hex([0x8a9a3a, 0xb0742a, 0x9a5a2a][Number(n.slice(-1))]), 0.1, 0.4); p.bevel(1.1, 0.75); };
    case 'sweet_berry_bush_stage0': case 'sweet_berry_bush_stage1': case 'sweet_berry_bush_stage2': case 'sweet_berry_bush_stage3':
      return (p) => crossSprite(p, (q) => { const s = Number(n.slice(-1)); stalks(q, hex(0x3a6a2a), 6 + s * 3, 6); if (s >= 2) for (let i = 0; i < s * 3; i++) q.set(2 + Math.floor(q.r() * 12), 16 - Math.floor(q.r() * (6 + s * 2)), hex(0xc8202a)); });
    case 'pumpkin_stem': case 'melon_stem': case 'attached_pumpkin_stem': case 'attached_melon_stem':
      return (p) => crossSprite(p, (q) => { for (let y = 2; y < 16; y++) q.set(7 + (y % 4 === 0 ? 1 : 0), y, [200, 200, 200]); q.set(6, 6, [200, 200, 200]); q.set(9, 9, [200, 200, 200]); });
    case 'bed_side': return (p) => { planks(p, WOOD.oak.planks); };
    case 'cake_top': return (p) => { p.noise(hex(0xf4ece4), 0.04, 0.4); for (const [x, y] of [[3, 3], [10, 5], [6, 10], [12, 12]]) p.set(x, y, hex(0xc8202a)); };
    case 'cake_side': return (p) => { p.noise(hex(0xe8dcd0), 0.04, 0.4); p.rect(0, 8, 15, 9, hex(0xc8202a)); p.rect(0, 10, 15, 15, hex(0xa86a3a)); };
  }

  // --- patterns ---
  const m = /^(wheat|carrots|potatoes|beetroots|torchflower_crop|pitcher_crop)_stage(\d)$/.exec(n);
  if (m) {
    const stage = Number(m[2]), max = m[1] === 'wheat' ? 7 : 3, t = stage / max;
    const ripe = m[1] === 'wheat' ? mix(hex(0x5f9e2a), hex(0xc8a642), t) : hex(0x4f9a2a);
    const head = stage === max ? (m[1] === 'wheat' ? hex(0xd8b84a) : m[1] === 'carrots' ? hex(0xe8862a) : m[1] === 'potatoes' ? hex(0xc8a060) : hex(0xa8202a)) : undefined;
    return (p) => crossSprite(p, (q) => stalks(q, ripe, 3 + Math.round(t * 12), 6, head));
  }
  const dm = /^redstone_dust_([nesw]+)$/.exec(n);
  if (dm) { const mask = (dm[1].includes('n') ? 1 : 0) | (dm[1].includes('e') ? 2 : 0) | (dm[1].includes('s') ? 4 : 0) | (dm[1].includes('w') ? 8 : 0); return (p) => dustLines(p, mask); }
  if (n.endsWith('rail') || n.endsWith('rail_corner') || n.endsWith('rail_on')) {
    const accent = n.startsWith('powered') ? hex(n.endsWith('_on') ? 0xff5a2a : 0x7a2a1a) : n.startsWith('activator') ? hex(0xa83a2a) : n.startsWith('detector') ? hex(0x8a2a2a) : undefined;
    const metalC = n.startsWith('powered') ? hex(0xd8b84a) : hex(0x9a9a9a);
    return (p) => rail(p, metalC, n.endsWith('corner'), accent);
  }
  if (/_door_(top|bottom)$/.test(n)) { const top = n.endsWith('top'); const iron = n.startsWith('iron'); return (p) => door(p, wood ? WOOD[wood].planks : materialColor(n) ?? base, top, iron); }
  if (n.endsWith('_trapdoor')) return (p) => trapdoor(p, wood ? WOOD[wood].planks : materialColor(n) ?? base, n.startsWith('iron'));
  if (/_bed_(head|foot)$/.test(n) && dye) {
    const head = n.endsWith('head');
    return (p) => { wool(p, WOOL[dye]); if (head) p.rect(1, 1, 14, 5, hex(0xf2f2f2)); };
  }
  if (n.endsWith('_sapling') || n === 'mangrove_propagule' || n === 'azalea_plant') {
    const leaf = wood ? WOOD[wood].leaves : hex(0x4a8c26);
    return (p) => crossSprite(p, (q) => { q.rect(7, 9, 8, 15, hex(0x6b5131)); for (let i = 0; i < 26; i++) q.set(3 + Math.floor(q.r() * 10), 2 + Math.floor(q.r() * 9), scale(leaf, 0.8 + q.r() * 0.4)); });
  }
  const FLOWERS: Record<string, number> = {
    poppy: 0xd8282a, dandelion: 0xf2d22a, blue_orchid: 0x3ab0e8, allium: 0xb86ad8, azure_bluet: 0xe8eef2, red_tulip: 0xe02a2a,
    orange_tulip: 0xf28a2a, white_tulip: 0xf2f2f2, pink_tulip: 0xf2a8c8, oxeye_daisy: 0xf2f2e8, cornflower: 0x4a6ae8,
    lily_of_the_valley: 0xf8f8f8, wither_rose: 0x2a2a2a, torchflower: 0xf28a2a, sunflower_front: 0xf2c82a, lilac_top: 0xc88ad8,
    rose_bush_top: 0xd8282a, peony_top: 0xf2b8d8, closed_eyeblossom: 0x8a8a9a, open_eyeblossom: 0xf2a83a, pink_petals: 0xf2a8c8, wildflowers: 0xf2e85a,
    cactus_flower: 0xf28ab8, firefly_bush: 0x6a8a3a, pitcher_plant_top: 0x6a8ad8,
  };
  if (n in FLOWERS) return (p) => crossSprite(p, (q) => flower(q, hex(FLOWERS[n])));
  if (/(lilac|rose_bush|peony|sunflower|pitcher_plant)_bottom$/.test(n)) return (p) => crossSprite(p, (q) => stalks(q, hex(0x3f7a2a), 16, 4));
  if (n.endsWith('_coral') || n.endsWith('_coral_fan')) return (p) => crossSprite(p, (q) => stalks(q, base, 13, 6, scale(base, 1.2)));
  if (n.endsWith('_leaves')) return (p) => leaves(p, wood ? WOOD[wood].leaves : n.startsWith('azalea') ? hex(0x5d7a2e) : n.startsWith('flowering') ? hex(0x6a7a3a) : base);
  if (n.endsWith('_planks') || n === 'bamboo_mosaic') return (p) => planks(p, wood ? WOOD[wood].planks : base);
  if (/_log_top$|_stem_top$|_wood_top$|_hyphae_top$|bamboo_block_top$/.test(n) && wood) return (p) => logTop(p, WOOD[wood].inner, n.startsWith('stripped') ? WOOD[wood].inner : WOOD[wood].bark);
  if (/_log$|_stem$|_wood$|_hyphae$|^bamboo_block$|^stripped_bamboo_block$/.test(n) && wood) return (p) => logSide(p, n.startsWith('stripped') ? WOOD[wood].inner : WOOD[wood].bark, wood === 'birch' && !n.startsWith('stripped') ? WOOD.birch.mark : undefined);
  if (n.includes('glass')) {
    const c = dye ? GLASS[dye] : n.startsWith('tinted') ? hex(0x2a2430) : hex(0xd8eef2);
    return (p) => glass(p, c, dye ? 120 : n.startsWith('tinted') ? 200 : 0);
  }
  if (n.endsWith('_ore')) {
    const deep = n.startsWith('deepslate');
    const nether = n.startsWith('nether');
    const stoneC = deep ? hex(0x505055) : nether ? hex(0x6a2828) : STONE;
    const oreName = n.replace('deepslate_', '').replace('nether_', '').replace('_ore', '');
    return (p) => ore(p, stoneC, materialColor(oreName) ?? (oreName === 'quartz' ? hex(0xe8e0d8) : base));
  }
  if (/^raw_(iron|gold|copper)_block$/.test(n)) return (p) => { p.noise(base, 0.2, 0.7); p.speck(scale(base, 0.7), 20); };
  if (n.endsWith('_wool') || n.endsWith('_carpet')) return (p) => wool(p, dye ? WOOL[dye] : base);
  if (n.endsWith('_concrete_powder')) return (p) => { p.noise(mix(dye ? CONCRETE[dye] : base, [255, 255, 255], 0.12), 0.1, 0.2); };
  if (n.endsWith('_concrete')) return (p) => p.noise(dye ? CONCRETE[dye] : base, 0.025, 0.5, 2);
  if (n.endsWith('_glazed_terracotta')) {
    const c = dye ? TERRACOTTA[dye] : base;
    return (p) => { p.noise(mix(c, [255, 255, 255], 0.25), 0.05, 0.4); for (let i = 0; i < 16; i++) { p.set(i, i, scale(c, 0.7)); p.set(i, (i + 8) % 16, scale(c, 0.85)); } p.bevel(1.1, 0.8); };
  }
  if (n.endsWith('terracotta')) return (p) => p.noise(dye ? TERRACOTTA[dye] : hex(0x985e43), 0.05, 0.5, 3);
  if (n.endsWith('shulker_box')) return (p) => { p.noise(dye ? WOOL[dye] : hex(0x8b5f8b), 0.06, 0.4); p.bevel(1.15, 0.7); p.rect(0, 7, 15, 7, scale(dye ? WOOL[dye] : hex(0x8b5f8b), 0.6)); };
  if (n === 'bricks' || n === 'brick') return (p) => bricks(p, hex(0x966253), hex(0xa79d93));
  if (n.endsWith('bricks') || n.endsWith('brick')) {
    const c = materialColor(n.replace(/_?bricks?$/, '')) ?? base;
    if (n.includes('nether') || n.includes('mud')) return (p) => bricks(p, c, scale(c, n.includes('mud') ? 0.8 : 1.6));
    return (p) => stoneBricks(p, c);
  }
  if (n.endsWith('tiles')) return (p) => tiles(p, materialColor(n) ?? base);
  if (/^(iron|gold|copper|netherite|exposed_copper|weathered_copper|oxidized_copper)_block$|^waxed_/.test(n) || /^(cut_|chiseled_)?(exposed_|weathered_|oxidized_)?copper$/.test(n) || n.endsWith('copper_block')) {
    const c = materialColor(n) ?? base;
    if (n.includes('cut_')) return (p) => tiles(p, c);
    return (p) => metal(p, c);
  }
  if (/^(diamond|emerald|lapis|redstone|coal|amethyst)_block$/.test(n)) return (p) => gem(p, materialColor(n) ?? base);
  if (n.startsWith('chiseled_')) return (p) => { p.noise(base, 0.05, 0.4, 3); p.bevel(1.15, 0.75); p.bevel(0.8, 1.15, 3); };
  if (n.startsWith('polished_') || n.startsWith('smooth_')) return (p) => { p.noise(base, 0.04, 0.5, 2); p.bevel(1.12, 0.8); };
  if (n.startsWith('cut_')) return (p) => tiles(p, base);
  if (n.endsWith('_top') || n.endsWith('_bottom')) return gen(n.replace(/_(top|bottom)$/, ''));
  if (n.endsWith('_side') || n.endsWith('_front')) return (p) => machineSide(p, colorFor(n.replace(/_(side|front)$/, '')));
  if (n.includes('mossy')) return (p) => { stoneBricks(p, hex(0x7a7a7a)); for (let i = 0; i < 40; i++) p.set(Math.floor(p.r() * 16), Math.floor(p.r() * 16), scale(hex(0x5a7a35), 0.8 + p.r() * 0.4)); };
  if (n.includes('moss')) return (p) => p.noise(n.includes('pale') ? hex(0x9aa18e) : hex(0x596d2d), 0.14, 0.5);
  if (n.includes('basalt')) return (p) => { p.noise(base, 0.1, 0.2); for (const x of [2, 6, 11]) for (let y = 0; y < 16; y++) p.mul(x, y, 0.8); };
  return (p) => p.noise(base, 0.1, 0.5);
}

const cache = new Map<string, { data: Uint8ClampedArray }>();

function hasHoles(d: Uint8ClampedArray): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) return true;
  return false;
}

export function proceduralTexture(name: string): Uint8ClampedArray {
  let hit = cache.get(name);
  if (!hit) {
    const p = new P(rng(hashString(name)));
    if (name.startsWith('cross:')) {
      // Sprites for plant-like blocks; unknown names get a generic plant tinted by the block colour.
      const n = name.slice(6);
      gen(n)(p);
      if (!hasHoles(p.d)) { p.clear(); stalks(p, colorFor(n), 12, 6, scale(colorFor(n), 1.25)); }
    } else gen(name)(p);
    hit = { data: p.d };
    cache.set(name, hit);
  }
  return hit.data;
}
