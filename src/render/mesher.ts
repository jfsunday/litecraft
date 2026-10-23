import type { VanillaResolver } from '../assets/vanilla';
import type { BlockRegistry } from '../blocks/info';
import { proceduralParts } from '../blocks/procmodel';
import { blockTint, type Colormaps } from '../blocks/tint';
import type { World } from '../world/world';
import { bake } from './model';
import { KIND_TRANSLUCENT, type TextureBank } from './textures';

export interface MeshQuad {
  pos: Float32Array;
  uv: Float32Array;
  layer: number;
  trans: boolean;
  rgb: [number, number, number];
  dir: number;
  cull: number;
  ao: boolean;
  flush: boolean;
}

export interface MeshModel {
  quads: MeshQuad[];
  fluid: 0 | 1 | 2;
  cullGroup: string | null;
}

const SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AO = [0.42, 0.6, 0.8, 1.0];
// Procedural textures for these are grayscale and always need the colour provider.
const ALWAYS_TINT = new Set(['redstone_wire', 'pumpkin_stem', 'melon_stem', 'attached_pumpkin_stem', 'attached_melon_stem']);

/** Per-state compiled models (vanilla assets if loaded, procedural otherwise). */
export class ModelLibrary {
  private models: MeshModel[] = [];
  vanilla: VanillaResolver | null = null;
  colormaps: Colormaps = {};
  constructor(readonly reg: BlockRegistry, readonly bank: TextureBank) {}

  reset(vanilla: VanillaResolver | null) {
    this.vanilla = vanilla;
    this.colormaps = vanilla?.colormaps ?? {};
    this.models = [];
    this.bank.setVanilla(vanilla);
  }

  get(id: number): MeshModel {
    let m = this.models[id];
    if (!m) { m = this.build(id); this.models[id] = m; }
    return m;
  }

  private build(id: number): MeshModel {
    const info = this.reg.info(id);
    if (info.air) return { quads: [], fluid: 0, cullGroup: null };
    const vanilla = this.vanilla?.hasModels && info.name.startsWith('minecraft:') ? this.vanilla.parts(info.short, info.props) : null;
    const parts = vanilla ?? proceduralParts(info);
    const emissive = info.emit > 0;
    const quads = bake(parts).map((q): MeshQuad => {
      const layer = this.bank.layer(q.tex);
      const tintable = q.tint >= 0 && (this.bank.isPack(layer) || ALWAYS_TINT.has(info.short));
      const tint = tintable ? blockTint(info.short, info.props, q.tint, this.colormaps) : -1;
      let f = q.shade ? SHADE[q.dir] : 1;
      if (emissive || q.emission > 0) f = Math.max(f, 0.92);
      const rgb: [number, number, number] = tint >= 0 ? [((tint >> 16) & 255) / 255 * f, ((tint >> 8) & 255) / 255 * f, (tint & 255) / 255 * f] : [f, f, f];
      return {
        pos: Float32Array.from(q.pos), uv: Float32Array.from(q.uv), layer,
        trans: this.bank.kind(layer) === KIND_TRANSLUCENT, rgb, dir: q.dir, cull: q.cull,
        ao: q.ao && q.aligned && !emissive, flush: q.flush,
      };
    });
    const s = info.short;
    const cullGroup = (s.includes('glass') && !s.endsWith('pane')) || s === 'ice' || s === 'slime_block' || s === 'honey_block' ? s : null;
    return { quads, fluid: info.fluid, cullGroup };
  }

  fluidTexture(fluid: 1 | 2): { layer: number; trans: boolean; tint: number } {
    const layer = this.bank.layer(fluid === 1 ? 'proc:water_still' : 'proc:lava_still');
    return { layer, trans: fluid === 1 || this.bank.kind(layer) === KIND_TRANSLUCENT, tint: fluid === 1 && this.bank.isPack(layer) ? 0x3f76e4 : -1 };
  }
}

export interface GeomData {
  pos: Float32Array;
  uv: Float32Array;
  layer: Float32Array;
  color: Uint8Array;
  index: Uint32Array;
}

class Builder {
  pos = new Float32Array(3 * 4096);
  uv = new Float32Array(2 * 4096);
  layer = new Float32Array(4096);
  color = new Uint8Array(4 * 4096);
  index = new Uint32Array(6 * 1024);
  nv = 0;
  ni = 0;

  private grow(nv: number) {
    if (nv * 3 > this.pos.length) {
      const cap = Math.max(nv, (this.pos.length / 3) * 2);
      const g = <T extends Float32Array | Uint8Array>(a: T, k: number): T => { const b = new (a.constructor as { new(n: number): T })(cap * k); b.set(a); return b; };
      this.pos = g(this.pos, 3); this.uv = g(this.uv, 2); this.layer = g(this.layer, 1); this.color = g(this.color, 4);
    }
    const ni = (nv / 4) * 6;
    if (ni > this.index.length) { const b = new Uint32Array(Math.max(ni, this.index.length * 2)); b.set(this.index); this.index = b; }
  }

  quad(p: ArrayLike<number>, ox: number, oy: number, oz: number, uv: ArrayLike<number>, layer: number, rgb: ArrayLike<number>, ao: ArrayLike<number> | null) {
    this.grow(this.nv + 4);
    const v = this.nv;
    for (let i = 0; i < 4; i++) {
      this.pos[(v + i) * 3] = p[i * 3] + ox;
      this.pos[(v + i) * 3 + 1] = p[i * 3 + 1] + oy;
      this.pos[(v + i) * 3 + 2] = p[i * 3 + 2] + oz;
      this.uv[(v + i) * 2] = uv[i * 2];
      this.uv[(v + i) * 2 + 1] = uv[i * 2 + 1];
      this.layer[v + i] = layer;
      const a = ao ? AO[ao[i]] : 1;
      this.color[(v + i) * 4] = Math.min(255, rgb[0] * a * 255);
      this.color[(v + i) * 4 + 1] = Math.min(255, rgb[1] * a * 255);
      this.color[(v + i) * 4 + 2] = Math.min(255, rgb[2] * a * 255);
      this.color[(v + i) * 4 + 3] = 255;
    }
    const flip = ao ? ao[0] + ao[2] < ao[1] + ao[3] : false;
    const ix = this.index, n = this.ni;
    if (flip) { ix[n] = v + 1; ix[n + 1] = v + 2; ix[n + 2] = v + 3; ix[n + 3] = v + 1; ix[n + 4] = v + 3; ix[n + 5] = v; }
    else { ix[n] = v; ix[n + 1] = v + 1; ix[n + 2] = v + 2; ix[n + 3] = v; ix[n + 4] = v + 2; ix[n + 5] = v + 3; }
    this.nv += 4;
    this.ni += 6;
  }

  result(): GeomData | null {
    if (!this.nv) return null;
    return {
      pos: this.pos.slice(0, this.nv * 3), uv: this.uv.slice(0, this.nv * 2), layer: this.layer.slice(0, this.nv),
      color: this.color.slice(0, this.nv * 4), index: this.index.slice(0, this.ni),
    };
  }
}

const P = 18;
const pidx = (x: number, y: number, z: number) => ((y + 1) * P + (z + 1)) * P + (x + 1);
const DV = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export interface ClipRange { min: number; max: number }

export function meshChunk(world: World, lib: ModelLibrary, cx: number, cy: number, cz: number, clip: ClipRange | null, aoOn: boolean): { solid: GeomData | null; trans: GeomData | null } {
  const ox = cx * 16, oy = cy * 16, oz = cz * 16;
  const pad = new Uint16Array(P * P * P);
  let any = false;
  for (let y = -1; y <= 16; y++) {
    const wy = oy + y;
    if (clip && (wy < clip.min || wy > clip.max)) continue;
    for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
      const id = world.get(ox + x, wy, oz + z);
      if (id) { pad[pidx(x, y, z)] = id; if (x >= 0 && x < 16 && y >= 0 && y < 16 && z >= 0 && z < 16) any = true; }
    }
  }
  if (!any) return { solid: null, trans: null };
  const opaque = lib.reg.opaqueTable();
  const solid = new Builder(), trans = new Builder();
  const aoBuf = [0, 0, 0, 0];
  const occ = (x: number, y: number, z: number) => opaque[pad[pidx(x, y, z)]];

  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const id = pad[pidx(x, y, z)];
    if (!id) continue;
    const model = lib.get(id);
    for (const q of model.quads) {
      if (q.cull >= 0) {
        const d = DV[q.cull];
        const nid = pad[pidx(x + d[0], y + d[1], z + d[2])];
        if (opaque[nid]) continue;
        if (model.cullGroup && nid && lib.get(nid).cullGroup === model.cullGroup) continue;
      }
      let ao: number[] | null = null;
      if (aoOn && q.ao) {
        const axis = q.dir >> 1, sgn = q.dir % 2 === 0 ? 1 : -1;
        const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
        const base = [x, y, z];
        if (q.flush) base[axis] += sgn;
        for (let i = 0; i < 4; i++) {
          const s1 = q.pos[i * 3 + t1] > 0.5 ? 1 : -1, s2 = q.pos[i * 3 + t2] > 0.5 ? 1 : -1;
          const a = [base[0], base[1], base[2]], b = [base[0], base[1], base[2]];
          a[t1] += s1; b[t2] += s2;
          const c = [a[0], a[1], a[2]]; c[t2] += s2;
          const side1 = occ(a[0], a[1], a[2]), side2 = occ(b[0], b[1], b[2]), corner = occ(c[0], c[1], c[2]);
          aoBuf[i] = side1 && side2 ? 0 : 3 - side1 - side2 - corner;
        }
        ao = aoBuf;
      }
      (q.trans ? trans : solid).quad(q.pos, x, y, z, q.uv, q.layer, q.rgb, ao);
    }
    if (model.fluid) fluid(lib, pad, opaque, model.fluid, x, y, z, solid, trans);
  }
  return { solid: solid.result(), trans: trans.result() };
}

function fluidHeight(lib: ModelLibrary, id: number): number {
  const info = lib.reg.info(id);
  const level = Number(info.props.level ?? 0);
  if (info.short !== 'water' && info.short !== 'lava') return 0.875;
  if (level === 0 || level >= 8) return 0.875;
  return Math.max(0.12, ((8 - level) / 9) * 1.0);
}

function fluid(lib: ModelLibrary, pad: Uint16Array, opaque: Uint8Array, kind: 1 | 2, x: number, y: number, z: number, solid: Builder, trans: Builder) {
  const id = pad[pidx(x, y, z)];
  const above = pad[pidx(x, y + 1, z)];
  const same = (n: number) => n !== 0 && lib.get(n).fluid === kind;
  const h = same(above) ? 1 : fluidHeight(lib, id);
  const tex = lib.fluidTexture(kind);
  const tint = tex.tint;
  const tr = tint >= 0 ? ((tint >> 16) & 255) / 255 : 1, tg = tint >= 0 ? ((tint >> 8) & 255) / 255 : 1, tb = tint >= 0 ? (tint & 255) / 255 : 1;
  const b = tex.trans ? trans : solid;
  const faces: [number, number[]][] = [
    [0, [1, 0, 1, 1, 0, 0, 1, h, 0, 1, h, 1]],
    [1, [0, 0, 0, 0, 0, 1, 0, h, 1, 0, h, 0]],
    [2, [0, h, 1, 1, h, 1, 1, h, 0, 0, h, 0]],
    [3, [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]],
    [4, [0, 0, 1, 1, 0, 1, 1, h, 1, 0, h, 1]],
    [5, [1, 0, 0, 0, 0, 0, 0, h, 0, 1, h, 0]],
  ];
  for (const [d, p] of faces) {
    const v = DV[d];
    const n = pad[pidx(x + v[0], y + v[1], z + v[2])];
    if (opaque[n] || same(n)) continue;
    const f = kind === 2 ? 1 : SHADE[d];
    const uv = d === 2 || d === 3 ? [0, 0, 1, 0, 1, 1, 0, 1] : [0, 0, 1, 0, 1, h, 0, h];
    b.quad(p, x, y, z, uv, tex.layer, [tr * f, tg * f, tb * f], null);
  }
}
