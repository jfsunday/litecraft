import { comp, compounds, type Compound, gzip, list, nbt, num, readNbt, str, type Tag, tagNumber, writeNbt } from '../nbt/nbt';
import { posFromKey, posKey, type World } from '../world/world';
import { downgradeName, entityId, type ExportOptions, type ImportResult, upgradeName, withoutKeys } from './common';
import { makeKey, parseKey } from '../world/world';

// Sponge schematic v1/v2 (root named "Schematic") and v3 (root { Schematic: {...} }).
export function importSchem(bytes: Uint8Array, world: World): ImportResult {
  const { root } = readNbt(bytes);
  const c = comp(root, 'Schematic') ?? root;
  const version = num(c, 'Version', 2);
  const W = num(c, 'Width') & 0xffff, H = num(c, 'Height') & 0xffff, L = num(c, 'Length') & 0xffff;
  const dataVersion = num(c, 'DataVersion', 0);
  const container = version >= 3 ? comp(c, 'Blocks') : c;
  const palette = comp(container, 'Palette');
  const data = container?.v.get(version >= 3 ? 'Data' : 'BlockData');
  if (!palette || data?.t !== 7) throw new Error('Ungültige .schem-Datei (Palette/BlockData fehlt)');

  const ids: number[] = [];
  for (const [key, tag] of palette.v) {
    const { name, props } = parseKey(key);
    ids[tagNumber(tag)] = world.state(upgradeName(name, dataVersion), props);
  }
  const bytesArr = data.v;
  let p = 0, blocks = 0;
  const volume = W * H * L;
  for (let i = 0; i < volume && p < bytesArr.length; i++) {
    let v = 0, shift = 0, b: number;
    do {
      b = bytesArr[p++] & 0xff;
      v |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80 && shift < 35);
    const id = ids[v] ?? 0;
    if (!id) continue;
    const x = i % W, z = Math.floor(i / W) % L, y = Math.floor(i / (W * L));
    world.setRaw(x, y, z, id);
    blocks++;
  }

  for (const be of compounds(container, 'BlockEntities').concat(version === 1 ? compounds(c, 'TileEntities') : [])) {
    const pos = be.v.get('Pos');
    if (pos?.t !== 11 || pos.v.length < 3) continue;
    const inner = comp(be, 'Data');
    const data2 = inner ?? withoutKeys(be, ['Pos']);
    if (!data2.v.has('id')) data2.v.set('id', nbt.string(str(be, 'Id')));
    world.blockEntities.set(posKey(pos.v[0], pos.v[1], pos.v[2]), withoutKeys(data2, ['Pos', 'Id', 'x', 'y', 'z']));
  }
  for (const e of compounds(c, 'Entities')) {
    const p3 = list(e, 'Pos').map((t) => tagNumber(t));
    if (p3.length !== 3) continue;
    const inner = withoutKeys(comp(e, 'Data') ?? e, ['Pos', 'Id']);
    if (!inner.v.has('id')) inner.v.set('id', nbt.string(entityId(e)));
    world.entities.push({ id: entityId(e), x: p3[0], y: p3[1], z: p3[2], nbt: inner });
  }
  world.finishBulk();
  const meta = comp(c, 'Metadata');
  return {
    format: 'schem', name: str(meta, 'Name'), author: str(meta, 'Author'), description: '',
    dataVersion, regions: 1, blocks, size: [W, H, L],
  };
}

/** Sponge schematic v2 (readable by WorldEdit 7+, FAWE, Axiom, Amulet). */
export async function exportSchem(world: World, opts: ExportOptions): Promise<Uint8Array> {
  const b = world.bounds();
  if (!b) throw new Error('Die Struktur ist leer');
  const [x0, y0, z0] = b.min;
  const W = b.max[0] - x0 + 1, H = b.max[1] - y0 + 1, L = b.max[2] - z0 + 1;
  if (W > 65535 || H > 65535 || L > 65535) throw new Error('Struktur zu groß für .schem');
  const local = new Map<number, number>();
  const out: number[] = [];
  const keyFor = (id: number) => {
    if (id === 0) return 'minecraft:air';
    const e = world.palette[id];
    return makeKey(downgradeName(e.name, opts.dataVersion), e.props);
  };
  const palette = new Map<string, Tag>();
  for (let y = y0; y <= b.max[1]; y++)
    for (let z = z0; z <= b.max[2]; z++)
      for (let x = x0; x <= b.max[0]; x++) {
        const id = world.get(x, y, z);
        let v = local.get(id);
        if (v === undefined) {
          v = local.size;
          local.set(id, v);
          palette.set(keyFor(id), nbt.int(v));
        }
        while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
        out.push(v);
      }
  const blockEntities: Tag[] = [];
  for (const [k, te] of world.blockEntities) {
    const [x, y, z] = posFromKey(k);
    if (!world.get(x, y, z)) continue;
    const m = new Map<string, Tag>(te.v);
    m.delete('id');
    m.set('Pos', nbt.intArray(Int32Array.of(x - x0, y - y0, z - z0)));
    m.set('Id', nbt.string(str(te, 'id', 'minecraft:chest')));
    blockEntities.push(nbt.compound(m));
  }
  const root: Compound = nbt.compound({
    Version: nbt.int(2),
    DataVersion: nbt.int(opts.dataVersion),
    Width: nbt.short(W << 16 >> 16),
    Height: nbt.short(H << 16 >> 16),
    Length: nbt.short(L << 16 >> 16),
    Offset: nbt.intArray(Int32Array.of(0, 0, 0)),
    Metadata: nbt.compound({ Name: nbt.string(opts.name), Author: nbt.string(opts.author) }),
    PaletteMax: nbt.int(palette.size),
    Palette: nbt.compound(palette),
    BlockData: { t: 7, v: Int8Array.from(out) },
    BlockEntities: nbt.list(10, blockEntities),
  });
  return gzip(writeNbt(root, 'Schematic'));
}
