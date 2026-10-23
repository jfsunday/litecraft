import type { Compound } from '../nbt/nbt';

export type Props = Record<string, string>;

export interface StateEntry {
  key: string;     // canonical "minecraft:name[a=1,b=2]"
  name: string;    // "minecraft:name"
  short: string;   // "name"
  props: Props;
}

export interface EntityRec {
  id: string;
  x: number; y: number; z: number;
  nbt: Compound;
}

export interface WorldMeta {
  name: string;
  author: string;
  description: string;
  source: string;          // 'new' | 'litematic' | 'schem' | 'nbt' | 'demo'
  dataVersion: number;     // DataVersion of imported file (0 = unknown / native)
  created: number;
}

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

export const AIR_KEY = 'minecraft:air';

export function normName(name: string): string {
  return name.includes(':') ? name : 'minecraft:' + name;
}

export function makeKey(name: string, props: Props): string {
  const keys = Object.keys(props).sort();
  const n = normName(name);
  if (!keys.length) return n;
  return `${n}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]`;
}

export function parseKey(key: string): { name: string; props: Props } {
  const i = key.indexOf('[');
  if (i < 0) return { name: normName(key.trim()), props: {} };
  const props: Props = {};
  const body = key.slice(i + 1, key.lastIndexOf(']'));
  for (const part of body.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return { name: normName(key.slice(0, i).trim()), props };
}

const AIR_NAMES = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

export const chunkKey = (cx: number, cy: number, cz: number) => ((cx + 2048) * 4096 + (cy + 2048)) * 4096 + (cz + 2048);
export function chunkCoords(key: number): [number, number, number] {
  const cz = (key % 4096) - 2048;
  const r = Math.floor(key / 4096);
  return [Math.floor(r / 4096) - 2048, (r % 4096) - 2048, cz];
}
export const posKey = (x: number, y: number, z: number) => ((x + 65536) * 131072 + (y + 65536)) * 131072 + (z + 65536);
export function posFromKey(k: number): [number, number, number] {
  const z = (k % 131072) - 65536;
  const r = Math.floor(k / 131072);
  return [Math.floor(r / 131072) - 65536, (r % 131072) - 65536, z];
}
const idx = (x: number, y: number, z: number) => ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);

export class World {
  palette: StateEntry[] = [];
  private keyToId = new Map<string, number>();
  chunks = new Map<number, Uint16Array>();
  private counts = new Map<number, number>();
  blockEntities = new Map<number, Compound>();
  entities: EntityRec[] = [];
  meta: WorldMeta = World.defaultMeta();
  dirty = new Set<number>();
  version = 0;
  private boundsCache: { v: number; b: Bounds | null } = { v: -1, b: null };
  private listeners = new Set<() => void>();
  private batchDepth = 0;
  private pendingNotify = false;

  constructor() {
    this.palette.push({ key: AIR_KEY, name: AIR_KEY, short: 'air', props: {} });
    this.keyToId.set(AIR_KEY, 0);
  }

  static defaultMeta(): WorldMeta {
    return { name: 'Unbenannt', author: '', description: '', source: 'new', dataVersion: 0, created: Date.now() };
  }

  stateFromKey(key: string): number {
    const hit = this.keyToId.get(key);
    if (hit !== undefined) return hit;
    const { name, props } = parseKey(key);
    return this.state(name, props);
  }

  state(name: string, props: Props = {}): number {
    const n = normName(name);
    if (AIR_NAMES.has(n)) return 0;
    const key = makeKey(n, props);
    const hit = this.keyToId.get(key);
    if (hit !== undefined) return hit;
    if (this.palette.length >= 65535) throw new Error('Zu viele verschiedene Block-States (max. 65535)');
    const id = this.palette.length;
    this.palette.push({ key, name: n, short: n.slice(n.indexOf(':') + 1), props: { ...props } });
    this.keyToId.set(key, id);
    return id;
  }

  /** Same block with some properties replaced. */
  withProps(id: number, patch: Props): number {
    const e = this.palette[id];
    return this.state(e.name, { ...e.props, ...patch });
  }

  get(x: number, y: number, z: number): number {
    const c = this.chunks.get(chunkKey(x >> 4, y >> 4, z >> 4));
    return c ? c[idx(x, y, z)] : 0;
  }

  /** Sets a block without change tracking (bulk import). Call finishBulk() afterwards. */
  setRaw(x: number, y: number, z: number, id: number): void {
    const k = chunkKey(x >> 4, y >> 4, z >> 4);
    let c = this.chunks.get(k);
    if (!c) {
      if (id === 0) return;
      c = new Uint16Array(4096);
      this.chunks.set(k, c);
      this.counts.set(k, 0);
    }
    const i = idx(x, y, z);
    const prev = c[i];
    if (prev === id) return;
    c[i] = id;
    if (prev === 0) this.counts.set(k, this.counts.get(k)! + 1);
    else if (id === 0) this.counts.set(k, this.counts.get(k)! - 1);
  }

  finishBulk(): void {
    for (const [k, n] of this.counts) if (n === 0) { this.chunks.delete(k); this.counts.delete(k); }
    for (const k of this.chunks.keys()) this.dirty.add(k);
    this.version++;
    this.notify();
  }

  set(x: number, y: number, z: number, id: number): number {
    const prev = this.get(x, y, z);
    if (prev === id) return prev;
    this.setRaw(x, y, z, id);
    const k = chunkKey(x >> 4, y >> 4, z >> 4);
    if (this.counts.get(k) === 0) { this.chunks.delete(k); this.counts.delete(k); }
    this.markDirty(x, y, z);
    if (id === 0 || this.palette[id].name !== this.palette[prev]?.name) this.blockEntities.delete(posKey(x, y, z));
    this.version++;
    this.notify();
    return prev;
  }

  private markDirty(x: number, y: number, z: number) {
    const cx = x >> 4, cy = y >> 4, cz = z >> 4;
    const lx = x & 15, ly = y & 15, lz = z & 15;
    // Neighbour chunks are affected through face culling and ambient occlusion (incl. diagonals).
    for (let dx = lx === 0 ? -1 : 0; dx <= (lx === 15 ? 1 : 0); dx++)
      for (let dy = ly === 0 ? -1 : 0; dy <= (ly === 15 ? 1 : 0); dy++)
        for (let dz = lz === 0 ? -1 : 0; dz <= (lz === 15 ? 1 : 0); dz++)
          this.dirty.add(chunkKey(cx + dx, cy + dy, cz + dz));
  }

  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try { return fn(); } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.pendingNotify) { this.pendingNotify = false; this.emit(); }
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    if (this.batchDepth > 0) { this.pendingNotify = true; return; }
    this.emit();
  }
  private emit() { for (const l of this.listeners) l(); }

  clear(): void {
    for (const k of this.chunks.keys()) this.dirty.add(k);
    this.chunks.clear();
    this.counts.clear();
    this.blockEntities.clear();
    this.entities = [];
    this.meta = World.defaultMeta();
    this.version++;
    this.notify();
  }

  blockCount(): number {
    let n = 0;
    for (const c of this.counts.values()) n += c;
    return n;
  }

  bounds(): Bounds | null {
    if (this.boundsCache.v === this.version) return this.boundsCache.b;
    let b: Bounds | null = null;
    for (const [k, c] of this.chunks) {
      const [cx, cy, cz] = chunkCoords(k);
      const ox = cx * 16, oy = cy * 16, oz = cz * 16;
      // Skip chunks that cannot extend the current bounds.
      if (b && ox >= b.min[0] && ox + 15 <= b.max[0] && oy >= b.min[1] && oy + 15 <= b.max[1] && oz >= b.min[2] && oz + 15 <= b.max[2]) continue;
      for (let i = 0; i < 4096; i++) {
        if (!c[i]) continue;
        const x = ox + (i & 15), y = oy + (i >> 8), z = oz + ((i >> 4) & 15);
        if (!b) b = { min: [x, y, z], max: [x, y, z] };
        else {
          if (x < b.min[0]) b.min[0] = x; else if (x > b.max[0]) b.max[0] = x;
          if (y < b.min[1]) b.min[1] = y; else if (y > b.max[1]) b.max[1] = y;
          if (z < b.min[2]) b.min[2] = z; else if (z > b.max[2]) b.max[2] = z;
        }
      }
    }
    this.boundsCache = { v: this.version, b };
    return b;
  }

  /** Iterates all non-air blocks. */
  forEach(fn: (x: number, y: number, z: number, id: number) => void): void {
    for (const [k, c] of this.chunks) {
      const [cx, cy, cz] = chunkCoords(k);
      const ox = cx * 16, oy = cy * 16, oz = cz * 16;
      for (let i = 0; i < 4096; i++) {
        const id = c[i];
        if (id) fn(ox + (i & 15), oy + (i >> 8), oz + ((i >> 4) & 15), id);
      }
    }
  }
}
