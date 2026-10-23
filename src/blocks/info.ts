import { prettyName } from './colors';
import { type BlockDef, BLOCKS, type Box16, fullProps, shapeOf } from './data';
import type { Props, World } from '../world/world';

export interface BlockInfo {
  id: number;
  name: string;
  short: string;
  props: Props;
  def?: BlockDef;
  display: string;
  air: boolean;
  invisible: boolean;
  shape: Box16[];          // collision boxes (1/16 units)
  fullCollision: boolean;
  noCollision: boolean;
  opaque: boolean;         // renders as opaque full cube: hides neighbour faces, casts AO, blocks light
  emit: number;
  filter: number;
  shapeOcclusion: boolean; // light blocked through fully covered faces only (slabs, stairs, ...)
  faceFull: number;        // bitmask of fully covered faces, bit = dir index
  fluid: 0 | 1 | 2;        // 1 water (incl. waterlogged), 2 lava
  signal: boolean;
  spawnSurface: boolean;   // hostile mobs may spawn on top
  spawnBlocked: boolean;   // block may not occupy a mob's spawn space
}

// Direction order used everywhere: +x east, -x west, +y up, -y down, +z south, -z north
export const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const DIR_NAMES = ['east', 'west', 'up', 'down', 'south', 'north'] as const;
export const DIR_INDEX: Record<string, number> = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };

const INVISIBLE = new Set(['air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void', 'moving_piston']);
const VISUAL_FULL = new Set(['soul_sand', 'mud', 'powder_snow']);
const WATER_PLANTS = new Set(['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column', 'water']);
const SIGNAL = new Set(['redstone_wire', 'redstone_torch', 'redstone_wall_torch', 'lever', 'tripwire_hook', 'daylight_detector', 'observer', 'repeater', 'comparator', 'redstone_block', 'target', 'detector_rail', 'trapped_chest', 'lectern', 'sculk_sensor', 'calibrated_sculk_sensor', 'lightning_rod']);
const DANGEROUS = new Set(['fire', 'soul_fire', 'lava', 'magma_block', 'campfire', 'soul_campfire', 'sweet_berry_bush', 'wither_rose', 'cactus', 'powder_snow']);
const NEVER_SPAWN_ON = new Set(['barrier', 'bedrock', 'ice', 'frosted_ice', 'magma_block', 'beacon', 'spawner']);
const LIT_LEVEL: Record<string, number> = {
  furnace: 13, smoker: 13, blast_furnace: 13, redstone_lamp: 15, redstone_torch: 7, redstone_wall_torch: 7,
  redstone_ore: 9, deepslate_redstone_ore: 9, campfire: 15, soul_campfire: 10, candle_cake: 3,
  copper_bulb: 15, exposed_copper_bulb: 12, weathered_copper_bulb: 8, oxidized_copper_bulb: 4,
};

function faceMask(shape: Box16[]): number {
  let mask = 0;
  for (let d = 0; d < 6; d++) {
    const axis = d >> 1, positive = d % 2 === 0;
    const grid = new Uint8Array(256);
    const [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    for (const b of shape) {
      if (positive ? b[axis + 3] < 16 : b[axis] > 0) continue;
      for (let u = Math.max(0, Math.ceil(b[ua])); u < Math.min(16, b[ua + 3]); u++)
        for (let v = Math.max(0, Math.ceil(b[va])); v < Math.min(16, b[va + 3]); v++) grid[u * 16 + v] = 1;
    }
    if (grid.every((g) => g)) mask |= 1 << d;
  }
  return mask;
}

export function describe(id: number, name: string, inputProps: Props): BlockInfo {
  const short = name.slice(name.indexOf(':') + 1);
  const ns = name.slice(0, name.indexOf(':'));
  const def = ns === 'minecraft' ? BLOCKS.get(short) : undefined;
  const props = fullProps(def, inputProps);
  const air = short === 'air' || short === 'cave_air' || short === 'void_air';
  const shape = air ? [] : def ? shapeOf(def, props) : [[0, 0, 0, 16, 16, 16] as Box16];
  const fullCollision = shape.length === 1 && shape[0].every((v, i) => v === (i < 3 ? 0 : 16));
  const transparent = def ? def.transparent : false;
  const invisible = INVISIBLE.has(short);
  const opaque = !invisible && !transparent && (fullCollision || VISUAL_FULL.has(short));

  let emit = def?.emit ?? 0;
  if ('lit' in props) emit = props.lit === 'true' ? LIT_LEVEL[short.replace('waxed_', '')] ?? (short.endsWith('candle') ? 3 * Number(props.candles ?? 1) : emit || 15) : 0;
  if (short === 'respawn_anchor') emit = [0, 3, 7, 11, 15][Number(props.charges ?? 0)] ?? 0;
  if (short === 'sea_pickle') emit = props.waterlogged === 'true' ? 3 + 3 * Number(props.pickles ?? 1) : 0;
  if (short === 'light') emit = Number(props.level ?? 15);
  if (short === 'cave_vines' || short === 'cave_vines_plant') emit = props.berries === 'true' ? 14 : 0;

  const waterlogged = props.waterlogged === 'true' || WATER_PLANTS.has(short);
  const fluid: 0 | 1 | 2 = short === 'lava' ? 2 : waterlogged ? 1 : 0;
  const signal = SIGNAL.has(short) || short.endsWith('_button') || short.endsWith('_pressure_plate');
  const faceFull = opaque ? 63 : faceMask(shape);
  const shapeOcclusion = !opaque && (/_slab$|_stairs$/.test(short) || short === 'farmland' || short === 'dirt_path' || short === 'snow');
  const glassLike = short.includes('glass') || short.endsWith('_leaves');
  const spawnSurface = !invisible && !glassLike && !NEVER_SPAWN_ON.has(short) && emit < 14
    && (VISUAL_FULL.has(short) || (faceFull & (1 << 2)) !== 0);

  return {
    id, name, short, props, def,
    display: def?.display ?? prettyName(short),
    air, invisible, shape, fullCollision, noCollision: shape.length === 0, opaque,
    emit, filter: opaque ? 15 : def?.filter ?? (transparent ? 0 : 15),
    shapeOcclusion, faceFull, fluid, signal, spawnSurface,
    spawnBlocked: fullCollision || signal || fluid !== 0 || short.endsWith('rail') || DANGEROUS.has(short),
  };
}

export class BlockRegistry {
  private infos: BlockInfo[] = [];
  private opaqueCache = new Uint8Array(64);
  private opaqueCount = 0;
  constructor(readonly world: World) {}

  info(id: number): BlockInfo {
    let i = this.infos[id];
    if (!i) {
      const e = this.world.palette[id] ?? this.world.palette[0];
      i = describe(id, e.name, e.props);
      this.infos[id] = i;
    }
    return i;
  }

  /** Per-id lookup table (1 = opaque full cube), refreshed when the palette grows. */
  opaqueTable(): Uint8Array {
    const n = this.world.palette.length;
    if (n > this.opaqueCount) {
      if (this.opaqueCache.length < n) {
        const t = new Uint8Array(n * 2);
        t.set(this.opaqueCache);
        this.opaqueCache = t;
      }
      for (let id = this.opaqueCount; id < n; id++) this.opaqueCache[id] = this.info(id).opaque ? 1 : 0;
      this.opaqueCount = n;
    }
    return this.opaqueCache;
  }
}
