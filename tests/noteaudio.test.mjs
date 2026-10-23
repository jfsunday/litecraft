import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const audio = await server.ssrLoadModule('/src/sim/noteaudio.ts');
test.after(() => server.close());

// Uses the local launcher assets if present (they are never copied into the repo).
const assets = path.join(os.homedir(), '.local/share/PrismLauncher/assets');

test('reads only the 16 note block sounds from a picked assets folder', { skip: !fs.existsSync(path.join(assets, 'indexes')) && 'no local Minecraft assets' }, async () => {
  let reads = 0;
  const fake = (rel) => {
    const full = path.join(assets, rel);
    return {
      name: path.basename(rel), webkitRelativePath: `assets/${rel}`, lastModified: fs.statSync(full).mtimeMs,
      arrayBuffer: async () => { reads++; return new Uint8Array(fs.readFileSync(full)).buffer; },
      text: async () => fs.readFileSync(full, 'utf8'),
    };
  };
  const files = fs.readdirSync(path.join(assets, 'indexes')).map((f) => fake(`indexes/${f}`));
  for (const d of fs.readdirSync(path.join(assets, 'objects'))) for (const f of fs.readdirSync(path.join(assets, 'objects', d))) files.push(fake(`objects/${d}/${f}`));
  const got = await audio.soundsFromFolder(files);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(audio.NOTE_FILES).sort());
  assert.equal(reads, 16);
  for (const bytes of Object.values(got)) assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'OggS');
});
