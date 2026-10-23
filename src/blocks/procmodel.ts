// Procedural block models (used when no Minecraft jar is loaded, and for entity-rendered blocks).
import { box, type ElementSpec, type FaceName, type PartSpec } from '../render/model';
import { dyeOf, WOODS, woodOf } from './colors';
import { DIR_INDEX, type BlockInfo } from './info';
import type { Props } from '../world/world';

const T = (n: string) => 'proc:' + n;
const CROSS = (n: string) => 'proc:cross:' + n;
const Y_NORTH: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
const Y_SOUTH: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 };
const Y_EAST: Record<string, number> = { east: 0, south: 90, west: 180, north: 270 };

const PLURAL: Record<string, string> = {
  brick: 'bricks', stone_brick: 'stone_bricks', mossy_stone_brick: 'mossy_stone_bricks', nether_brick: 'nether_bricks',
  red_nether_brick: 'red_nether_bricks', end_stone_brick: 'end_stone_bricks', prismarine_brick: 'prismarine_bricks',
  mud_brick: 'mud_bricks', deepslate_brick: 'deepslate_bricks', deepslate_tile: 'deepslate_tiles',
  polished_blackstone_brick: 'polished_blackstone_bricks', tuff_brick: 'tuff_bricks', resin_brick: 'resin_bricks',
  quartz: 'quartz_block', purpur: 'purpur_block', petrified_oak: 'oak_planks', light_weighted: 'gold_block', heavy_weighted: 'iron_block',
};

/** Material block behind shaped variants (oak_stairs → oak_planks, cobblestone_wall → cobblestone, …). */
export function baseFor(s: string): string {
  const unwaxed = s.replace(/^waxed_/, '');
  const b = unwaxed.replace(/_(slab|stairs|wall|fence_gate|fence|pressure_plate|button|wall_sign|wall_hanging_sign|hanging_sign|sign)$/, '');
  if (b === unwaxed) return unwaxed;
  if ((WOODS as readonly string[]).includes(b)) return `${b}_planks`;
  return PLURAL[b] ?? b;
}

/** Face textures of a full cube in dir order [east, west, up, down, south, north]. */
export function cubeTex(s: string, p: Props): string[] {
  const all = (t: string) => [t, t, t, t, t, t];
  const tb = (side: string, top: string, bottom = top) => [side, side, top, bottom, side, side];
  const axis = (side: string, end: string) => (p.axis === 'x' ? [end, end, side, side, side, side] : p.axis === 'z' ? [side, side, side, side, end, end] : tb(side, end));
  const withFront = (t: string[], front: string, back?: string) => {
    const d = DIR_INDEX[p.facing ?? 'north'] ?? 5;
    t[d] = front;
    if (back) t[d ^ 1] = back;
    return t;
  };
  const lit = p.lit === 'true';
  switch (s) {
    case 'grass_block': return p.snowy === 'true' ? tb('grass_block_snow', 'snow', 'dirt') : tb('grass_block_side', 'grass_block_top', 'dirt');
    case 'mycelium': case 'podzol': return tb(`${s}_side`, `${s}_top`, 'dirt');
    case 'dirt_path': return tb('dirt_path_side', 'dirt_path_top', 'dirt');
    case 'farmland': return tb('dirt', p.moisture === '7' ? 'farmland_moist' : 'farmland', 'dirt');
    case 'furnace': case 'smoker': case 'blast_furnace': return withFront(tb(`${s}_side`, `${s}_top`), `${s}_front${lit ? '_on' : ''}`);
    case 'dispenser': case 'dropper': {
      const vertical = p.facing === 'up' || p.facing === 'down';
      return withFront(tb('furnace_side', 'furnace_top'), `${s}_front${vertical ? '_vertical' : ''}`);
    }
    case 'observer': {
      const t = all('observer_side');
      if (p.facing !== 'up' && p.facing !== 'down') { t[2] = 'observer_top'; t[3] = 'observer_top'; }
      return withFront(t, 'observer_front', p.powered === 'true' ? 'observer_back_on' : 'observer_back');
    }
    case 'piston': case 'sticky_piston': return withFront(all('piston_side'), s === 'piston' ? 'piston_top' : 'piston_top_sticky', 'piston_bottom');
    case 'crafting_table': return ['crafting_table_side', 'crafting_table_side', 'crafting_table_top', 'oak_planks', 'crafting_table_front', 'crafting_table_front'];
    case 'bookshelf': return tb('bookshelf', 'oak_planks');
    case 'tnt': return tb('tnt_side', 'tnt_top', 'tnt_bottom');
    case 'pumpkin': return tb('pumpkin_side', 'pumpkin_top');
    case 'carved_pumpkin': case 'jack_o_lantern': return withFront(tb('pumpkin_side', 'pumpkin_top'), s);
    case 'melon': return tb('melon_side', 'melon_top');
    case 'sandstone': case 'red_sandstone': return tb(s, `${s}_top`, `${s}_bottom`);
    case 'cut_sandstone': case 'chiseled_sandstone': return tb(s, 'sandstone_top');
    case 'cut_red_sandstone': case 'chiseled_red_sandstone': return tb(s, 'red_sandstone_top');
    case 'smooth_sandstone': return all('sandstone_top');
    case 'smooth_red_sandstone': return all('red_sandstone_top');
    case 'quartz_block': return tb('quartz_block_side', 'quartz_block_top');
    case 'smooth_quartz': return all('quartz_block_bottom');
    case 'barrel': return withFront(all('barrel_side'), p.open === 'true' ? 'barrel_top_open' : 'barrel_top', 'barrel_bottom');
    case 'jukebox': return tb('jukebox_side', 'jukebox_top');
    case 'redstone_lamp': return all(lit ? 'redstone_lamp_on' : 'redstone_lamp');
    case 'target': return tb('target_side', 'target_top');
    case 'snow_block': return all('snow');
    case 'hay_block': case 'bone_block': return axis(`${s}_side`, `${s}_top`);
    case 'basalt': case 'polished_basalt': return axis(`${s}_side`, `${s}_top`);
    case 'quartz_pillar': case 'purpur_pillar': return axis(s, `${s}_top`);
    case 'deepslate': return axis('deepslate', 'deepslate_top');
    case 'cactus': return tb('cactus_side', 'cactus_top', 'cactus_bottom');
  }
  if (/_wood$|_hyphae$/.test(s)) { const log = s.replace(/_wood$/, '_log').replace(/_hyphae$/, '_stem'); return all(log); }
  if (/_log$|_stem$|^(stripped_)?bamboo_block$/.test(s) && 'axis' in p) return axis(s, `${s}_top`);
  if ('axis' in p && s.endsWith('froglight')) return axis(`${s}_side`, `${s}_top`);
  return all(s);
}

const cubeFaces = (tex: string[], tint?: number): ElementSpec['faces'] => {
  const names: FaceName[] = ['east', 'west', 'up', 'down', 'south', 'north'];
  const faces: ElementSpec['faces'] = {};
  names.forEach((f, i) => { faces[f] = { texture: T(tex[i]), cullface: f, tintindex: tint }; });
  return faces;
};

function cross(tex: string, from = 0, to = 16, inset = 0.8, tint?: number): ElementSpec[] {
  const face = { texture: tex, uv: [0, 16 - (to - from), 16, 16], tintindex: tint };
  return [
    { from: [inset, from, 8], to: [16 - inset, to, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true }, shade_direction_override: 'up', faces: { north: face, south: face } },
    { from: [8, from, inset], to: [8, to, 16 - inset], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true }, shade_direction_override: 'up', faces: { west: face, east: face } },
  ];
}

function crop(tex: string): ElementSpec[] {
  const f = { texture: tex, uv: [0, 0, 16, 16] };
  return [
    { from: [4, -1, 0], to: [4, 15, 16], shade_direction_override: 'up', faces: { east: f, west: f } },
    { from: [12, -1, 0], to: [12, 15, 16], shade_direction_override: 'up', faces: { east: f, west: f } },
    { from: [0, -1, 4], to: [16, 15, 4], shade_direction_override: 'up', faces: { north: f, south: f } },
    { from: [0, -1, 12], to: [16, 15, 12], shade_direction_override: 'up', faces: { north: f, south: f } },
  ];
}

const flat = (tex: string, y = 0.25, tint?: number): ElementSpec => ({
  from: [0, y, 0], to: [16, y, 16],
  faces: { up: { texture: tex, tintindex: tint }, down: { texture: tex, tintindex: tint } },
});

const panel = (side: string, tex: string): ElementSpec => {
  const o = 0.8;
  const f = { texture: tex };
  switch (side) {
    case 'north': return { from: [0, 0, o], to: [16, 16, o], faces: { north: f, south: f } };
    case 'south': return { from: [0, 0, 16 - o], to: [16, 16, 16 - o], faces: { north: f, south: f } };
    case 'west': return { from: [o, 0, 0], to: [o, 16, 16], faces: { east: f, west: f } };
    case 'east': return { from: [16 - o, 0, 0], to: [16 - o, 16, 16], faces: { east: f, west: f } };
    case 'up': return { from: [0, 16 - o, 0], to: [16, 16 - o, 16], faces: { up: f, down: f } };
    default: return { from: [0, o, 0], to: [16, o, 16], faces: { up: f, down: f } };
  }
};

const one = (elements: ElementSpec[], y = 0, x = 0, ao = true): PartSpec[] => [{ elements, y, x, ao }];

const CROPS: Record<string, (age: number) => number> = {
  wheat: (a) => a, carrots: (a) => [0, 0, 1, 1, 2, 2, 2, 3][a] ?? 3, potatoes: (a) => [0, 0, 1, 1, 2, 2, 2, 3][a] ?? 3,
  beetroots: (a) => a, torchflower_crop: (a) => a, pitcher_crop: (a) => Math.min(a, 4),
};

export function proceduralParts(info: BlockInfo): PartSpec[] {
  const s = info.short, p = info.props;
  if (info.invisible || s === 'water' || s === 'lava' || s === 'bubble_column') return [];

  if (info.opaque || (info.fullCollision && info.shape.length === 1)) {
    if (s === 'slime_block') return one([{ from: [0, 0, 0], to: [16, 16, 16], faces: cubeFaces(cubeTex(s, p)) }], 0, 0, false);
    // tintindex only takes effect when the texture comes from a pack (procedural textures are pre-coloured)
    const faces = cubeFaces(cubeTex(baseFor(s), p), s.endsWith('_leaves') ? 0 : undefined);
    if (s === 'grass_block' && p.snowy !== 'true') faces.up!.tintindex = 0;
    return one([{ from: [0, 0, 0], to: [16, 16, 16], faces }]);
  }
  if (/^(short_grass|fern|bush|tall_grass|large_fern)$/.test(s)) {
    const tex = s === 'tall_grass' || s === 'large_fern' ? `${s}_${p.half === 'upper' ? 'top' : 'bottom'}` : s;
    return one(cross(T(tex), 0, 16, 0.8, 0), 0, 0, false);
  }

  // --- explicit shapes -----------------------------------------------------
  if (CROPS[s]) return one(crop(T(`${s}_stage${CROPS[s](Number(p.age ?? 0))}`)), 0, 0, false);
  if (s === 'nether_wart') return one(crop(T(`nether_wart_stage${[0, 1, 1, 2][Number(p.age ?? 0)]}`)), 0, 0, false);
  if (s === 'sweet_berry_bush') return one(cross(T(`sweet_berry_bush_stage${p.age ?? 0}`)), 0, 0, false);
  if (s === 'pumpkin_stem' || s === 'melon_stem') {
    const h = (Number(p.age ?? 0) + 1) * 2;
    return one(cross(T(s), 0, h).map((e) => ({ ...e, faces: Object.fromEntries(Object.entries(e.faces).map(([k, f]) => [k, { ...f!, tintindex: 0 }])) })), 0, 0, false);
  }
  if (s === 'attached_pumpkin_stem' || s === 'attached_melon_stem') return one(cross(T(s)).map((e) => ({ ...e, faces: Object.fromEntries(Object.entries(e.faces).map(([k, f]) => [k, { ...f!, tintindex: 0 }])) })), 0, 0, false);
  if (s.endsWith('_fence')) {
    const tex = T(baseFor(s));
    const els = [box([6, 0, 6], [10, 16, 10], tex)];
    const rails: Record<string, number[][]> = {
      north: [[7, 12, 0, 9, 15, 6], [7, 6, 0, 9, 9, 6]], south: [[7, 12, 10, 9, 15, 16], [7, 6, 10, 9, 9, 16]],
      east: [[10, 12, 7, 16, 15, 9], [10, 6, 7, 16, 9, 9]], west: [[0, 12, 7, 6, 15, 9], [0, 6, 7, 6, 9, 9]],
    };
    for (const [d, bs] of Object.entries(rails)) if (p[d] === 'true') for (const b of bs) els.push(box(b.slice(0, 3), b.slice(3), tex));
    return one(els);
  }
  if (s.endsWith('_wall') && 'up' in p) {
    const tex = T(baseFor(s));
    const els: ElementSpec[] = [];
    if (p.up === 'true') els.push(box([4, 0, 4], [12, 16, 12], tex));
    const sides: Record<string, number[]> = { north: [5, 0, 0, 11, 0, 8], south: [5, 0, 8, 11, 0, 16], east: [8, 0, 5, 16, 0, 11], west: [0, 0, 5, 8, 0, 11] };
    for (const [d, b] of Object.entries(sides)) {
      if (!p[d] || p[d] === 'none') continue;
      const h = p[d] === 'tall' ? 16 : 14;
      els.push(box([b[0], 0, b[2]], [b[3], h, b[5]], tex));
    }
    if (!els.length) els.push(box([4, 0, 4], [12, 16, 12], tex));
    return one(els);
  }
  if (s.endsWith('_fence_gate')) {
    const tex = T(baseFor(s));
    const dy = p.in_wall === 'true' ? -3 : 0;
    const b = (f: number[], t: number[]) => box([f[0], f[1] + dy, f[2]], [t[0], t[1] + dy, t[2]], tex, { cull: false });
    const els = [b([0, 5, 7], [2, 16, 9]), b([14, 5, 7], [16, 16, 9])];
    if (p.open === 'true') els.push(b([0, 6, 9], [2, 9, 15]), b([0, 12, 9], [2, 15, 15]), b([14, 6, 9], [16, 9, 15]), b([14, 12, 9], [16, 15, 15]), b([0, 9, 13], [2, 12, 15]), b([14, 9, 13], [16, 12, 15]));
    else els.push(b([6, 6, 7], [8, 15, 9]), b([8, 6, 7], [10, 15, 9]), b([2, 6, 7], [6, 9, 9]), b([2, 12, 7], [6, 15, 9]), b([10, 6, 7], [14, 9, 9]), b([10, 12, 7], [14, 15, 9]));
    return one(els, Y_SOUTH[p.facing ?? 'south'] ?? 0);
  }
  if (s === 'snow') return one([box([0, 0, 0], [16, 2 * Number(p.layers ?? 1), 16], T('snow'))]);
  if (s === 'torch' || s === 'soul_torch' || s === 'redstone_torch' || s === 'copper_torch') {
    const tex = T(s === 'redstone_torch' && p.lit === 'false' ? 'redstone_torch_off' : s);
    return one([{ from: [7, 0, 7], to: [9, 10, 9], shade: false, faces: { north: { texture: tex, uv: [7, 6, 9, 16] }, south: { texture: tex, uv: [7, 6, 9, 16] }, east: { texture: tex, uv: [7, 6, 9, 16] }, west: { texture: tex, uv: [7, 6, 9, 16] }, up: { texture: tex, uv: [7, 6, 9, 8] }, down: { texture: tex, uv: [7, 13, 9, 15] } } }], 0, 0, false);
  }
  if (s.endsWith('wall_torch')) {
    const base = s === 'redstone_wall_torch' ? (p.lit === 'false' ? 'redstone_torch_off' : 'redstone_torch') : s.replace('wall_torch', 'torch');
    const tex = T(base);
    const f = (uv: number[]) => ({ texture: tex, uv });
    return one([{ from: [-1, 3.5, 7], to: [1, 13.5, 9], rotation: { origin: [0, 3.5, 8], axis: 'z', angle: -22.5 }, shade: false, faces: { north: f([7, 6, 9, 16]), south: f([7, 6, 9, 16]), east: f([7, 6, 9, 16]), west: f([7, 6, 9, 16]), up: f([7, 6, 9, 8]) } }], Y_EAST[p.facing ?? 'east'] ?? 0, 0, false);
  }
  if (s.endsWith('rail')) {
    const shape = p.shape ?? 'north_south';
    const curved = /^(south|north)_(east|west)$/.test(shape);
    const tex = T(curved ? `${s}_corner` : p.powered === 'true' ? `${s}_on` : s);
    const yRot = curved ? ({ south_east: 0, south_west: 90, north_west: 180, north_east: 270 } as Record<string, number>)[shape] : shape.includes('east') || shape.includes('west') ? 90 : 0;
    if (shape.startsWith('ascending')) {
      const dir = shape.split('_')[1];
      const r = { north: 0, east: 90, south: 180, west: 270 }[dir] ?? 0;
      return one([{ from: [0, 9, 0], to: [16, 9, 16], rotation: { origin: [8, 9, 8], axis: 'x', angle: 45, rescale: true }, faces: { up: { texture: tex }, down: { texture: tex } } }], r, 0, false);
    }
    return one([flat(tex, 1)], yRot, 0, false);
  }
  if (s === 'redstone_wire') {
    const dirs = ['north', 'east', 'south', 'west'];
    const con = dirs.filter((d) => p[d] && p[d] !== 'none');
    const letters = con.map((d) => d[0]).join('');
    const els: ElementSpec[] = [flat(T(letters ? `redstone_dust_${letters}` : 'redstone_dust_dot'), 0.25, 0)];
    for (const d of dirs) if (p[d] === 'up') els.push({ ...panel(d, T('redstone_dust_ns')), faces: Object.fromEntries(Object.entries(panel(d, T('redstone_dust_ns')).faces).map(([k, f]) => [k, { ...f!, tintindex: 0 }])) });
    return one(els, 0, 0, false);
  }
  if (s.endsWith('_button')) {
    const tex = T(baseFor(s));
    const t = p.powered === 'true' ? 1 : 2;
    if (p.face === 'floor' || p.face === 'ceiling') {
      const y0 = p.face === 'floor' ? 0 : 16 - t;
      return one([box([5, y0, 6], [11, y0 + t, 10], tex)], Y_NORTH[p.facing ?? 'north'] ?? 0);
    }
    return one([box([5, 6, 16 - t], [11, 10, 16], tex)], Y_NORTH[p.facing ?? 'north'] ?? 0);
  }
  if (s.endsWith('_pressure_plate')) {
    const h = p.powered === 'true' || (p.power && p.power !== '0') ? 0.5 : 1;
    return one([box([1, 0, 1], [15, h, 15], T(baseFor(s)))]);
  }
  if (s === 'lever') {
    const xr = p.face === 'wall' ? 90 : p.face === 'ceiling' ? 180 : 0;
    const angle = p.powered === 'true' ? 45 : -45;
    return one([
      box([5, 0, 4], [11, 3, 12], T('cobblestone')),
      { from: [7, 1, 7], to: [9, 11, 9], rotation: { origin: [8, 1, 8], axis: 'x', angle }, faces: { north: { texture: T('oak_planks') }, south: { texture: T('oak_planks') }, east: { texture: T('oak_planks') }, west: { texture: T('oak_planks') }, up: { texture: T('redstone_torch_off') } } },
    ], (Y_NORTH[p.facing ?? 'north'] ?? 0) + (p.face === 'ceiling' ? 180 : 0), xr);
  }
  if (s.endsWith('_wall_sign')) return one([box([0, 4.5, 14], [16, 12.5, 16], T(baseFor(s)))], Y_NORTH[p.facing ?? 'north'] ?? 0);
  if (s.endsWith('_hanging_sign')) return one([box([1, 0, 7], [15, 10, 9], T(baseFor(s))), box([3, 10, 7.5], [4, 16, 8.5], T('iron_chain')), box([12, 10, 7.5], [13, 16, 8.5], T('iron_chain'))], s.includes('wall') ? Y_NORTH[p.facing ?? 'north'] ?? 0 : Number(p.rotation ?? 0) * 22.5);
  if (s.endsWith('_sign')) return one([box([0, 7, 7.25], [16, 16, 8.75], T(baseFor(s))), box([7.25, 0, 7.25], [8.75, 7, 8.75], T(woodOf(s) ? `${woodOf(s)}_log` : 'oak_log'))], Number(p.rotation ?? 0) * 22.5);
  if (s.endsWith('_wall_banner')) return one([box([1, 0, 15], [15, 16, 16], T(`${dyeOf(s) ?? 'white'}_wool`))], Y_NORTH[p.facing ?? 'north'] ?? 0);
  if (s.endsWith('_banner')) return one([box([7, 0, 7], [9, 16, 9], T('oak_planks')), box([1, 2, 8], [15, 16, 9], T(`${dyeOf(s) ?? 'white'}_wool`))], Number(p.rotation ?? 0) * 22.5);
  if (s === 'vine' || s === 'glow_lichen' || s === 'sculk_vein' || s === 'resin_clump') {
    const tex = s === 'vine' ? T('vine') : T(s);
    const els = ['north', 'east', 'south', 'west', 'up', 'down'].filter((d) => p[d] === 'true').map((d) => {
      const e = panel(d, tex);
      if (s === 'vine') for (const f of Object.values(e.faces)) f!.tintindex = 0;
      return e;
    });
    return one(els.length ? els : [panel('north', tex)], 0, 0, false);
  }
  if (s === 'ladder') return one([{ from: [0, 0, 15.2], to: [16, 16, 15.2], faces: { north: { texture: T('ladder') }, south: { texture: T('ladder') } } }], Y_NORTH[p.facing ?? 'north'] ?? 0, 0, false);
  if (s === 'lily_pad') return one([flat(T('lily_pad'), 0.25, 0)], 0, 0, false);
  if (s === 'pink_petals' || s === 'wildflowers' || s === 'leaf_litter' || s === 'frogspawn') return one([flat(CROSS(s), 1)], Y_NORTH[p.facing ?? 'north'] ?? 0, 0, false);
  if (s === 'tripwire') return one([box([0, 1, 7.5], [16, 1.5, 8.5], T('cobweb'))], p.east === 'true' || p.west === 'true' ? 90 : 0, 0, false);
  if (s === 'nether_portal') return one([box(p.axis === 'z' ? [6, 0, 0] : [0, 0, 6], p.axis === 'z' ? [10, 16, 16] : [16, 16, 10], T('nether_portal'), { cull: false })], 0, 0, false);
  if (s === 'end_portal' || s === 'end_gateway') return one([box([0, 0, 0], [16, 12, 16], T('obsidian'))]);
  if (s === 'cactus') return one([{ from: [1, 0, 1], to: [15, 16, 15], faces: { north: { texture: T('cactus_side') }, south: { texture: T('cactus_side') }, east: { texture: T('cactus_side') }, west: { texture: T('cactus_side') }, up: { texture: T('cactus_top'), cullface: 'up' }, down: { texture: T('cactus_bottom'), cullface: 'down' } } }]);
  if (s === 'sugar_cane' || s === 'kelp' || s === 'kelp_plant' || s === 'seagrass' || s === 'tall_seagrass' || s === 'fire' || s === 'soul_fire' || s === 'cobweb' || s.endsWith('_sapling')) {
    const tex = s === 'fire' || s === 'soul_fire' ? T(`${s}_0`) : s === 'tall_seagrass' ? T(`tall_seagrass_${p.half === 'upper' ? 'top' : 'bottom'}`) : T(s);
    return one(cross(tex, 0, 16, s === 'fire' ? 0 : 0.8, s === 'sugar_cane' ? 0 : undefined), 0, 0, false);
  }
  if (s.startsWith('potted_')) {
    const plant = s.slice(7);
    return one([box([5, 0, 5], [11, 6, 11], T('flower_pot')), ...cross(plant === 'cactus' ? T('cactus_side') : CROSS(plant), 4, 16, 3)]);
  }
  if (s === 'bamboo') {
    const els = [box([6.5, 0, 6.5], [9.5, 16, 9.5], T('bamboo_stalk'))];
    if (p.leaves && p.leaves !== 'none') els.push(...cross(CROSS('bamboo_leaves')));
    return one(els);
  }
  if (/_door$/.test(s) && info.shape.length) {
    const tex = T(`${s}_${p.half === 'upper' ? 'top' : 'bottom'}`);
    return one(info.shape.map((b) => box(b.slice(0, 3), b.slice(3), tex)));
  }
  if (/_bed$/.test(s)) {
    const top = T(`${s}_${p.part === 'head' ? 'head' : 'foot'}`);
    return one([box([0, 3, 0], [16, 9, 16], { up: top, down: T('oak_planks'), side: T('bed_side') })], Y_SOUTH[p.facing ?? 'south'] ?? 0);
  }
  if (s === 'chest' || s === 'trapped_chest') {
    const t: Partial<Record<FaceName | 'side' | 'all' | 'end', string>> = { up: T('chest_top'), down: T('chest_top'), side: T('chest_side') };
    const front = (p.facing ?? 'north') as FaceName;
    t[front] = T('chest_front');
    return one([box([1, 0, 1], [15, 14, 15], t)]);
  }

  // --- generic -------------------------------------------------------------
  if (info.noCollision) {
    if (s.endsWith('_carpet')) return one([box([0, 0, 0], [16, 1, 16], T(baseCarpet(s)))]);
    if (s.endsWith('_head') || s.endsWith('_skull')) return one([box([4, 0, 4], [12, 8, 12], T(s))]);
    if (/(sunflower|lilac|rose_bush|peony|pitcher_plant)$/.test(s)) return one(cross(CROSS(`${s}_${p.half === 'upper' ? 'top' : 'bottom'}`)), 0, 0, false);
    return one(cross(CROSS(s)), 0, 0, false);
  }
  const tex = s.endsWith('_carpet') ? T(baseCarpet(s)) : s.endsWith('_pane') ? T(s.replace(/_pane$/, '')) : /_slab$|_stairs$/.test(s) ? null : T(s);
  if (!tex) {
    const t = cubeTex(baseFor(s), {});
    return one(info.shape.map((b) => box(b.slice(0, 3), b.slice(3), { east: T(t[0]), west: T(t[1]), up: T(t[2]), down: T(t[3]), south: T(t[4]), north: T(t[5]) })));
  }
  if (s === 'farmland' || s === 'dirt_path') {
    const t = cubeTex(s, p);
    return one(info.shape.map((b) => box(b.slice(0, 3), b.slice(3), { east: T(t[0]), west: T(t[1]), up: T(t[2]), down: T(t[3]), south: T(t[4]), north: T(t[5]) })));
  }
  if (/amethyst_(cluster|bud)$|pointed_dripstone|big_dripleaf_stem|hanging_roots|spore_blossom/.test(s)) return one(cross(CROSS(s)), 0, 0, false);
  if (s === 'cocoa') return one(info.shape.map((b) => box(b.slice(0, 3), b.slice(3), T(`cocoa_stage${p.age ?? 0}`))));
  return one(info.shape.map((b) => box(b.slice(0, 3), b.slice(3), tex)));
}

function baseCarpet(s: string): string {
  if (s === 'moss_carpet') return 'moss_block';
  if (s === 'pale_moss_carpet') return 'pale_moss_block';
  return s.replace(/_carpet$/, '_wool');
}
