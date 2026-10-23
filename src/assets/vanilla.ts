// Official Minecraft assets, read locally from the user's own client .jar and/or resource packs (never uploaded).
import { idbDel, idbGet, idbSet } from '../util/idb';
import type { Props } from '../world/world';
import type { ElementSpec, FaceName, PartSpec } from '../render/model';
import { listZip, readEntry } from './zip';

export interface PackTexture { r: number; d: Uint8ClampedArray }

export interface PackData {
  label: string;
  kind: 'jar' | 'pack';
  blockstates: Record<string, unknown>;
  models: Record<string, unknown>;
  textures: Record<string, PackTexture>;
  colormaps: { grass?: number; foliage?: number; dryFoliage?: number };
}

export interface PackStack { base: PackData | null; overlays: PackData[] }

const CACHE_KEY = 'pack-stack-v2';
const PREFIX = 'assets/minecraft/';
const MAX_RES = 64;

async function bitmap(bytes: Uint8Array) {
  return createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
}

async function decodeTexture(bytes: Uint8Array): Promise<PackTexture | null> {
  try {
    const bmp = await bitmap(bytes);
    const frame = Math.min(bmp.width, bmp.height);
    let r = 16;
    while (r < frame && r < MAX_RES) r *= 2;
    const c = new OffscreenCanvas(r, r);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    g.drawImage(bmp, 0, 0, frame, frame, 0, 0, r, r);
    bmp.close();
    return { r, d: g.getImageData(0, 0, r, r).data };
  } catch {
    return null;
  }
}

async function sampleColormap(bytes: Uint8Array): Promise<number | undefined> {
  try {
    const bmp = await bitmap(bytes);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    // Plains biome: temperature 0.8, downfall 0.4
    const x = Math.floor((1 - 0.8) * (bmp.width - 1)), y = Math.floor((1 - 0.4 * 0.8) * (bmp.height - 1));
    const d = g.getImageData(x, y, 1, 1).data;
    return (d[0] << 16) | (d[1] << 8) | d[2];
  } catch {
    return undefined;
  }
}

export async function readPackFile(file: File, onProgress?: (p: number) => void): Promise<PackData> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = listZip(buf).filter((e) => e.name.startsWith(PREFIX) && e.size > 0);
  const wanted = entries.filter((e) => {
    const n = e.name.slice(PREFIX.length);
    return (n.startsWith('blockstates/') && n.endsWith('.json'))
      || (n.startsWith('models/block/') && n.endsWith('.json'))
      || (n.startsWith('textures/block/') && n.endsWith('.png'))
      || (n.startsWith('textures/colormap/') && n.endsWith('.png'));
  });
  if (!wanted.length) throw new Error('Keine Minecraft-Block-Assets gefunden. Wähle eine Client-.jar oder ein Resourcepack (.zip).');
  const isJar = /\.jar$/i.test(file.name) || wanted.filter((e) => e.name.includes('/blockstates/')).length > 500;
  const pack: PackData = { label: file.name.replace(/\.(jar|zip)$/i, ''), kind: isJar ? 'jar' : 'pack', blockstates: {}, models: {}, textures: {}, colormaps: {} };
  const dec = new TextDecoder();
  let done = 0;
  const BATCH = 48;
  for (let i = 0; i < wanted.length; i += BATCH) {
    await Promise.all(wanted.slice(i, i + BATCH).map(async (e) => {
      const n = e.name.slice(PREFIX.length);
      try {
        const data = await readEntry(buf, e);
        if (n.startsWith('blockstates/')) pack.blockstates[n.slice(12, -5)] = JSON.parse(dec.decode(data));
        else if (n.startsWith('models/')) pack.models[n.slice(7, -5)] = JSON.parse(dec.decode(data));
        else if (n.startsWith('textures/block/')) {
          const t = await decodeTexture(data);
          if (t) pack.textures[n.slice(9, -4)] = t;
        } else if (n.endsWith('/grass.png')) pack.colormaps.grass = await sampleColormap(data);
        else if (n.endsWith('/dry_foliage.png')) pack.colormaps.dryFoliage = await sampleColormap(data);
        else if (n.endsWith('/foliage.png')) pack.colormaps.foliage = await sampleColormap(data);
      } catch { /* skip broken entries */ }
      done++;
    }));
    onProgress?.(done / wanted.length);
  }
  return pack;
}

export function addToStack(stack: PackStack, p: PackData): PackStack {
  return p.kind === 'jar' ? { base: p, overlays: stack.overlays } : { base: stack.base, overlays: [...stack.overlays, p] };
}

export function stackLabel(stack: PackStack): string {
  return [stack.base?.label, ...stack.overlays.map((o) => o.label)].filter(Boolean).join(' + ');
}

export const loadCachedStack = () => idbGet<PackStack>(CACHE_KEY);
export const saveStack = (s: PackStack) => idbSet(CACHE_KEY, s);
export const clearCachedStack = () => idbDel(CACHE_KEY);

// ---------------------------------------------------------------------------

interface RawModel {
  parent?: string;
  textures?: Record<string, string | { sprite?: string }>;
  elements?: ElementSpec[];
  ambientocclusion?: boolean;
}
interface Resolved { elements: ElementSpec[]; ao: boolean }
interface VariantRef { model: string; x?: number; y?: number; uvlock?: boolean }

const strip = (s: string) => s.replace(/^minecraft:/, '');

function matches(cond: Record<string, unknown>, props: Props): boolean {
  if (Array.isArray(cond.OR)) return (cond.OR as Record<string, unknown>[]).some((c) => matches(c, props));
  if (Array.isArray(cond.AND)) return (cond.AND as Record<string, unknown>[]).every((c) => matches(c, props));
  for (const [k, v] of Object.entries(cond)) {
    const allowed = String(v).split('|');
    if (!allowed.includes(props[k] ?? '')) return false;
  }
  return true;
}

/** Looks up assets through the pack stack (last resource pack wins, then the jar). */
export class VanillaResolver {
  private models = new Map<string, Resolved | null>();
  private layers: PackData[];
  readonly resolution: number;
  readonly colormaps: PackData['colormaps'];
  readonly hasModels: boolean;

  constructor(readonly stack: PackStack) {
    this.layers = [...stack.overlays].reverse();
    if (stack.base) this.layers.push(stack.base);
    let r = 16;
    for (const l of this.layers) for (const t of Object.values(l.textures)) if (t.r > r) r = t.r;
    this.resolution = Math.min(MAX_RES, r);
    this.colormaps = Object.assign({}, ...[...this.layers].reverse().map((l) => l.colormaps));
    this.hasModels = this.layers.some((l) => Object.keys(l.blockstates).length > 0);
  }

  texture(key: string): PackTexture | undefined {
    for (const l of this.layers) { const t = l.textures[key]; if (t) return t; }
    return undefined;
  }
  private model(key: string): RawModel | undefined {
    for (const l of this.layers) { const m = l.models[key]; if (m) return m as RawModel; }
    return undefined;
  }
  private blockstate(key: string): unknown {
    for (const l of this.layers) { const b = l.blockstates[key]; if (b) return b; }
    return undefined;
  }

  private resolveModel(name: string): Resolved | null {
    const key = strip(name);
    if (this.models.has(key)) return this.models.get(key)!;
    const chain: RawModel[] = [];
    let cur: string | undefined = key;
    for (let i = 0; cur && i < 32; i++) {
      const m = this.model(cur);
      if (!m) break;
      chain.push(m);
      cur = m.parent ? strip(m.parent) : undefined;
    }
    const textures: Record<string, string> = {};
    for (let i = chain.length - 1; i >= 0; i--) {
      // 26.x allows { sprite, force_translucent } objects besides plain strings
      for (const [k, v] of Object.entries(chain[i].textures ?? {})) textures[k] = typeof v === 'string' ? v : v?.sprite ?? 'missing';
    }
    const withElements = chain.find((m) => Array.isArray(m.elements) && m.elements.length);
    const aoModel = chain.find((m) => m.ambientocclusion !== undefined);
    let res: Resolved | null = null;
    if (withElements?.elements) {
      const resolveTex = (t: string): string => {
        let v = t;
        for (let i = 0; i < 16 && v.startsWith('#'); i++) v = textures[v.slice(1)] ?? 'missing';
        return v.startsWith('#') || v === 'missing' ? 'missing' : 'minecraft:' + strip(v);
      };
      const elements = withElements.elements.map((e): ElementSpec => {
        const faces: ElementSpec['faces'] = {};
        for (const [fname, f] of Object.entries(e.faces ?? {})) {
          if (f) faces[fname as FaceName] = { ...f, texture: resolveTex(f.texture) };
        }
        return { ...e, faces };
      });
      res = { elements, ao: aoModel?.ambientocclusion !== false };
    }
    this.models.set(key, res);
    return res;
  }

  /** Model parts for a block state, or null when the block has no element model (entity-rendered etc.). */
  parts(short: string, props: Props): PartSpec[] | null {
    const bs = this.blockstate(short) as { variants?: Record<string, VariantRef | VariantRef[]>; multipart?: { when?: Record<string, unknown>; apply: VariantRef | VariantRef[] }[] } | undefined;
    if (!bs) return null;
    const refs: VariantRef[] = [];
    if (bs.variants) {
      for (const [key, v] of Object.entries(bs.variants)) {
        const ok = key === '' || key.split(',').every((kv) => {
          const [k, val] = kv.split('=');
          return props[k] === val;
        });
        if (ok) { refs.push(Array.isArray(v) ? v[0] : v); break; }
      }
    } else if (bs.multipart) {
      for (const c of bs.multipart) if (!c.when || matches(c.when, props)) refs.push(Array.isArray(c.apply) ? c.apply[0] : c.apply);
    }
    const parts: PartSpec[] = [];
    for (const r of refs) {
      const m = r?.model ? this.resolveModel(r.model) : null;
      if (m) parts.push({ elements: m.elements, x: r.x, y: r.y, uvlock: r.uvlock, ao: m.ao });
    }
    return parts.length ? parts : null;
  }
}
