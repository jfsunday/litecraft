// Sky + block light propagation (Java-like) over the structure's bounding box plus a margin.
import type { BlockRegistry } from '../blocks/info';
import type { Bounds, World } from '../world/world';

export class LightGrid {
  constructor(
    readonly x0: number, readonly y0: number, readonly z0: number,
    readonly sx: number, readonly sy: number, readonly sz: number,
    readonly sky: Uint8Array, readonly block: Uint8Array,
  ) {}
  private idx(x: number, y: number, z: number): number {
    const lx = x - this.x0, ly = y - this.y0, lz = z - this.z0;
    if (lx < 0 || ly < 0 || lz < 0 || lx >= this.sx || ly >= this.sy || lz >= this.sz) return -1;
    return (ly * this.sz + lz) * this.sx + lx;
  }
  skyAt(x: number, y: number, z: number): number {
    const i = this.idx(x, y, z);
    if (i >= 0) return this.sky[i];
    return y < this.y0 ? 0 : 15;
  }
  blockAt(x: number, y: number, z: number): number {
    const i = this.idx(x, y, z);
    return i >= 0 ? this.block[i] : 0;
  }
  raw(x: number, y: number, z: number): number {
    return Math.max(this.skyAt(x, y, z), this.blockAt(x, y, z));
  }
}

const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];

export function computeLight(world: World, reg: BlockRegistry, b: Bounds, margin = 15): LightGrid {
  const x0 = b.min[0] - margin, z0 = b.min[2] - margin, y0 = b.min[1] - 1;
  const sx = b.max[0] - b.min[0] + 1 + margin * 2, sz = b.max[2] - b.min[2] + 1 + margin * 2, sy = b.max[1] - b.min[1] + 3;
  const n = sx * sy * sz;
  const opacity = new Uint8Array(n);   // 15 = opaque, else attenuation
  const faces = new Uint8Array(n);     // shape-occlusion face mask
  const sky = new Uint8Array(n), block = new Uint8Array(n);
  const blockSeeds: number[] = [];

  const idCache = new Map<number, [number, number, number]>();
  const props = (id: number) => {
    let p = idCache.get(id);
    if (!p) {
      const i = reg.info(id);
      p = [i.opaque || i.filter >= 15 ? 15 : i.filter, i.shapeOcclusion ? i.faceFull : 0, i.emit];
      idCache.set(id, p);
    }
    return p;
  };
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const id = world.get(x0 + x, y0 + y, z0 + z);
    if (!id) continue;
    const i = (y * sz + z) * sx + x;
    const [op, fm, em] = props(id);
    opacity[i] = op; faces[i] = fm;
    if (em > 0) { block[i] = em; blockSeeds.push(i); }
  }

  // Sky light falls straight down without loss through clear blocks.
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    let l = 15;
    for (let y = sy - 1; y >= 0; y--) {
      const i = (y * sz + z) * sx + x;
      if (opacity[i] >= 15 || faces[i] & (1 << 2)) l = 0;
      else l = Math.max(0, l - opacity[i]);
      sky[i] = l;
      if (faces[i] & (1 << 3)) l = 0;
    }
  }

  const spread = (light: Uint8Array, seeds: Iterable<number>) => {
    const buckets: number[][] = Array.from({ length: 16 }, () => []);
    for (const i of seeds) if (light[i] > 1) buckets[light[i]].push(i);
    for (let lv = 15; lv >= 2; lv--) {
      const bucket = buckets[lv];
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        if (light[i] !== lv) continue;
        const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
        for (let d = 0; d < 6; d++) {
          const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          const j = (ny * sz + nz) * sx + nx;
          if (opacity[j] >= 15) continue;
          if (faces[i] & (1 << d) || faces[j] & (1 << (d ^ 1))) continue;
          const nl = lv - Math.max(1, opacity[j]);
          if (nl > light[j]) { light[j] = nl; if (nl > 1) buckets[nl].push(j); }
        }
      }
      bucket.length = 0;
    }
  };
  const skySeeds: number[] = [];
  for (let i = 0; i < n; i++) if (sky[i] > 1) skySeeds.push(i);
  spread(sky, skySeeds);
  spread(block, blockSeeds);
  return new LightGrid(x0, y0, z0, sx, sy, sz, sky, block);
}
