import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const load = (p) => server.ssrLoadModule(p);
const { World } = await load('/src/world/world.ts');
const fmt = await load('/src/formats/index.ts');
test.after(() => server.close());

function sampleWorld() {
  const w = new World();
  const states = [
    w.state('stone'),
    w.state('oak_stairs', { facing: 'east', half: 'top', shape: 'outer_left', waterlogged: 'false' }),
    w.state('wheat', { age: '5' }),
    w.state('water', { level: '0' }),
    w.state('redstone_wire', { north: 'side', south: 'up', east: 'none', west: 'none', power: '7' }),
  ];
  // Enough distinct states to force > 4 bits per entry and long-boundary crossings.
  for (let i = 0; i < 40; i++) states.push(w.state('sea_pickle', { pickles: String((i % 4) + 1), waterlogged: i % 2 ? 'true' : 'false', marker: String(i) }));
  let n = 0;
  for (let x = -3; x < 9; x++) for (let y = 2; y < 9; y++) for (let z = -5; z < 4; z++) {
    if ((x * 7 + y * 13 + z * 3) % 5 === 0) continue;
    w.setRaw(x, y, z, states[(n++ * 31) % states.length]);
  }
  w.finishBulk();
  return w;
}

function assertSame(a, b) {
  const ba = a.bounds(), bb = b.bounds();
  const off = [bb.min[0] - ba.min[0], bb.min[1] - ba.min[1], bb.min[2] - ba.min[2]];
  assert.deepEqual([ba.max[0] - ba.min[0], ba.max[1] - ba.min[1], ba.max[2] - ba.min[2]], [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]]);
  let checked = 0;
  a.forEach((x, y, z, id) => {
    const got = b.get(x + off[0], y + off[1], z + off[2]);
    assert.equal(b.palette[got].key, a.palette[id].key, `block at ${x},${y},${z}`);
    checked++;
  });
  assert.equal(checked, b.blockCount());
}

const opts = { name: 'Test', author: 'litecraft', description: 'round trip', dataVersion: fmt.DEFAULT_DATA_VERSION };

test('litematic round trip', async () => {
  const w = sampleWorld();
  const bytes = await fmt.exportLitematic(w, opts);
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/roundtrip.litematic', bytes);
  const w2 = new World();
  const res = await fmt.importFile(bytes, 'x.litematic', w2);
  assert.equal(res.format, 'litematic');
  assert.equal(res.dataVersion, fmt.DEFAULT_DATA_VERSION);
  assert.equal(res.blocks, w.blockCount());
  assertSame(w, w2);
});

test('schem round trip', async () => {
  const w = sampleWorld();
  const bytes = await fmt.exportSchem(w, opts);
  fs.writeFileSync('tmp/roundtrip.schem', bytes);
  const w2 = new World();
  const res = await fmt.importFile(bytes, 'x.schem', w2);
  assert.equal(res.format, 'schem');
  assertSame(w, w2);
});

test('old names are upgraded and downgraded', async () => {
  const w = new World();
  w.setRaw(0, 0, 0, w.state('iron_chain', { axis: 'y', waterlogged: 'false' }));
  w.finishBulk();
  const bytes = await fmt.exportLitematic(w, { ...opts, dataVersion: 4189 });
  const w2 = new World();
  await fmt.importFile(bytes, 'old.litematic', w2);
  assert.equal(w2.palette[w2.get(0, 0, 0)].name, 'minecraft:iron_chain');
});
