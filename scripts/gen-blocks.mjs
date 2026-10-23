// Generates src/data/blocks.json from minecraft-data (block list, states, light, collision shapes).
// Usage: MCDATA=/path/to/node_modules/minecraft-data node scripts/gen-blocks.mjs [mcVersion]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mcdata = process.env.MCDATA ?? path.resolve(root, '../mc-companion/node_modules/minecraft-data');
const version = process.argv[2] ?? '26.1';
const dataDir = path.join(mcdata, 'minecraft-data/data');
const paths = JSON.parse(fs.readFileSync(path.join(dataDir, 'dataPaths.json'), 'utf8')).pc[version];
if (!paths) throw new Error(`minecraft-data has no pc/${version}`);

const read = (key, file) => JSON.parse(fs.readFileSync(path.join(dataDir, paths[key], file), 'utf8'));
const blocks = read('blocks', 'blocks.json');
const collision = read('blockCollisionShapes', 'blockCollisionShapes.json');
const protocol = JSON.parse(fs.readFileSync(path.join(dataDir, 'pc/common/protocolVersions.json'), 'utf8'));
const dataVersion = protocol.find((p) => p.minecraftVersion === version)?.dataVersion ?? 0;

const shapeIndex = new Map();
const shapes = [];
const q = (v) => Math.round(v * 16 * 1000) / 1000;
function shapeRef(id) {
  if (shapeIndex.has(id)) return shapeIndex.get(id);
  const boxes = (collision.shapes[String(id)] ?? []).map((b) => b.map(q));
  const key = JSON.stringify(boxes);
  let idx = shapes.findIndex((s) => JSON.stringify(s) === key);
  if (idx < 0) { idx = shapes.length; shapes.push(boxes); }
  shapeIndex.set(id, idx);
  return idx;
}

const out = [];
for (const b of blocks) {
  const props = b.states.map((s) => [
    s.name,
    s.type === 'bool' ? ['true', 'false'] : (s.values ?? Array.from({ length: s.num_values }, (_, i) => String(i))),
  ]);
  const raw = collision.blocks[b.name];
  let shape;
  if (raw === undefined) shape = shapeRef(-1);
  else if (typeof raw === 'number') shape = shapeRef(raw);
  else {
    const refs = raw.map(shapeRef);
    shape = refs.every((r) => r === refs[0]) ? refs[0] : refs;
  }
  out.push([b.name, b.displayName, props, b.defaultState - b.minStateId, b.emitLight, b.filterLight, b.transparent ? 1 : 0, shape]);
}

const json = JSON.stringify({ v: version, dv: dataVersion, shapes, blocks: out });
const dest = path.join(root, 'src/data/blocks.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, json);
console.log(`wrote ${out.length} blocks, ${shapes.length} shapes, ${(json.length / 1024).toFixed(0)} KiB -> ${path.relative(root, dest)} (MC ${version}, data ${dataVersion})`);
