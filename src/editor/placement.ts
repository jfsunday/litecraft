// Minecraft-like placement rules (orientation from view direction and clicked face) and neighbour shape updates.
import { BLOCKS, defaultProps } from '../blocks/data';
import { type BlockInfo, type BlockRegistry, DIR_NAMES } from '../blocks/info';
import { parseKey, type Props, type World } from '../world/world';
import { FACE_NORMALS, type Hit } from './raycast';

export interface Change { x: number; y: number; z: number; id: number }

type H4 = 'north' | 'east' | 'south' | 'west';
const H: H4[] = ['north', 'east', 'south', 'west'];
const OPP: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const OFF: Record<string, [number, number, number]> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const CCW: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const axisOf = (d: string) => (d === 'east' || d === 'west' ? 'x' : d === 'up' || d === 'down' ? 'y' : 'z');
const horizontal = (d: string) => d !== 'up' && d !== 'down';

function hLook(look: number[]): H4 {
  return Math.abs(look[0]) > Math.abs(look[2]) ? (look[0] > 0 ? 'east' : 'west') : (look[2] > 0 ? 'south' : 'north');
}
function nearestLook(look: number[]): string {
  const ax = Math.abs(look[0]), ay = Math.abs(look[1]), az = Math.abs(look[2]);
  if (ay > ax && ay > az) return look[1] > 0 ? 'up' : 'down';
  return hLook(look);
}
function rot16(look: number[]): string {
  const yaw = (Math.atan2(-look[0], look[2]) * 180) / Math.PI;
  return String(Math.floor(((180 + yaw) * 16) / 360 + 0.5) & 15);
}

const REPLACEABLE = /^(air|cave_air|water|lava|short_grass|fern|dead_bush|fire|soul_fire|seagrass|structure_void|light|bush|short_dry_grass|tall_dry_grass)$/;
export const isReplaceable = (i: BlockInfo) => i.air || REPLACEABLE.test(i.short) || (i.short === 'snow' && i.props.layers === '1');

const WALL_VARIANT: [RegExp, (s: string) => string][] = [
  [/^(torch|soul_torch|copper_torch|redstone_torch)$/, (s) => s.replace('torch', 'wall_torch')],
  [/_sign$/, (s) => s.replace(/_sign$/, '_wall_sign')],
  [/_banner$/, (s) => s.replace(/_banner$/, '_wall_banner')],
  [/_(skull|head)$/, (s) => s.replace(/_(skull|head)$/, '_wall_$1')],
  [/_coral_fan$/, (s) => s.replace(/_coral_fan$/, '_coral_wall_fan')],
];

/** Blocks to set when placing `selectedKey` against `hit`. */
export function placeChanges(world: World, reg: BlockRegistry, selectedKey: string, hit: Hit, look: number[]): Change[] {
  const sel = parseKey(selectedKey);
  let short = sel.name.slice(sel.name.indexOf(':') + 1);
  const ns = sel.name.slice(0, sel.name.indexOf(':'));
  const face = DIR_NAMES[hit.face];
  const n = FACE_NORMALS[hit.face];

  if (!hit.floor && short.endsWith('_slab')) {
    const t = reg.info(hit.id);
    if (t.short === short && ((t.props.type === 'bottom' && face === 'up') || (t.props.type === 'top' && face === 'down'))) {
      return [{ x: hit.x, y: hit.y, z: hit.z, id: world.withProps(hit.id, { type: 'double' }) }];
    }
  }

  let tx = hit.x + n[0], ty = hit.y + n[1], tz = hit.z + n[2];
  if (!hit.floor && isReplaceable(reg.info(hit.id)) && !reg.info(hit.id).air) { tx = hit.x; ty = hit.y; tz = hit.z; }
  const target = reg.info(world.get(tx, ty, tz));
  if (!isReplaceable(target)) return [];

  const def = BLOCKS.get(short);
  const defaults = def ? defaultProps(def) : {};
  const props: Props = { ...defaults, ...sel.props };
  const fy = hit.floor ? 0 : hit.point[1] - hit.y;
  const upper = face === 'down' || (face !== 'up' && fy > 0.5);
  const hl = hLook(look);
  const extra: { dx: number; dy: number; dz: number; props: Props }[] = [];

  if (short.endsWith('_slab')) props.type = upper ? 'top' : 'bottom';
  else if (short.endsWith('_stairs')) { props.facing = hl; props.half = upper ? 'top' : 'bottom'; props.shape = 'straight'; }
  else if (short.endsWith('_trapdoor')) {
    if (horizontal(face)) { props.facing = face; props.half = fy > 0.5 ? 'top' : 'bottom'; }
    else { props.facing = OPP[hl]; props.half = face === 'up' ? 'bottom' : 'top'; }
  } else if (short.endsWith('_door')) {
    props.facing = hl; props.half = 'lower'; props.hinge = 'left';
    extra.push({ dx: 0, dy: 1, dz: 0, props: { ...props, half: 'upper' } });
  } else if (short.endsWith('_bed')) {
    props.facing = hl; props.part = 'foot';
    const o = OFF[hl];
    extra.push({ dx: o[0], dy: 0, dz: o[2], props: { ...props, part: 'head' } });
  } else if (defaults.half === 'lower' || (def?.props.find((p) => p[0] === 'half')?.[1].includes('upper') && !short.endsWith('_door'))) {
    props.half = 'lower';
    extra.push({ dx: 0, dy: 1, dz: 0, props: { ...props, half: 'upper' } });
  } else if (short.endsWith('_button') || short === 'lever') {
    if (face === 'up') { props.face = 'floor'; props.facing = hl; }
    else if (face === 'down') { props.face = 'ceiling'; props.facing = hl; }
    else { props.face = 'wall'; props.facing = face; }
  } else if (short === 'ladder') props.facing = horizontal(face) ? face : OPP[hl];
  else if (short === 'hopper') props.facing = horizontal(face) ? OPP[face] : 'down';
  else if (short === 'observer') props.facing = nearestLook(look);
  else if (short === 'end_rod' || short === 'lightning_rod') props.facing = face;
  else if (short === 'cocoa') props.facing = horizontal(face) ? OPP[face] : hl;
  else if (short === 'vine' || short === 'glow_lichen') {
    for (const d of H) props[d] = 'false';
    const toward = OPP[face];
    if (toward in props || toward === 'up') props[toward] = 'true';
  } else {
    const wall = WALL_VARIANT.find(([re]) => re.test(short));
    if (wall && horizontal(face) && !short.includes('_wall_') && BLOCKS.has(wall[1](short))) {
      short = wall[1](short);
      const wd = defaultProps(BLOCKS.get(short)!);
      const kept = Object.fromEntries(Object.entries(props).filter(([k]) => k in wd));
      for (const k of Object.keys(props)) delete props[k];
      Object.assign(props, wd, kept, { facing: face });
    } else if ('rotation' in defaults) props.rotation = rot16(look);
    else if ('facing' in defaults && def) {
      const values = def.props.find((p) => p[0] === 'facing')![1];
      if (values.length === 6) props.facing = OPP[nearestLook(look)];
      else if (short.endsWith('fence_gate')) props.facing = hl;
      else props.facing = OPP[hl];
    }
  }
  if ('axis' in defaults && def) {
    const values = def.props.find((p) => p[0] === 'axis')![1];
    const ax = axisOf(face);
    props.axis = values.includes(ax) ? ax : axisOf(hl) === 'x' ? 'x' : 'z';
  }
  if (target.short === 'water' && target.props.level === '0' && 'waterlogged' in defaults) props.waterlogged = 'true';

  const name = `${ns}:${short}`;
  const out: Change[] = [{ x: tx, y: ty, z: tz, id: world.state(name, props) }];
  for (const e of extra) {
    const ex = tx + e.dx, ey = ty + e.dy, ez = tz + e.dz;
    if (!isReplaceable(reg.info(world.get(ex, ey, ez)))) return [];
    out.push({ x: ex, y: ey, z: ez, id: world.state(name, e.props) });
  }
  return out;
}

/** Removing a block also removes the other half of doors, beds and tall plants. */
export function breakChanges(world: World, reg: BlockRegistry, x: number, y: number, z: number): Change[] {
  const info = reg.info(world.get(x, y, z));
  if (info.air) return [];
  const out: Change[] = [{ x, y, z, id: 0 }];
  const p = info.props;
  const partner = (px: number, py: number, pz: number) => {
    if (reg.info(world.get(px, py, pz)).short === info.short) out.push({ x: px, y: py, z: pz, id: 0 });
  };
  if (p.half === 'lower') partner(x, y + 1, z);
  else if (p.half === 'upper') partner(x, y - 1, z);
  if (p.part && p.facing) {
    const o = OFF[p.facing], s = p.part === 'foot' ? 1 : -1;
    partner(x + o[0] * s, y, z + o[2] * s);
  }
  return out;
}

// ---- connection / shape updates ------------------------------------------------

const EXCEPTION = /_leaves$|^barrier$|^(carved_)?pumpkin$|^jack_o_lantern$|^melon$|shulker_box$/;
const solidFace = (i: BlockInfo) => i.fullCollision && !EXCEPTION.test(i.short);
const isWall = (i: BlockInfo) => i.short.endsWith('_wall') && 'up' in i.props;
const isPane = (i: BlockInfo) => i.short.endsWith('_pane') || i.short.endsWith('_bars');
const isStairs = (i: BlockInfo) => i.short.endsWith('_stairs');
const gateConnects = (i: BlockInfo, d: string) => i.short.endsWith('_fence_gate') && axisOf(i.props.facing ?? 'north') !== axisOf(d);

export function shapeUpdates(world: World, reg: BlockRegistry, positions: [number, number, number][]): Change[] {
  const seen = new Set<string>();
  const todo: [number, number, number][] = [];
  for (const [x, y, z] of positions) {
    for (let dy = -1; dy <= 1; dy++) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy},${z + dz}`;
      if (!seen.has(k)) { seen.add(k); todo.push([x + dx, y + dy, z + dz]); }
    }
  }
  const at = (x: number, y: number, z: number) => reg.info(world.get(x, y, z));
  const out: Change[] = [];
  for (const [x, y, z] of todo) {
    const id = world.get(x, y, z);
    if (!id) continue;
    const info = reg.info(id);
    const s = info.short;
    const nb = (d: string) => { const o = OFF[d]; return at(x + o[0], y + o[1], z + o[2]); };
    let patch: Props | null = null;
    if (s.endsWith('_fence')) {
      patch = {};
      for (const d of H) {
        const n = nb(d);
        patch[d] = String((n.short.endsWith('_fence') && (n.short === 'nether_brick_fence') === (s === 'nether_brick_fence')) || gateConnects(n, d) || solidFace(n));
      }
    } else if (isPane(info)) {
      patch = {};
      for (const d of H) { const n = nb(d); patch[d] = String(isPane(n) || isWall(n) || solidFace(n)); }
    } else if (isWall(info)) {
      patch = {};
      const above = nb('up');
      const con: Record<string, boolean> = {};
      for (const d of H) {
        const n = nb(d);
        con[d] = isWall(n) || isPane(n) || gateConnects(n, d) || solidFace(n);
        const tall = solidFace(above) || (isWall(above) && above.props[d] !== 'none');
        patch[d] = con[d] ? (tall ? 'tall' : 'low') : 'none';
      }
      const straight = (con.north && con.south && !con.east && !con.west) || (con.east && con.west && !con.north && !con.south);
      patch.up = String(!straight || (isWall(above) && above.props.up === 'true') || /torch|lantern|sign|banner|skull|head/.test(above.short));
    } else if (isStairs(info)) {
      const f = info.props.facing, half = info.props.half;
      let shape = 'straight';
      const take = (dir: string) => { const o = nb(dir); return !isStairs(o) || o.props.facing !== f || o.props.half !== half; };
      const front = nb(f);
      if (isStairs(front) && front.props.half === half && axisOf(front.props.facing) !== axisOf(f) && take(OPP[front.props.facing])) {
        shape = front.props.facing === CCW[f] ? 'outer_left' : 'outer_right';
      } else {
        const back = nb(OPP[f]);
        if (isStairs(back) && back.props.half === half && axisOf(back.props.facing) !== axisOf(f) && take(back.props.facing)) {
          shape = back.props.facing === CCW[f] ? 'inner_left' : 'inner_right';
        }
      }
      patch = { shape };
    } else if (s === 'redstone_wire') {
      patch = {};
      const aboveConductor = nb('up').opaque;
      const connects = (n: BlockInfo, d: string) => n.short === 'redstone_wire' || n.short === 'redstone_block'
        || (n.short === 'repeater' && axisOf(n.props.facing ?? 'north') === axisOf(d))
        || (n.short === 'observer' ? n.props.facing === d : n.signal);
      for (const d of H) {
        const o = OFF[d], n = nb(d);
        if (!aboveConductor && n.opaque && at(x + o[0], y + 1, z + o[2]).short === 'redstone_wire') patch[d] = 'up';
        else if (connects(n, d)) patch[d] = 'side';
        else if (!n.opaque && at(x + o[0], y - 1, z + o[2]).short === 'redstone_wire') patch[d] = 'side';
        else patch[d] = 'none';
      }
      const on = H.filter((d) => patch![d] !== 'none');
      if (on.length === 0) for (const d of H) patch[d] = 'side';
      else if (on.length === 1 && patch[OPP[on[0]]] === 'none') patch[OPP[on[0]]] = 'side';
    }
    if (!patch) continue;
    const next = world.withProps(id, patch);
    if (next !== id) out.push({ x, y, z, id: next });
  }
  return out;
}
