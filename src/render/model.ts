// Minecraft-style block model baking: elements → quads (block-local coordinates 0..1).

export type FaceName = 'east' | 'west' | 'up' | 'down' | 'south' | 'north';
export const FACE_NAMES: FaceName[] = ['east', 'west', 'up', 'down', 'south', 'north'];
export const FACE_DIR: Record<string, number> = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };
const DIR_VEC: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export interface FaceSpec {
  uv?: number[];
  texture: string;
  cullface?: string;
  rotation?: number;
  tintindex?: number;
}

export interface ElementSpec {
  from: number[];
  to: number[];
  rotation?: { origin?: number[]; axis?: 'x' | 'y' | 'z'; angle?: number; rescale?: boolean; x?: number; y?: number; z?: number };
  shade?: boolean;
  shade_direction_override?: string;
  light_emission?: number;
  faces: Partial<Record<FaceName, FaceSpec>>;
}

export interface PartSpec {
  elements: ElementSpec[];
  x?: number;
  y?: number;
  uvlock?: boolean;
  ao?: boolean;
}

export interface BakedQuad {
  pos: number[];      // 4 vertices × xyz, 0..1, CCW seen from outside
  uv: number[];       // 4 × uv, GL convention (v up), 0..1
  tex: string;
  tint: number;       // tintindex (-1 none)
  dir: number;        // shading/AO direction
  cull: number;       // cull direction or -1
  shade: boolean;
  emission: number;
  ao: boolean;
  flush: boolean;     // axis aligned and on the block boundary of `dir`
  aligned: boolean;
}

type V3 = [number, number, number];

function corners(face: FaceName, f: number[], t: number[]): V3[] {
  const [x1, y1, z1] = f, [x2, y2, z2] = t;
  switch (face) {
    case 'north': return [[x2, y1, z1], [x1, y1, z1], [x1, y2, z1], [x2, y2, z1]];
    case 'south': return [[x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2]];
    case 'west': return [[x1, y1, z1], [x1, y1, z2], [x1, y2, z2], [x1, y2, z1]];
    case 'east': return [[x2, y1, z2], [x2, y1, z1], [x2, y2, z1], [x2, y2, z2]];
    case 'up': return [[x1, y2, z2], [x2, y2, z2], [x2, y2, z1], [x1, y2, z1]];
    case 'down': return [[x1, y1, z1], [x2, y1, z1], [x2, y1, z2], [x1, y1, z2]];
  }
}

/** Per-vertex Minecraft UV (0..16, v down) derived from a position on a face. */
function autoUV(dir: number, p: V3): [number, number] {
  switch (dir) {
    case 3: return [p[0], 16 - p[2]];
    case 2: return [p[0], p[2]];
    case 5: return [16 - p[0], 16 - p[1]];
    case 4: return [p[0], 16 - p[1]];
    case 1: return [p[2], 16 - p[1]];
    default: return [16 - p[2], 16 - p[1]];
  }
}

function rotateAxis(p: V3, axis: 'x' | 'y' | 'z', deg: number, o: number[]): V3 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
  if (axis === 'x') return [x + o[0], y * c - z * s + o[1], y * s + z * c + o[2]];
  if (axis === 'y') return [x * c + z * s + o[0], y + o[1], -x * s + z * c + o[2]];
  return [x * c - y * s + o[0], x * s + y * c + o[1], z + o[2]];
}

function elementTransform(e: ElementSpec): (p: V3) => V3 {
  const r = e.rotation;
  if (!r) return (p) => p;
  const o = r.origin ?? [8, 8, 8];
  if (r.axis && r.angle) {
    const axis = r.axis, angle = r.angle;
    const k = r.rescale ? 1 / Math.cos((Math.abs(angle) * Math.PI) / 180) : 1;
    return (p) => {
      const q = rotateAxis(p, axis, angle, o);
      if (k === 1) return q;
      return [axis === 'x' ? q[0] : o[0] + (q[0] - o[0]) * k, axis === 'y' ? q[1] : o[1] + (q[1] - o[1]) * k, axis === 'z' ? q[2] : o[2] + (q[2] - o[2]) * k];
    };
  }
  if (r.x || r.y || r.z) {
    return (p) => {
      let q = p;
      if (r.x) q = rotateAxis(q, 'x', r.x, o);
      if (r.y) q = rotateAxis(q, 'y', r.y, o);
      if (r.z) q = rotateAxis(q, 'z', r.z, o);
      return q;
    };
  }
  return (p) => p;
}

/** Blockstate variant rotation: x first, then y, both clockwise in Minecraft's sense. */
function variantTransform(xr: number, yr: number): (p: V3) => V3 {
  const xs = ((xr % 360) + 360) % 360, ys = ((yr % 360) + 360) % 360;
  if (!xs && !ys) return (p) => p;
  const c = [8, 8, 8];
  return (p) => {
    let q = p;
    if (xs) q = rotateAxis(q, 'x', -xs, c);
    if (ys) q = rotateAxis(q, 'y', -ys, c);
    return q;
  };
}

function nearestDir(v: V3): { dir: number; aligned: boolean } {
  let best = 0, bestDot = -Infinity;
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  for (let d = 0; d < 6; d++) {
    const dot = (v[0] * DIR_VEC[d][0] + v[1] * DIR_VEC[d][1] + v[2] * DIR_VEC[d][2]) / len;
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return { dir: best, aligned: bestDot > 0.999 };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

export function bake(parts: PartSpec[]): BakedQuad[] {
  const out: BakedQuad[] = [];
  const planes = new Map<string, number>();
  for (const part of parts) {
    const vt = variantTransform(part.x ?? 0, part.y ?? 0);
    const rotated = !!((part.x ?? 0) % 360 || (part.y ?? 0) % 360);
    for (const el of part.elements) {
      const et = elementTransform(el);
      for (const face of FACE_NAMES) {
        const fs = el.faces[face];
        if (!fs) continue;
        const cs = corners(face, el.from, el.to);
        let uvs: [number, number][];
        if (fs.uv && fs.uv.length >= 4) {
          const [u1, v1, u2, v2] = fs.uv;
          uvs = [[u1, v2], [u2, v2], [u2, v1], [u1, v1]];
        } else uvs = cs.map((p) => autoUV(FACE_DIR[face], p));
        const rot = (((fs.rotation ?? 0) % 360) + 360) % 360 / 90;
        if (rot) uvs = uvs.map((_, i) => uvs[(i + rot) % 4]);

        const ps = cs.map((p) => vt(et(p)));
        const e1: V3 = [ps[1][0] - ps[0][0], ps[1][1] - ps[0][1], ps[1][2] - ps[0][2]];
        const e2: V3 = [ps[2][0] - ps[0][0], ps[2][1] - ps[0][1], ps[2][2] - ps[0][2]];
        const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (!n[0] && !n[1] && !n[2]) {
          // Degenerate (zero-area) faces are skipped; flat planes still have area on the other two axes.
          const e3: V3 = [ps[3][0] - ps[0][0], ps[3][1] - ps[0][1], ps[3][2] - ps[0][2]];
          const m: V3 = [e1[1] * e3[2] - e1[2] * e3[1], e1[2] * e3[0] - e1[0] * e3[2], e1[0] * e3[1] - e1[1] * e3[0]];
          if (!m[0] && !m[1] && !m[2]) continue;
        }
        const { dir, aligned } = nearestDir(n[0] || n[1] || n[2] ? n : DIR_VEC[FACE_DIR[face]]);
        if (part.uvlock && rotated && aligned) uvs = ps.map((p) => autoUV(dir, p));

        let cull = -1;
        if (fs.cullface && FACE_DIR[fs.cullface] !== undefined) {
          const cv = DIR_VEC[FACE_DIR[fs.cullface]];
          const moved = vt([8 + cv[0], 8 + cv[1], 8 + cv[2]]);
          cull = nearestDir([moved[0] - 8, moved[1] - 8, moved[2] - 8]).dir;
        }
        const axis = dir >> 1, positive = dir % 2 === 0;
        let flush = false;
        if (aligned) {
          const c = ps[0][axis];
          flush = ps.every((p) => Math.abs(p[axis] - c) < 1e-4) && Math.abs(c - (positive ? 16 : 0)) < 1e-4;
          // Coplanar overlays (e.g. grass side overlay) get pushed outwards a little to avoid z-fighting.
          const key = `${dir}:${round(c)}`;
          const count = planes.get(key) ?? 0;
          planes.set(key, count + 1);
          if (count > 0) {
            const off = count * 0.012 * (positive ? 1 : -1);
            for (const p of ps) p[axis] += off;
          }
        }
        const shadeDir = el.shade_direction_override ? FACE_DIR[el.shade_direction_override] ?? dir : dir;
        out.push({
          pos: ps.flatMap((p) => [p[0] / 16, p[1] / 16, p[2] / 16]),
          uv: uvs.flatMap(([u, v]) => [u / 16, 1 - v / 16]),
          tex: fs.texture,
          tint: fs.tintindex ?? -1,
          dir: shadeDir,
          cull,
          shade: el.shade !== false,
          emission: el.light_emission ?? 0,
          ao: part.ao !== false,
          flush,
          aligned,
        });
      }
    }
  }
  return out;
}

/** Helpers for procedural models. */
export function box(from: number[], to: number[], tex: string | Partial<Record<FaceName | 'side' | 'all' | 'end', string>>, opts: { cull?: boolean; tint?: number; faces?: FaceName[] } = {}): ElementSpec {
  const t = typeof tex === 'string' ? { all: tex } : tex;
  const faces: Partial<Record<FaceName, FaceSpec>> = {};
  for (const f of opts.faces ?? FACE_NAMES) {
    const texture = t[f] ?? ((f === 'up' || f === 'down') ? t.end : t.side) ?? t.side ?? t.all;
    if (!texture) continue;
    const onEdge = (f === 'east' && to[0] >= 16) || (f === 'west' && from[0] <= 0) || (f === 'up' && to[1] >= 16)
      || (f === 'down' && from[1] <= 0) || (f === 'south' && to[2] >= 16) || (f === 'north' && from[2] <= 0);
    faces[f] = { texture, cullface: opts.cull !== false && onEdge ? f : undefined, tintindex: opts.tint };
  }
  return { from, to, faces };
}
