import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const load = (p) => server.ssrLoadModule(p);
const { World } = await load('/src/world/world.ts');
const { BlockRegistry } = await load('/src/blocks/info.ts');
const { RedstoneSim } = await load('/src/sim/redstone.ts');
const clip = await load('/src/formats/clipboard.ts');
test.after(() => server.close());

const fixture = fs.readFileSync(new URL('./fixtures/final-countdown-riff_litecraft.json', import.meta.url), 'utf8');

function build(blocks) {
  const w = new World();
  for (const [x, y, z, key] of blocks) w.setRaw(x, y, z, w.stateFromKey(key));
  w.finishBulk();
  return { w, sim: new RedstoneSim(w, new BlockRegistry(w)) };
}

function run(sim, maxTicks = 3000) {
  const events = [];
  for (let i = 0; i < maxTicks && !sim.idle; i++) events.push(...sim.step());
  return events;
}

const fmt = (e) => `${e.tick}|${e.x},${e.y},${e.z}|${e.instrument}|${e.note}`;

test('note block song: start button triggers exactly the generator schedule', () => {
  const c = clip.parseClip(fixture);
  const origin = [5, 64, -7];
  const w = new World();
  for (const ch of clip.clipChanges(w, c, origin)) w.setRaw(ch.x, ch.y, ch.z, ch.id);
  w.finishBulk();
  const version = w.version;
  const nb = clip.shiftNoteblock(c.noteblock, origin);
  const sim = new RedstoneSim(w, new BlockRegistry(w));
  assert.equal(sim.noteBlocks, 267);
  const first = sim.press(...nb.start_button);
  assert.ok(first, 'start button is pressable');
  const events = [...first, ...run(sim)];
  assert.ok(sim.idle, 'circuit settles');
  const want = nb.schedule.map((s) => fmt({ tick: s.tick, x: s.pos[0], y: s.pos[1], z: s.pos[2], instrument: s.instrument, note: s.note })).sort();
  const got = events.map(fmt).sort();
  assert.equal(want.length, 267);
  assert.deepEqual(got, want);
  assert.equal(w.version, version, 'simulation does not touch the world');
});

test('timing comes from the circuit: one slower repeater shifts the notes behind it', () => {
  const c = clip.parseClip(fixture);
  const w = new World();
  for (const ch of clip.clipChanges(w, c, [0, 0, 0])) w.setRaw(ch.x, ch.y, ch.z, ch.id);
  const [x, y, z] = c.blocks.find((b) => c.palette[b[3]].includes('repeater[delay=2,facing=west')).slice(0, 3);
  w.setRaw(x, y, z, w.stateFromKey('minecraft:repeater[delay=3,facing=west,locked=false,powered=false]'));
  w.finishBulk();
  const sim = new RedstoneSim(w, new BlockRegistry(w));
  const events = [...sim.press(...c.noteblock.start_button), ...run(sim)];
  assert.equal(events.length, 267);
  const late = c.noteblock.schedule.filter((s) => s.pos[2] === z + 1 || s.pos[2] === z - 1).filter((s) => s.pos[0] > x);
  assert.ok(late.length > 10);
  for (const s of late) assert.ok(events.some((e) => e.x === s.pos[0] && e.z === s.pos[2] && e.tick === s.tick + 1), `note at ${s.pos} delayed by one tick`);
});

test('dust line pointing into a note block plays it at once', () => {
  const { sim } = build([
    [0, 0, 0, 'stone'], [0, 1, 0, 'stone_button[face=floor,facing=north,powered=false]'],
    ...[1, 2, 3].map((x) => [x, 0, 0, 'redstone_wire[east=side,north=none,south=none,west=side,power=0]']),
    [4, 0, 0, 'note_block[instrument=harp,note=3,powered=false]'],
    [0, 0, 5, 'note_block[instrument=bell,note=7,powered=false]'],
  ]);
  const ev = sim.press(0, 1, 0);
  assert.deepEqual(ev.map(fmt), ['0|4,0,0|harp|3']);
  assert.deepEqual(run(sim), []);
  assert.equal(sim.tick, 10, 'stone button releases after 10 redstone ticks');
});

test('repeater delay, pulse extension and locking', () => {
  const base = [
    [0, 0, 0, 'stone'], [0, 1, 0, 'stone_button[face=floor,facing=north,powered=false]'],
    [1, 0, 0, 'repeater[delay=3,facing=west,locked=false,powered=false]'],
    [2, 0, 0, 'note_block[instrument=harp,note=0,powered=false]'],
  ];
  const free = build(base).sim;
  free.press(0, 1, 0);
  assert.deepEqual(run(free).map(fmt), ['3|2,0,0|harp|0']);

  // A powered side repeater locks the main repeater.
  const locked = build([...base,
    [1, 0, 2, 'redstone_block'], [1, 0, 1, 'repeater[delay=1,facing=south,locked=false,powered=true]']]).sim;
  locked.press(0, 1, 0);
  assert.deepEqual(run(locked), []);
});

test('torch inverter and lever', () => {
  const { sim } = build([
    [0, 0, 0, 'lever[face=floor,facing=north,powered=false]'], [0, -1, 0, 'stone'],
    [1, -1, 0, 'redstone_wall_torch[facing=east,lit=true]'],
    [2, -1, 0, 'note_block[instrument=bass,note=12,powered=false]'],
  ]);
  // Initially the lit torch powers the note block (settled before any interaction, no event).
  assert.deepEqual(sim.press(0, 0, 0), []);
  assert.deepEqual(run(sim), [], 'torch turns off after 1 tick');
  sim.press(0, 0, 0);
  assert.deepEqual(run(sim).map(fmt), ['2|2,-1,0|bass|12']);
});
