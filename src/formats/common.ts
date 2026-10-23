import { type Compound, compounds, nbt, str, type Tag } from '../nbt/nbt';
import type { Props, World } from '../world/world';

export interface ImportResult {
  format: 'litematic' | 'schem' | 'nbt';
  name: string;
  author: string;
  description: string;
  dataVersion: number;
  regions: number;
  blocks: number;
  size: [number, number, number];
}

export interface ExportOptions {
  name: string;
  author: string;
  description: string;
  dataVersion: number;
}

/** Known DataVersions for the export target dropdown. */
export const MC_VERSIONS: { label: string; dataVersion: number }[] = [
  { label: '26.2', dataVersion: 4903 },
  { label: '26.1.x', dataVersion: 4786 },
  { label: '1.21.11', dataVersion: 4671 },
  { label: '1.21.10', dataVersion: 4556 },
  { label: '1.21.8', dataVersion: 4440 },
  { label: '1.21.5', dataVersion: 4325 },
  { label: '1.21.4', dataVersion: 4189 },
  { label: '1.21.1', dataVersion: 3955 },
  { label: '1.20.4', dataVersion: 3700 },
  { label: '1.19.4', dataVersion: 3337 },
];
export const DEFAULT_DATA_VERSION = 4786;

// Block renames between versions (old name valid below `dv`).
const RENAMES: { old: string; now: string; dv: number }[] = [
  { old: 'minecraft:grass', now: 'minecraft:short_grass', dv: 3698 },
  { old: 'minecraft:chain', now: 'minecraft:iron_chain', dv: 4554 },
];

export function upgradeName(name: string, dataVersion: number): string {
  if (!dataVersion) return name;
  for (const r of RENAMES) if (name === r.old && dataVersion < r.dv) return r.now;
  return name;
}
export function downgradeName(name: string, dataVersion: number): string {
  for (const r of RENAMES) if (name === r.now && dataVersion < r.dv) return r.old;
  return name;
}

/** Reads {Name, Properties} palette entries (litematic + vanilla structure). */
export function paletteEntryToState(world: World, tag: Compound, dataVersion: number): number {
  const name = upgradeName(normalize(str(tag, 'Name', 'minecraft:air')), dataVersion);
  const props: Props = {};
  const p = tag.v.get('Properties');
  if (p?.t === 10) for (const [k, v] of p.v) if (v.t === 8) props[k] = v.v;
  return world.state(name, props);
}

export function stateToPaletteEntry(world: World, id: number, dataVersion: number): Compound {
  const e = world.palette[id];
  const props = new Map<string, Tag>();
  for (const k of Object.keys(e.props).sort()) props.set(k, nbt.string(e.props[k]));
  return nbt.compound({
    Name: nbt.string(downgradeName(e.name, dataVersion)),
    Properties: props.size ? nbt.compound(props) : undefined,
  });
}

export function normalize(name: string): string {
  return name.includes(':') ? name : 'minecraft:' + name;
}

export function withoutKeys(c: Compound, keys: string[]): Compound {
  const m = new Map(c.v);
  for (const k of keys) m.delete(k);
  return { t: 10, v: m };
}

export function entityId(c: Compound): string {
  return str(c, 'id', str(c, 'Id', 'unknown'));
}

export { compounds };
