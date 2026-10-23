import { comp, compounds, type Compound, gzip, list, nbt, num, readNbt, str, type Tag, tagNumber, writeNbt } from '../nbt/nbt';
import { posFromKey, posKey, type World } from '../world/world';
import { entityId, type ExportOptions, type ImportResult, paletteEntryToState, stateToPaletteEntry, withoutKeys } from './common';

const bitsFor = (paletteSize: number) => Math.max(2, 32 - Math.clz32(Math.max(1, paletteSize) - 1));

export function importLitematic(bytes: Uint8Array, world: World): ImportResult {
  const { root } = readNbt(bytes);
  const regions = comp(root, 'Regions');
  if (!regions) throw new Error('Keine Litematica-Datei (Regions fehlt)');
  const meta = comp(root, 'Metadata');
  const dataVersion = num(root, 'MinecraftDataVersion', 0);
  let blocks = 0;

  for (const [, regTag] of regions.v) {
    if (regTag.t !== 10) continue;
    const reg = regTag;
    const pos = comp(reg, 'Position'), size = comp(reg, 'Size');
    const sx = num(size, 'x'), sy = num(size, 'y'), sz = num(size, 'z');
    const ax = Math.abs(sx), ay = Math.abs(sy), az = Math.abs(sz);
    const ox = num(pos, 'x') + (sx < 0 ? sx + 1 : 0);
    const oy = num(pos, 'y') + (sy < 0 ? sy + 1 : 0);
    const oz = num(pos, 'z') + (sz < 0 ? sz + 1 : 0);

    const ids = compounds(reg, 'BlockStatePalette').map((p) => paletteEntryToState(world, p, dataVersion));
    const statesTag = reg.v.get('BlockStates');
    const volume = ax * ay * az;
    if (statesTag?.t === 12 && ids.length && volume > 0) {
      const words = statesTag.v;
      const bits = bitsFor(ids.length);
      const mask = (1 << bits) - 1;
      const layer = ax * az;
      for (let i = 0; i < volume; i++) {
        const bit = i * bits;
        const w = Math.floor(bit / 32), b = bit % 32;
        let v = words[w] >>> b;
        if (b + bits > 32) v |= words[w + 1] << (32 - b);
        v &= mask;
        const id = v < ids.length ? ids[v] : 0;
        if (!id) continue;
        const y = Math.floor(i / layer), r = i - y * layer;
        const z = Math.floor(r / ax), x = r - z * ax;
        world.setRaw(ox + x, oy + y, oz + z, id);
        blocks++;
      }
    }

    for (const te of compounds(reg, 'TileEntities')) {
      const x = ox + num(te, 'x'), y = oy + num(te, 'y'), z = oz + num(te, 'z');
      world.blockEntities.set(posKey(x, y, z), withoutKeys(te, ['x', 'y', 'z']));
    }
    for (const e of compounds(reg, 'Entities')) {
      const p = list(e, 'Pos').map((t) => tagNumber(t));
      if (p.length !== 3) continue;
      world.entities.push({ id: entityId(e), x: ox + p[0], y: oy + p[1], z: oz + p[2], nbt: e });
    }
  }

  world.finishBulk();
  const enc = comp(meta, 'EnclosingSize');
  return {
    format: 'litematic',
    name: str(meta, 'Name'),
    author: str(meta, 'Author'),
    description: str(meta, 'Description'),
    dataVersion,
    regions: regions.v.size,
    blocks,
    size: [Math.abs(num(enc, 'x')), Math.abs(num(enc, 'y')), Math.abs(num(enc, 'z'))],
  };
}

const xyz = (x: number, y: number, z: number) => nbt.compound({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) });

export async function exportLitematic(world: World, opts: ExportOptions): Promise<Uint8Array> {
  const b = world.bounds();
  if (!b) throw new Error('Die Struktur ist leer');
  const [x0, y0, z0] = b.min;
  const sx = b.max[0] - x0 + 1, sy = b.max[1] - y0 + 1, sz = b.max[2] - z0 + 1;
  const volume = sx * sy * sz;
  if (volume > 2 ** 31 / 16) throw new Error('Struktur zu groß für den Export');

  const local = new Map<number, number>([[0, 0]]);
  const paletteIds = [0];
  for (let y = y0; y <= b.max[1]; y++)
    for (let z = z0; z <= b.max[2]; z++)
      for (let x = x0; x <= b.max[0]; x++) {
        const id = world.get(x, y, z);
        if (!local.has(id)) { local.set(id, paletteIds.length); paletteIds.push(id); }
      }

  const bits = bitsFor(paletteIds.length);
  const longs = Math.ceil((volume * bits) / 64);
  const words = new Uint32Array(longs * 2);
  let i = 0, total = 0;
  for (let y = y0; y <= b.max[1]; y++)
    for (let z = z0; z <= b.max[2]; z++)
      for (let x = x0; x <= b.max[0]; x++, i++) {
        const id = world.get(x, y, z);
        if (!id) continue;
        total++;
        const v = local.get(id)!;
        const bit = i * bits;
        const w = Math.floor(bit / 32), o = bit % 32;
        words[w] |= v << o;
        if (o + bits > 32) words[w + 1] |= v >>> (32 - o);
      }

  const tiles: Tag[] = [];
  for (const [k, te] of world.blockEntities) {
    const [x, y, z] = posFromKey(k);
    if (!world.get(x, y, z)) continue;
    const m = new Map<string, Tag>(te.v);
    m.set('x', nbt.int(x - x0)); m.set('y', nbt.int(y - y0)); m.set('z', nbt.int(z - z0));
    tiles.push(nbt.compound(m));
  }
  const ents: Tag[] = world.entities.map((e) => {
    const m = new Map<string, Tag>(e.nbt.v);
    m.set('Pos', nbt.list(6, [nbt.double(e.x - x0), nbt.double(e.y - y0), nbt.double(e.z - z0)]));
    return nbt.compound(m);
  });

  const region: Compound = nbt.compound({
    Position: xyz(0, 0, 0),
    Size: xyz(sx, sy, sz),
    BlockStatePalette: nbt.list(10, paletteIds.map((id) => stateToPaletteEntry(world, id, opts.dataVersion))),
    BlockStates: nbt.longArray(words),
    TileEntities: nbt.list(10, tiles),
    Entities: nbt.list(10, ents),
    PendingBlockTicks: nbt.list(10, []),
    PendingFluidTicks: nbt.list(10, []),
  });
  const now = BigInt(Date.now());
  const root = nbt.compound({
    MinecraftDataVersion: nbt.int(opts.dataVersion),
    Version: nbt.int(opts.dataVersion >= 3837 ? 7 : 6),
    SubVersion: nbt.int(1),
    Metadata: nbt.compound({
      Name: nbt.string(opts.name),
      Author: nbt.string(opts.author),
      Description: nbt.string(opts.description),
      RegionCount: nbt.int(1),
      TotalVolume: nbt.int(volume),
      TotalBlocks: nbt.int(total),
      TimeCreated: nbt.long(BigInt(world.meta.created) || now),
      TimeModified: nbt.long(now),
      EnclosingSize: xyz(sx, sy, sz),
    }),
    Regions: nbt.compound({ [opts.name || 'Main']: region }),
  });
  return gzip(writeNbt(root));
}
