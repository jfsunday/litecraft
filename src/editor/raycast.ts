import type { BlockInfo, BlockRegistry } from '../blocks/info';
import type { Box16 } from '../blocks/data';
import type { World } from '../world/world';

export interface Hit {
  x: number; y: number; z: number;
  face: number;                       // dir index of the face that was hit (points towards the viewer)
  point: [number, number, number];
  floor: boolean;                     // hit the virtual ground plane
  id: number;
}

export const FACE_NORMALS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function pickBoxes(info: BlockInfo): Box16[] {
  if (info.air || info.invisible) return [];
  if (info.shape.length) return info.shape;
  const s = info.short;
  if (s === 'water' || s === 'lava' || s === 'bubble_column') return [];
  if (/rail$|redstone_wire|_carpet$|pressure_plate|lily_pad|pink_petals|leaf_litter|wildflowers|tripwire$|snow$/.test(s)) return [[0, 0, 0, 16, 2, 16]];
  if (/torch/.test(s)) return [[5, 0, 5, 11, 11, 11]];
  if (/_button$/.test(s)) return [[4, 4, 4, 12, 12, 12]];
  return [[2, 0, 2, 14, 14, 14]];
}

function rayBox(o: number[], d: number[], min: number[], max: number[]): { t: number; face: number } | null {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    let t1 = (min[a] - o[a]) / d[a], t2 = (max[a] - o[a]) / d[a];
    const f = d[a] > 0 ? a * 2 + 1 : a * 2; // entering through the face opposite to the ray direction
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; face = f; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), face: face < 0 ? 2 : face };
}

export function raycast(
  world: World, reg: BlockRegistry, origin: number[], dir: number[], maxDist: number,
  visible: (x: number, y: number, z: number) => boolean, floorY: number | null,
): Hit | null {
  let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
  const step = dir.map((v) => (v > 0 ? 1 : -1));
  const tDelta = dir.map((v) => (v !== 0 ? Math.abs(1 / v) : Infinity));
  const tMax = [0, 1, 2].map((a) => {
    const c = [x, y, z][a];
    if (dir[a] > 0) return (c + 1 - origin[a]) / dir[a];
    if (dir[a] < 0) return (origin[a] - c) / -dir[a];
    return Infinity;
  });
  let t = 0;
  for (let i = 0; i < 2048 && t <= maxDist; i++) {
    const id = world.get(x, y, z);
    if (id && visible(x, y, z)) {
      const boxes = pickBoxes(reg.info(id));
      let best: { t: number; face: number } | null = null;
      for (const b of boxes) {
        const r = rayBox(origin, dir, [x + b[0] / 16, y + b[1] / 16, z + b[2] / 16], [x + b[3] / 16, y + b[4] / 16, z + b[5] / 16]);
        if (r && (!best || r.t < best.t)) best = r;
      }
      if (best) {
        const p: [number, number, number] = [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t];
        return { x, y, z, face: best.face, point: p, floor: false, id };
      }
    }
    if (tMax[0] < tMax[1] && tMax[0] < tMax[2]) { x += step[0]; t = tMax[0]; tMax[0] += tDelta[0]; }
    else if (tMax[1] < tMax[2]) { y += step[1]; t = tMax[1]; tMax[1] += tDelta[1]; }
    else { z += step[2]; t = tMax[2]; tMax[2] += tDelta[2]; }
  }
  if (floorY !== null && dir[1] < 0 && origin[1] > floorY) {
    const tf = (floorY - origin[1]) / dir[1];
    if (tf <= maxDist * 2) {
      const p: [number, number, number] = [origin[0] + dir[0] * tf, floorY, origin[2] + dir[2] * tf];
      return { x: Math.floor(p[0]), y: floorY - 1, z: Math.floor(p[2]), face: 2, point: p, floor: true, id: 0 };
    }
  }
  return null;
}
