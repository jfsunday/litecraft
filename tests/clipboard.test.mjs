import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const load = (p) => server.ssrLoadModule(p);
const { World } = await load('/src/world/world.ts');
const clip = await load('/src/formats/clipboard.ts');
const fmt = await load('/src/formats/index.ts');
test.after(() => server.close());

const fixtureText = fs.readFileSync(new URL('./fixtures/final-countdown-riff_litecraft.json', import.meta.url), 'utf8');

function paste(c, origin) {
  const w = new World();
  for (const ch of clip.clipChanges(w, c, origin)) w.setRaw(ch.x, ch.y, ch.z, ch.id);
  w.finishBulk();
  return w;
}

test('parses the note block generator format', () => {
  const c = clip.parseClip(fixtureText);
  assert.equal(c.name, 'Notenblock: Final Countdown (Riff)');
  assert.deepEqual(c.size, [162, 3, 23]);
  assert.equal(c.palette.length, 41);
  assert.equal(c.blocks.length, 1899);
  assert.equal(c.noteblock.schedule.length, 267);
  assert.deepEqual(c.noteblock.start_button, [0, 2, 0]);
});

test('paste places all blocks like the .schem import', async () => {
  const w = paste(clip.parseClip(fixtureText), [10, -3, 4]);
  assert.equal(w.blockCount(), 1899);
  assert.deepEqual(w.bounds(), { min: [10, -3, 4], max: [171, -1, 26] });
  const ref = new World();
  await fmt.importFile(new Uint8Array(fs.readFileSync(new URL('./fixtures/final-countdown-riff.schem', import.meta.url))), 'x.schem', ref);
  assert.equal(ref.blockCount(), 1899);
  const o = ref.bounds().min;
  ref.forEach((x, y, z, id) => assert.equal(w.palette[w.get(x - o[0] + 10, y - o[1] - 3, z - o[2] + 4)].key, ref.palette[id].key));
  const btn = w.palette[w.get(10, -1, 4)];
  assert.equal(btn.short, 'stone_button');
  const nb = clip.shiftNoteblock(clip.parseClip(fixtureText).noteblock, [10, -3, 4]);
  assert.deepEqual(nb.start_button, [10, -1, 4]);
  for (const s of nb.schedule) assert.equal(w.palette[w.get(...s.pos)].short, 'note_block');
});

test('copy → paste round trip', () => {
  const w = paste(clip.parseClip(fixtureText), [0, 0, 0]);
  w.setRaw(3, 5, 3, w.state('oak_stairs', { facing: 'east', half: 'top', shape: 'outer_left', waterlogged: 'false' }));
  w.finishBulk();
  const b = w.bounds();
  const text = clip.clipToText(clip.clipFromWorld(w, b.min, b.max, 'Kopie'));
  const c = clip.parseClip(text);
  assert.equal(c.name, 'Kopie');
  assert.deepEqual(c.size, [162, 6, 23]);
  const w2 = paste(c, [-50, 70, 9]);
  assert.equal(w2.blockCount(), w.blockCount());
  w.forEach((x, y, z, id) => assert.equal(w2.palette[w2.get(x - 50, y + 70, z + 9)].key, w.palette[id].key));
});

test('rejects foreign clipboard content', () => {
  assert.throws(() => clip.parseClip('hallo'), /JSON/);
  assert.throws(() => clip.parseClip('{"format":"other"}'), /keine LiteCraft-Struktur/);
  assert.throws(() => clip.parseClip('{"format":"litecraft-structure","version":2,"palette":[],"blocks":[]}'), /Version/);
  assert.throws(() => clip.parseClip('{"format":"litecraft-structure","version":1,"palette":["minecraft:stone"],"blocks":[[0,0,0,1]]}'), /Block-Eintrag/);
});
