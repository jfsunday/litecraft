import { gunzip, isGzip, readNbt } from '../nbt/nbt';
import type { World } from '../world/world';
import type { ImportResult } from './common';
import { importLitematic } from './litematic';
import { importSchem } from './schem';
import { importStructure } from './structure';

export const IMPORT_ACCEPT = '.litematic,.schem,.schematic,.nbt';

/** Imports into an (already cleared) world. */
export async function importFile(data: Uint8Array, filename: string, world: World): Promise<ImportResult> {
  const bytes = isGzip(data) ? await gunzip(data) : data;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  let res: ImportResult;
  if (ext === 'litematic') res = importLitematic(bytes, world);
  else if (ext === 'schem' || ext === 'schematic') res = importSchem(bytes, world);
  else if (ext === 'nbt') res = importStructure(bytes, world);
  else {
    const { root } = readNbt(bytes);
    if (root.v.has('Regions')) res = importLitematic(bytes, world);
    else if (root.v.has('Schematic') || root.v.has('BlockData') || root.v.has('Palette')) res = importSchem(bytes, world);
    else res = importStructure(bytes, world);
  }
  const base = filename.replace(/\.[^.]+$/, '');
  world.meta = {
    ...world.meta,
    name: res.name || base || 'Import',
    author: res.author,
    description: res.description,
    source: res.format,
    dataVersion: res.dataVersion,
  };
  return res;
}

export { exportLitematic } from './litematic';
export { exportSchem } from './schem';
export * from './common';
