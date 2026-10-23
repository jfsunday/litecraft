// Random-tick plant growth simulation following the Java Edition rules (CropBlock, StemBlock, SugarCaneBlock, …).
import type { BlockRegistry } from '../blocks/info';
import { posKey, type World } from '../world/world';
import type { LightGrid } from './light';

export type PlantKind = 'crop' | 'cane' | 'cactus' | 'bamboo' | 'kelp' | 'stem' | 'wart' | 'cocoa' | 'berry';

export interface Plant {
  kind: PlantKind;
  block: string;
  x: number; y: number; z: number;
  valid: boolean;
  reason: string;
  chance: number;        // growth chance per random tick (when allowed)
  maxAge: number;
  maxHeight: number;
  spots: [number, number, number][];
  efficiency: number;    // 0..1 relative to the best possible layout for this plant type
  fruit?: string;
}

export const PLANT_LABEL: Record<string, string> = {
  wheat: 'Weizen', carrots: 'Karotten', potatoes: 'Kartoffeln', beetroots: 'Rote Bete', sugar_cane: 'Zuckerrohr', cactus: 'Kaktus',
  bamboo: 'Bambus', kelp: 'Seetang', pumpkin_stem: 'Kürbisstängel', melon_stem: 'Melonenstängel', nether_wart: 'Netherwarze',
  cocoa: 'Kakao', sweet_berry_bush: 'Süßbeerenstrauch',
};

export const YIELD: Record<string, Record<string, number>> = {
  wheat: { Weizen: 1, Weizenkörner: 1.71 },
  carrots: { Karotten: 3.71 },
  potatoes: { Kartoffeln: 3.71, 'Giftige Kartoffeln': 0.02 },
  beetroots: { 'Rote Bete': 1, 'Rote-Bete-Samen': 2.71 },
  sugar_cane: { Zuckerrohr: 1 },
  cactus: { Kaktus: 1 },
  bamboo: { Bambus: 1 },
  kelp: { Seetang: 1 },
  pumpkin_stem: { Kürbisse: 1 },
  melon_stem: { Melonenscheiben: 5 },
  nether_wart: { Netherwarzen: 3 },
  cocoa: { Kakaobohnen: 3 },
  sweet_berry_bush: { Süßbeeren: 2.5 },
};

const DIRT = /^(dirt|grass_block|podzol|coarse_dirt|mycelium|rooted_dirt|moss_block|pale_moss_block|mud|muddy_mangrove_roots|farmland)$/;
const CANE_SOIL = /^(dirt|grass_block|podzol|coarse_dirt|mycelium|rooted_dirt|moss_block|pale_moss_block|mud|muddy_mangrove_roots|sand|red_sand|suspicious_sand)$/;
const BAMBOO_SOIL = /^(dirt|grass_block|podzol|coarse_dirt|mycelium|rooted_dirt|moss_block|mud|sand|red_sand|gravel|suspicious_gravel|bamboo_sapling)$/;
const CROP_BASE: Record<string, number> = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };

function cropGrowthSpeed(world: World, reg: BlockRegistry, x: number, y: number, z: number, block: string, hydrated: (x: number, y: number, z: number) => boolean): number {
  let f = 1;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    let f1 = 0;
    if (reg.info(world.get(x + i, y - 1, z + j)).short === 'farmland') f1 = hydrated(x + i, y - 1, z + j) ? 3 : 1;
    if (i !== 0 || j !== 0) f1 /= 4;
    f += f1;
  }
  const same = (dx: number, dz: number) => reg.info(world.get(x + dx, y, z + dz)).short === block;
  const ew = same(-1, 0) || same(1, 0), ns = same(0, -1) || same(0, 1);
  if (ew && ns) f /= 2;
  else if (same(-1, -1) || same(1, -1) || same(1, 1) || same(-1, 1)) f /= 2;
  return f;
}

export function findPlants(world: World, reg: BlockRegistry, light: LightGrid): Plant[] {
  const out: Plant[] = [];
  const at = (x: number, y: number, z: number) => reg.info(world.get(x, y, z));
  const hydCache = new Map<number, boolean>();
  const hydrated = (x: number, y: number, z: number) => {
    const k = posKey(x, y, z);
    let v = hydCache.get(k);
    if (v === undefined) {
      v = false;
      for (let dy = 0; dy <= 1 && !v; dy++) for (let dx = -4; dx <= 4 && !v; dx++) for (let dz = -4; dz <= 4 && !v; dz++) if (at(x + dx, y + dy, z + dz).fluid === 1) v = true;
      hydCache.set(k, v);
    }
    return v;
  };
  const lit = (x: number, y: number, z: number) => light.raw(x, y, z) >= 9;
  const base = (kind: PlantKind, block: string, x: number, y: number, z: number): Plant => ({ kind, block, x, y, z, valid: true, reason: '', chance: 1, maxAge: 0, maxHeight: 1, spots: [], efficiency: 1 });
  const water = (x: number, y: number, z: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const i = at(x + dx, y, z + dz); return i.fluid === 1 || i.short === 'frosted_ice'; });

  world.forEach((x, y, z, id) => {
    const info = reg.info(id);
    const s = info.short;
    if (s in CROP_BASE || s === 'pumpkin_stem' || s === 'melon_stem' || s === 'attached_pumpkin_stem' || s === 'attached_melon_stem') {
      const stem = s.includes('stem');
      const block = s.replace('attached_', '');
      const p = base(stem ? 'stem' : 'crop', block, x, y, z);
      p.maxAge = stem ? 7 : CROP_BASE[s];
      if (at(x, y - 1, z).short !== 'farmland') { p.valid = false; p.reason = 'Kein Ackerboden darunter'; }
      else if (!lit(x, y, z)) { p.valid = false; p.reason = 'Zu dunkel (Licht < 9)'; }
      const f = cropGrowthSpeed(world, reg, x, y, z, block, hydrated);
      p.chance = (1 / (Math.floor(25 / f) + 1)) * (block === 'beetroots' ? 2 / 3 : 1);
      p.efficiency = p.valid ? p.chance / ((1 / 3) * (block === 'beetroots' ? 2 / 3 : 1)) : 0;
      if (p.valid && !hydrated(x, y - 1, z)) p.reason = 'Ackerboden trocken';
      else if (p.valid && p.efficiency < 0.99) p.reason = 'Reihen-Malus (gleiche Pflanze daneben)';
      if (stem) {
        p.fruit = block === 'pumpkin_stem' ? 'pumpkin' : 'melon';
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t = at(x + dx, y, z + dz);
          if ((t.air || t.short === p.fruit) && DIRT.test(at(x + dx, y - 1, z + dz).short)) p.spots.push([x + dx, y, z + dz]);
        }
        if (p.valid && !p.spots.length) { p.valid = false; p.reason = 'Kein freier Fruchtplatz (Erde/Gras daneben)'; }
        p.efficiency *= p.spots.length / 4;
      }
      out.push(p);
    } else if (s === 'sugar_cane' || s === 'cactus' || s === 'bamboo' || s === 'kelp' || s === 'kelp_plant') {
      const kind: PlantKind = s === 'sugar_cane' ? 'cane' : s === 'cactus' ? 'cactus' : s === 'bamboo' ? 'bamboo' : 'kelp';
      const below = at(x, y - 1, z);
      const sameKind = (i: { short: string }) => (kind === 'kelp' ? i.short === 'kelp' || i.short === 'kelp_plant' : i.short === s);
      if (sameKind(below)) return; // only the base of a column
      const p = base(kind, kind === 'kelp' ? 'kelp' : s, x, y, z);
      p.maxHeight = kind === 'bamboo' ? 16 : kind === 'kelp' ? 25 : 3;
      if (kind === 'cane') {
        if (!CANE_SOIL.test(below.short)) { p.valid = false; p.reason = 'Falscher Boden'; }
        else if (!water(x, y - 1, z)) { p.valid = false; p.reason = 'Kein Wasser neben dem Boden'; }
      } else if (kind === 'cactus') {
        if (!/^(sand|red_sand|suspicious_sand)$/.test(below.short)) { p.valid = false; p.reason = 'Kaktus braucht Sand'; }
      } else if (kind === 'bamboo') {
        if (!BAMBOO_SOIL.test(below.short)) { p.valid = false; p.reason = 'Falscher Boden'; }
        p.chance = 1 / 3;
      } else {
        p.chance = 0.14;
      }
      p.efficiency = p.valid ? 1 : 0;
      out.push(p);
    } else if (s === 'nether_wart' || s === 'cocoa' || s === 'sweet_berry_bush') {
      const p = base(s === 'nether_wart' ? 'wart' : s === 'cocoa' ? 'cocoa' : 'berry', s, x, y, z);
      p.maxAge = s === 'cocoa' ? 2 : 3;
      p.chance = s === 'nether_wart' ? 0.1 : 0.2;
      if (s === 'nether_wart' && at(x, y - 1, z).short !== 'soul_sand') { p.valid = false; p.reason = 'Braucht Seelensand'; }
      if (s === 'sweet_berry_bush' && !lit(x, y + 1, z)) { p.valid = false; p.reason = 'Zu dunkel'; }
      p.efficiency = p.valid ? 1 : 0;
      out.push(p);
    }
  });
  return out;
}

export interface PlantSimOptions {
  hours: number;
  randomTickSpeed: number;
  harvest: 'instant' | 'interval';
  intervalMin: number;
  runs: number;
}

export interface PlantSimResult {
  items: { name: string; perHour: number; std: number }[];
  counts: { block: string; total: number; valid: number }[];
  harvestsPerHour: number;
}

// --- event-driven core --------------------------------------------------------

export interface PState { age: number; height: number; fruit: number; next: number }

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

class Heap {
  t: number[] = []; i: number[] = [];
  push(time: number, idx: number) {
    let n = this.t.length; this.t.push(time); this.i.push(idx);
    while (n > 0) { const p = (n - 1) >> 1; if (this.t[p] <= this.t[n]) break; this.swap(n, p); n = p; }
  }
  pop(): number {
    const top = this.i[0];
    const lt = this.t.pop()!, li = this.i.pop()!;
    if (this.t.length) {
      this.t[0] = lt; this.i[0] = li;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1; let m = n;
        if (l < this.t.length && this.t[l] < this.t[m]) m = l;
        if (r < this.t.length && this.t[r] < this.t[m]) m = r;
        if (m === n) break;
        this.swap(n, m); n = m;
      }
    }
    return top;
  }
  peek() { return this.t[0]; }
  get size() { return this.t.length; }
  private swap(a: number, b: number) {
    [this.t[a], this.t[b]] = [this.t[b], this.t[a]];
    [this.i[a], this.i[b]] = [this.i[b], this.i[a]];
  }
}

export type HarvestFn = (plant: Plant, amount: number, t: number) => void;
export type VisualFn = (index: number, plant: Plant, st: PState) => void;

/** Steppable simulation state, used by both the fast batch run and the 3D timelapse. */
export class PlantEngine {
  readonly states: PState[];
  private heap = new Heap();
  private rand: () => number;
  private lambda: number;
  time = 0;
  private nextHarvest: number;
  constructor(readonly plants: Plant[], readonly opts: PlantSimOptions, seed: number, private onHarvest: HarvestFn, private onVisual?: VisualFn) {
    this.rand = rng(seed);
    this.lambda = opts.randomTickSpeed / 4096;
    this.nextHarvest = opts.harvest === 'interval' ? opts.intervalMin * 1200 : Infinity;
    this.states = plants.map((p, i) => {
      const st: PState = { age: 0, height: 1, fruit: -1, next: 0 };
      if (p.kind === 'crop' || p.kind === 'wart' || p.kind === 'cocoa') st.age = Math.floor(this.rand() * (p.maxAge + 1)) % (p.maxAge + 1);
      if (p.kind === 'stem') st.age = Math.floor(this.rand() * 8);
      if (p.kind === 'berry') st.age = 1 + Math.floor(this.rand() * 2);
      if (p.kind === 'cane' || p.kind === 'cactus') st.age = Math.floor(this.rand() * 16);
      if (p.valid && this.lambda > 0) this.heap.push(this.sample(), i);
      return st;
    });
  }

  private sample() { return this.time - Math.log(1 - this.rand()) / this.lambda; }

  private tick(i: number) {
    const p = this.plants[i], st = this.states[i];
    const instant = this.opts.harvest === 'instant';
    let changed = false;
    switch (p.kind) {
      case 'crop':
      case 'wart':
      case 'cocoa':
      case 'berry':
        if (st.age < p.maxAge && this.rand() < p.chance) {
          st.age++; changed = true;
          if (instant && st.age >= p.maxAge) {
            this.onHarvest(p, 1, this.time);
            st.age = p.kind === 'berry' ? 1 : 0;
          }
        }
        break;
      case 'stem':
        if (this.rand() < p.chance) {
          if (st.age < 7) { st.age++; changed = true; }
          else if (st.fruit < 0) {
            const d = Math.floor(this.rand() * 4);
            const spotIndex = p.spots.findIndex((s) => s[0] - p.x === [1, -1, 0, 0][d] && s[2] - p.z === [0, 0, 1, -1][d]);
            if (spotIndex >= 0) {
              if (instant) this.onHarvest(p, 1, this.time);
              else { st.fruit = spotIndex; changed = true; }
            }
          }
        }
        break;
      case 'cane':
      case 'cactus':
        if (st.height < p.maxHeight) {
          if (st.age >= 15) {
            st.age = 0;
            if (instant) this.onHarvest(p, 1, this.time);
            else { st.height++; changed = true; }
          } else st.age++;
        }
        break;
      case 'bamboo':
      case 'kelp':
        if (st.height < p.maxHeight && this.rand() < p.chance) {
          if (instant) this.onHarvest(p, 1, this.time);
          else { st.height++; changed = true; }
        }
        break;
    }
    if (changed) this.onVisual?.(i, p, st);
  }

  private harvestAll() {
    this.plants.forEach((p, i) => {
      if (!p.valid) return;
      const st = this.states[i];
      let amount = 0;
      if ((p.kind === 'crop' || p.kind === 'wart' || p.kind === 'cocoa') && st.age >= p.maxAge) { amount = 1; st.age = 0; }
      else if (p.kind === 'berry' && st.age >= 2) { amount = st.age === 3 ? 1 : 0.6; st.age = 1; }
      else if (p.kind === 'stem' && st.fruit >= 0) { amount = 1; st.fruit = -1; }
      else if ((p.kind === 'cane' || p.kind === 'cactus' || p.kind === 'bamboo' || p.kind === 'kelp') && st.height > 1) { amount = st.height - 1; st.height = 1; }
      if (amount) { this.onHarvest(p, amount, this.time); this.onVisual?.(i, p, st); }
    });
  }

  /** Advances the simulation to `until` (game ticks). */
  run(until: number) {
    while (this.heap.size && this.heap.peek() <= until) {
      const t = this.heap.peek();
      if (t > this.nextHarvest) { this.time = this.nextHarvest; this.harvestAll(); this.nextHarvest += this.opts.intervalMin * 1200; continue; }
      const i = this.heap.pop();
      this.time = t;
      this.tick(i);
      this.heap.push(this.sample(), i);
    }
    while (this.nextHarvest <= until) { this.time = this.nextHarvest; this.harvestAll(); this.nextHarvest += this.opts.intervalMin * 1200; }
    this.time = until;
  }
}

export function simulatePlants(plants: Plant[], opts: PlantSimOptions): PlantSimResult {
  const ticks = opts.hours * 72000;
  const perRun: Map<string, number>[] = [];
  let harvests = 0;
  for (let r = 0; r < opts.runs; r++) {
    const totals = new Map<string, number>();
    const engine = new PlantEngine(plants, opts, 1234 + r * 7919, (p, amount) => {
      harvests += amount;
      for (const [item, n] of Object.entries(YIELD[p.block] ?? {})) totals.set(item, (totals.get(item) ?? 0) + n * amount);
    });
    engine.run(ticks);
    perRun.push(totals);
  }
  const names = new Set<string>();
  for (const t of perRun) for (const k of t.keys()) names.add(k);
  const items = [...names].map((name) => {
    const vals = perRun.map((t) => (t.get(name) ?? 0) / opts.hours);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1));
    return { name, perHour: mean, std };
  }).sort((a, b) => b.perHour - a.perHour);
  const counts = new Map<string, { block: string; total: number; valid: number }>();
  for (const p of plants) {
    const c = counts.get(p.block) ?? { block: p.block, total: 0, valid: 0 };
    c.total++; if (p.valid) c.valid++;
    counts.set(p.block, c);
  }
  return { items, counts: [...counts.values()].sort((a, b) => b.total - a.total), harvestsPerHour: harvests / opts.runs / opts.hours };
}
