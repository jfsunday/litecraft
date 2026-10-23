import { comp, compounds, list, num, readNbt, tagNumber } from '../nbt/nbt';
import { posKey, type World } from '../world/world';
import { entityId, type ImportResult, paletteEntryToState } from './common';

// Vanilla structure block files (.nbt).
export function importStructure(bytes: Uint8Array, world: World): ImportResult {
  const { root } = readNbt(bytes);
  const dataVersion = num(root, 'DataVersion', 0);
  let palette = compounds(root, 'palette');
  if (!palette.length) {
    const first = list(root, 'palettes')[0];
    if (first?.t === 9) palette = first.v.filter((t) => t.t === 10) as typeof palette;
  }
  const blockList = compounds(root, 'blocks');
  if (!palette.length && !blockList.length) throw new Error('Keine Struktur-Datei (palette/blocks fehlt)');
  const ids = palette.map((p) => paletteEntryToState(world, p, dataVersion));
  let blocks = 0;
  for (const b of blockList) {
    const pos = list(b, 'pos').map((t) => tagNumber(t));
    const id = ids[num(b, 'state')] ?? 0;
    if (pos.length !== 3 || !id) continue;
    world.setRaw(pos[0], pos[1], pos[2], id);
    blocks++;
    const te = comp(b, 'nbt');
    if (te) world.blockEntities.set(posKey(pos[0], pos[1], pos[2]), te);
  }
  for (const e of compounds(root, 'entities')) {
    const p = list(e, 'pos').map((t) => tagNumber(t));
    const data = comp(e, 'nbt');
    if (p.length !== 3 || !data) continue;
    world.entities.push({ id: entityId(data), x: p[0], y: p[1], z: p[2], nbt: data });
  }
  world.finishBulk();
  const size = list(root, 'size').map((t) => tagNumber(t));
  return {
    format: 'nbt', name: '', author: '', description: '', dataVersion, regions: 1, blocks,
    size: [size[0] ?? 0, size[1] ?? 0, size[2] ?? 0],
  };
}
