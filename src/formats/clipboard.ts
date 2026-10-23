// Generic structure exchange via the clipboard (JSON). Other tools (e.g. the note block generator) paste the same format.
import type { Change } from '../editor/placement';
import type { World } from '../world/world';

export const CLIP_FORMAT = 'litecraft-structure';
const MAX_BLOCKS = 4_000_000;

type Vec3 = [number, number, number];
export interface NoteScheduleEntry { tick: number; pos: Vec3; instrument: string; note: number }
export interface NoteblockMeta { title?: string; bpm?: number; tick_seconds?: number; start_button?: Vec3; schedule?: NoteScheduleEntry[] }

export interface ClipStructure {
  format: typeof CLIP_FORMAT;
  version: 1;
  name: string;
  size: Vec3;
  palette: string[];
  blocks: [number, number, number, number][];
  noteblock?: NoteblockMeta;
}

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isInt);

/** Parses and validates clipboard text. Throws with a German message if it is not a LiteCraft structure. */
export function parseClip(text: string): ClipStructure {
  let d: Record<string, unknown>;
  try { d = JSON.parse(text.trim()); } catch { throw new Error('Kein gültiges JSON in der Zwischenablage.'); }
  if (!d || typeof d !== 'object' || d.format !== CLIP_FORMAT) throw new Error('Die Zwischenablage enthält keine LiteCraft-Struktur.');
  if (d.version !== 1) throw new Error(`Strukturformat-Version ${String(d.version)} wird nicht unterstützt.`);
  const palette = d.palette, blocks = d.blocks;
  if (!Array.isArray(palette) || !palette.every((p) => typeof p === 'string' && p.length > 0)) throw new Error('Ungültige Palette.');
  if (!Array.isArray(blocks) || blocks.length > MAX_BLOCKS) throw new Error('Ungültige Blockliste.');
  for (const b of blocks) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every(isInt) || b[3] < 0 || b[3] >= palette.length) throw new Error('Ungültiger Block-Eintrag.');
  }
  const out: ClipStructure = { format: CLIP_FORMAT, version: 1, name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : 'Eingefügt', size: [0, 0, 0], palette, blocks };
  if (isVec(d.size)) out.size = d.size;
  else for (const b of blocks as number[][]) for (let a = 0; a < 3; a++) out.size[a] = Math.max(out.size[a], b[a] + 1);
  const nb = d.noteblock as NoteblockMeta | undefined;
  if (nb && typeof nb === 'object') {
    out.noteblock = {
      ...nb,
      start_button: isVec(nb.start_button) ? nb.start_button : undefined,
      schedule: Array.isArray(nb.schedule) ? nb.schedule.filter((s) => s && isInt(s.tick) && isVec(s.pos)) : undefined,
    };
  }
  return out;
}

/** Changes that place the structure with its local origin at `origin`. */
export function clipChanges(world: World, clip: ClipStructure, origin: Vec3): Change[] {
  const ids = clip.palette.map((key) => world.stateFromKey(key));
  return clip.blocks.map(([x, y, z, i]) => ({ x: origin[0] + x, y: origin[1] + y, z: origin[2] + z, id: ids[i] }));
}

/** Note block metadata moved into world coordinates. */
export function shiftNoteblock(nb: NoteblockMeta, o: Vec3): NoteblockMeta {
  const add = (p: Vec3): Vec3 => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  return { ...nb, start_button: nb.start_button && add(nb.start_button), schedule: nb.schedule?.map((s) => ({ ...s, pos: add(s.pos) })) };
}

/** Serializes the blocks inside [min, max] (relative to min). */
export function clipFromWorld(world: World, min: Vec3, max: Vec3, name: string): ClipStructure {
  const palette: string[] = [], index = new Map<number, number>();
  const blocks: [number, number, number, number][] = [];
  for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) for (let x = min[0]; x <= max[0]; x++) {
    const id = world.get(x, y, z);
    if (!id) continue;
    let i = index.get(id);
    if (i === undefined) { i = palette.length; index.set(id, i); palette.push(world.palette[id].key); }
    blocks.push([x - min[0], y - min[1], z - min[2], i]);
  }
  return { format: CLIP_FORMAT, version: 1, name, size: [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1], palette, blocks };
}

export const clipToText = (c: ClipStructure) => JSON.stringify(c);
