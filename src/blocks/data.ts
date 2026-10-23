import raw from '../data/blocks.json';
import type { Props } from '../world/world';

/** Box in 1/16 block units: [x1, y1, z1, x2, y2, z2]. */
export type Box16 = [number, number, number, number, number, number];

export interface BlockDef {
  name: string;          // short name without namespace
  display: string;
  props: [string, string[]][];
  def: number;           // default state index
  emit: number;
  filter: number;
  transparent: boolean;
  shape: number | number[];
}

type RawBlock = [string, string, [string, string[]][], number, number, number, number, number | number[]];
const data = raw as unknown as { v: string; dv: number; shapes: Box16[][]; blocks: RawBlock[] };

export const DATA_MC_VERSION = data.v;
export const DATA_VERSION = data.dv;
export const SHAPES = data.shapes;

export const BLOCKS = new Map<string, BlockDef>();
for (const b of data.blocks) {
  BLOCKS.set(b[0], { name: b[0], display: b[1], props: b[2], def: b[3], emit: b[4], filter: b[5], transparent: b[6] === 1, shape: b[7] });
}

export function defaultProps(def: BlockDef): Props {
  const out: Props = {};
  let rest = def.def;
  for (let i = def.props.length - 1; i >= 0; i--) {
    const [name, values] = def.props[i];
    out[name] = values[rest % values.length];
    rest = Math.floor(rest / values.length);
  }
  return out;
}

/** State index within the block, missing/unknown properties fall back to the default. */
export function stateIndex(def: BlockDef, props: Props): number {
  const defaults = defaultProps(def);
  let index = 0;
  for (const [name, values] of def.props) {
    let vi = values.indexOf(props[name]);
    if (vi < 0) vi = values.indexOf(defaults[name]);
    index = index * values.length + Math.max(0, vi);
  }
  return index;
}

export function shapeOf(def: BlockDef | undefined, props: Props): Box16[] {
  if (!def) return [[0, 0, 0, 16, 16, 16]];
  const ref = typeof def.shape === 'number' ? def.shape : def.shape[stateIndex(def, props)] ?? def.shape[0];
  return SHAPES[ref] ?? [];
}

/** Completes the given props with defaults (keeps unknown extra props). */
export function fullProps(def: BlockDef | undefined, props: Props): Props {
  return def ? { ...defaultProps(def), ...props } : { ...props };
}
