// Hostile mob spawning (Java NaturalSpawner) around an AFK spot, assuming a perfect world:
// the farm stands above an ocean, no other spawnable spaces, plains spawn list.
import type { Box16 } from '../blocks/data';
import type { BlockRegistry } from '../blocks/info';
import type { Bounds, World } from '../world/world';
import type { LightGrid } from './light';

export interface MobType { id: string; label: string; weight: number; min: number; max: number; w: number; h: number; drops: Record<string, number>; never?: boolean }

export const MOBS: MobType[] = [
  { id: 'spider', label: 'Spinne', weight: 100, min: 4, max: 4, w: 1.4, h: 0.9, drops: { Faden: 1, Spinnenaugen: 1 / 3 } },
  { id: 'zombie', label: 'Zombie', weight: 95, min: 4, max: 4, w: 0.6, h: 1.95, drops: { 'Verrottetes Fleisch': 1 } },
  { id: 'zombie_villager', label: 'Zombiedorfbewohner', weight: 5, min: 1, max: 1, w: 0.6, h: 1.95, drops: { 'Verrottetes Fleisch': 1 } },
  { id: 'skeleton', label: 'Skelett', weight: 100, min: 4, max: 4, w: 0.6, h: 1.99, drops: { Knochen: 1, Pfeile: 1 } },
  { id: 'creeper', label: 'Creeper', weight: 100, min: 4, max: 4, w: 0.6, h: 1.7, drops: { Schwarzpulver: 1 } },
  { id: 'slime', label: 'Schleim', weight: 100, min: 4, max: 4, w: 2.04, h: 2.04, drops: {}, never: true },
  { id: 'enderman', label: 'Enderman', weight: 10, min: 1, max: 4, w: 0.6, h: 2.9, drops: { Enderperlen: 0.5 } },
  { id: 'witch', label: 'Hexe', weight: 5, min: 1, max: 1, w: 0.6, h: 1.95, drops: { 'Hexen-Loot': 2 } },
];
const TOTAL_WEIGHT = MOBS.reduce((a, m) => a + m.weight, 0);

export interface MobSimOptions {
  afk: [number, number, number];
  baseY: number;           // absolute Y of the structure's lowest block
  deathSeconds: number;    // average time from spawn until the mob is killed
  hours: number;
  night: boolean;          // true = permanent night, false = day/night cycle
}

export interface MobSimResult {
  spawnsPerHour: number;
  byMob: { id: string; label: string; perHour: number }[];
  drops: { name: string; perHour: number }[];
  xpPerHour: number;
  avgAlive: number;
  capFullPct: number;
  despawnedPct: number;
  heat: Map<number, number>;
}

export interface SpawnSpot { x: number; y: number; z: number; dist: number; sky: number }

function collides(world: World, reg: BlockRegistry, box: number[]): boolean {
  for (let x = Math.floor(box[0]); x <= Math.floor(box[3] - 1e-7); x++)
    for (let y = Math.floor(box[1]); y <= Math.floor(box[4] - 1e-7); y++)
      for (let z = Math.floor(box[2]); z <= Math.floor(box[5] - 1e-7); z++) {
        const shape: Box16[] = reg.info(world.get(x, y, z)).shape;
        for (const b of shape) {
          if (box[0] < x + b[3] / 16 && box[3] > x + b[0] / 16 && box[1] < y + b[4] / 16 && box[4] > y + b[1] / 16 && box[2] < z + b[5] / 16 && box[5] > z + b[2] / 16) return true;
        }
      }
  return false;
}

/** Static spawn data per cell (bit per mob type), ignoring the random light checks.
 *  Covers the bounding box plus two layers above it, so roofs count as spawnable surfaces too. */
export class SpawnMap {
  readonly sx: number; readonly sy: number; readonly sz: number;
  readonly flags: Uint16Array;
  readonly sky: Uint8Array;
  readonly top: Int32Array;    // highest block per column (editor y), or -2^31 when empty
  constructor(readonly world: World, readonly reg: BlockRegistry, readonly b: Bounds, light: LightGrid) {
    this.sx = b.max[0] - b.min[0] + 1; this.sy = b.max[1] - b.min[1] + 3; this.sz = b.max[2] - b.min[2] + 1;
    this.flags = new Uint16Array(this.sx * this.sy * this.sz);
    this.sky = new Uint8Array(this.flags.length);
    this.top = new Int32Array(this.sx * this.sz).fill(-2147483648);
    const info = (x: number, y: number, z: number) => reg.info(world.get(x, y, z));
    for (let lx = 0; lx < this.sx; lx++) for (let lz = 0; lz < this.sz; lz++) {
      const x = b.min[0] + lx, z = b.min[2] + lz;
      for (let y = b.max[1]; y >= b.min[1]; y--) if (world.get(x, y, z)) { this.top[lz * this.sx + lx] = y; break; }
      for (let ly = 1; ly < this.sy; ly++) {
        const y = b.min[1] + ly;
        if (!info(x, y - 1, z).spawnSurface) continue;
        if (info(x, y, z).spawnBlocked || info(x, y + 1, z).spawnBlocked) continue;
        if (light.blockAt(x, y, z) > 0) continue;
        let f = 0;
        MOBS.forEach((m, mi) => {
          if (m.never) return;
          const hw = m.w / 2;
          if (!collides(world, reg, [x + 0.5 - hw, y, z + 0.5 - hw, x + 0.5 + hw, y + m.h, z + 0.5 + hw])) f |= 1 << mi;
        });
        const i = this.index(x, y, z);
        this.flags[i] = f;
        this.sky[i] = light.skyAt(x, y, z);
      }
    }
  }
  index(x: number, y: number, z: number): number {
    const lx = x - this.b.min[0], ly = y - this.b.min[1], lz = z - this.b.min[2];
    if (lx < 0 || ly < 0 || lz < 0 || lx >= this.sx || ly >= this.sy || lz >= this.sz) return -1;
    return (ly * this.sz + lz) * this.sx + lx;
  }
  coords(i: number): [number, number, number] {
    const lx = i % this.sx, lz = Math.floor(i / this.sx) % this.sz, ly = Math.floor(i / (this.sx * this.sz));
    return [this.b.min[0] + lx, this.b.min[1] + ly, this.b.min[2] + lz];
  }
  /** Spots where a zombie could spawn (for the overlay). */
  spots(afk: [number, number, number] | null): SpawnSpot[] {
    const out: SpawnSpot[] = [];
    const zombie = 1 << 1;
    for (let i = 0; i < this.flags.length; i++) {
      if (!(this.flags[i] & zombie)) continue;
      const [x, y, z] = this.coords(i);
      const dist = afk ? Math.hypot(x + 0.5 - (afk[0] + 0.5), y - afk[1], z + 0.5 - (afk[2] + 0.5)) : -1;
      out.push({ x, y, z, dist, sky: this.sky[i] });
    }
    return out;
  }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function skyDarken(t: number): number {
  const d = t % 24000;
  if (d < 12000) return 0;
  if (d < 13000) return ((d - 12000) / 1000) * 11;
  if (d < 23000) return 11;
  return (1 - (d - 23000) / 1000) * 11;
}

export async function simulateMobs(map: SpawnMap, opts: MobSimOptions, onProgress?: (p: number) => void): Promise<MobSimResult> {
  const { b, world } = map;
  const rand = rng(987654321);
  const ri = (n: number) => Math.floor(rand() * n);
  const yOffset = opts.baseY - b.min[1];
  const [ax, ay, az] = opts.afk;
  const px = ax + 0.5, py = ay, pz = az + 0.5;
  const SEA_TOP = 62, MIN_Y = -64;
  const heightAbs = (x: number, z: number) => {
    const lx = x - b.min[0], lz = z - b.min[2];
    if (lx >= 0 && lz >= 0 && lx < map.sx && lz < map.sz) {
      const t = map.top[lz * map.sx + lx];
      if (t > -2147483648) return Math.max(SEA_TOP, t + yOffset);
    }
    return SEA_TOP;
  };
  // Outside the farm there is only ocean water and air, neither is a redstone conductor.
  const conductor = (x: number, y: number, z: number) => map.index(x, y, z) >= 0 && map.reg.info(world.get(x, y, z)).opaque;
  // Chunks close enough to the player and to the farm for packs to reach it.
  const chunks: [number, number][] = [];
  const reach = 22;
  for (let cx = Math.floor((b.min[0] - reach) / 16); cx <= Math.floor((b.max[0] + reach) / 16); cx++)
    for (let cz = Math.floor((b.min[2] - reach) / 16); cz <= Math.floor((b.max[2] + reach) / 16); cz++) {
      if ((cx * 16 + 8 - px) ** 2 + (cz * 16 + 8 - pz) ** 2 < 128 * 128) chunks.push([cx, cz]);
    }

  const ticks = Math.round(opts.hours * 72000);
  const lifeMean = Math.max(1, opts.deathSeconds * 20);
  const ringSize = Math.ceil(lifeMean * 2) + 2;
  const ring = new Int32Array(ringSize);
  let alive = 0, aliveSum = 0, capFull = 0, despawned = 0, total = 0;
  const byMob = new Array(MOBS.length).fill(0);
  const heat = new Map<number, number>();
  const CAP = 70;

  const pick = () => {
    let r = ri(TOTAL_WEIGHT);
    for (const m of MOBS) { if (r < m.weight) return m; r -= m.weight; }
    return MOBS[0];
  };

  const attempt = (cx: number, cz: number, t: number) => {
    const x = cx * 16 + ri(16), z = cz * 16 + ri(16);
    const top = heightAbs(x, z) + 1;
    const yAbs = MIN_Y + ri(top - MIN_Y + 1);
    if (yAbs < MIN_Y + 1) return;
    const y = yAbs - yOffset;
    if (conductor(x, y, z)) return;
    let spawned = 0;
    const darken = opts.night ? 11 : skyDarken(t);
    for (let g = 0; g < 3; g++) {
      let gx = x, gz = z;
      let mob: MobType | null = null;
      let n = Math.ceil(rand() * 4);
      for (let k = 0; k < n; k++) {
        gx += ri(6) - ri(6);
        gz += ri(6) - ri(6);
        const d2 = (gx + 0.5 - px) ** 2 + (y - py) ** 2 + (gz + 0.5 - pz) ** 2;
        if (d2 <= 576) continue;
        if (!mob) { mob = pick(); n = mob.min + ri(1 + mob.max - mob.min); }
        if (d2 > 16384) continue;
        const ci = map.index(gx, y, gz);
        if (ci < 0) continue;
        const mi = MOBS.indexOf(mob);
        if (!(map.flags[ci] & (1 << mi))) continue;
        const sky = map.sky[ci];
        if (sky > ri(32)) continue;
        if (Math.max(0, sky - darken) > ri(8)) continue;
        // spawn
        total++; byMob[mi]++; alive++; spawned++;
        const key = ci;
        heat.set(key, (heat.get(key) ?? 0) + 1);
        let life = Math.max(1, Math.round(lifeMean * (0.5 + rand())));
        if (life > 600 && d2 > 1024) {
          const survive = 600 + Math.floor(Math.log(1 - rand()) / Math.log(1 - 1 / 800));
          if (survive < life) { life = survive; despawned++; byMob[mi]--; total--; }
        }
        ring[(t + Math.min(life, ringSize - 1)) % ringSize]++;
        if (spawned >= 4) return;
      }
    }
  };

  const slice = 3000;
  for (let t = 0; t < ticks; t++) {
    const slot = t % ringSize;
    alive -= ring[slot];
    ring[slot] = 0;
    if (alive >= CAP) capFull++;
    else for (const [cx, cz] of chunks) { if (alive >= CAP) break; attempt(cx, cz, t); }
    aliveSum += alive;
    if (t % slice === slice - 1) { onProgress?.(t / ticks); await new Promise((r) => setTimeout(r, 0)); }
  }

  const hours = opts.hours;
  const drops = new Map<string, number>();
  MOBS.forEach((m, i) => { for (const [k, v] of Object.entries(m.drops)) drops.set(k, (drops.get(k) ?? 0) + (v * byMob[i]) / hours); });
  return {
    spawnsPerHour: total / hours,
    byMob: MOBS.map((m, i) => ({ id: m.id, label: m.label, perHour: byMob[i] / hours })).filter((m) => m.perHour > 0).sort((a, b) => b.perHour - a.perHour),
    drops: [...drops].map(([name, perHour]) => ({ name, perHour })).filter((d) => d.perHour > 0).sort((a, b) => b.perHour - a.perHour),
    xpPerHour: (total * 5) / hours,
    avgAlive: aliveSum / ticks,
    capFullPct: (capFull / ticks) * 100,
    despawnedPct: total + despawned ? (despawned / (total + despawned)) * 100 : 0,
    heat,
  };
}
