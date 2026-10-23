// Note block sounds: the official .ogg files (from Mojang, a local assets folder or a zip; cached in IndexedDB,
// never part of this repo) or a small Web Audio synth as fallback.
import { listZip, readEntry } from '../assets/zip';
import { idbDel, idbGet, idbSet } from '../util/idb';

export const NOTE_FILES: Record<string, string> = {
  harp: 'harp2', bass: 'bass', basedrum: 'bd', snare: 'snare', hat: 'hat', bell: 'bell', flute: 'flute', chime: 'icechime',
  guitar: 'guitar', xylophone: 'xylobone', iron_xylophone: 'iron_xylophone', cow_bell: 'cow_bell', didgeridoo: 'didgeridoo',
  bit: 'bit', banjo: 'banjo', pling: 'pling',
};
export const INSTRUMENT_COUNT = Object.keys(NOTE_FILES).length;
export type SoundFiles = Record<string, Uint8Array>;

const CACHE_KEY = 'note-sounds-v1';
const FAIL_KEY = 'litecraft-sounds-mojang-failed';
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = 'https://resources.download.minecraft.net/';
const assetPath = (inst: string) => `minecraft/sounds/note/${NOTE_FILES[inst]}.ogg`;

// Synth fallback: MIDI pitch at note 0 (F♯) and [waveform, decay s, overtone ratio, lowpass Hz]
const LOW: Record<string, number> = { harp: 54, bass: 30, didgeridoo: 30, guitar: 42, flute: 66, bell: 78, chime: 78, xylophone: 78, iron_xylophone: 54, cow_bell: 66, bit: 54, banjo: 54, pling: 54 };
const TIMBRE: Record<string, [OscillatorType, number, number, number]> = {
  harp: ['triangle', 0.9, 2, 0], bass: ['triangle', 0.5, 2, 900], didgeridoo: ['sawtooth', 0.7, 0, 500], guitar: ['sawtooth', 0.6, 0, 1800],
  flute: ['sine', 0.7, 2, 0], bell: ['sine', 1.8, 2.76, 0], chime: ['sine', 1.5, 4.07, 0], xylophone: ['sine', 0.35, 3.9, 0],
  iron_xylophone: ['triangle', 0.9, 4, 0], cow_bell: ['square', 0.35, 1.48, 2500], bit: ['square', 0.4, 0, 0], banjo: ['sawtooth', 0.45, 0, 3500], pling: ['sine', 1, 2, 0],
};

function hashesFrom(objects: Record<string, { hash?: string }> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const inst of Object.keys(NOTE_FILES)) { const h = objects?.[assetPath(inst)]?.hash; if (h) out[inst] = h; }
  return out;
}

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Hashes of the note block sounds in the latest release's asset index (piston-meta allows CORS). */
export async function mojangSoundHashes(signal?: AbortSignal): Promise<Record<string, string>> {
  const m = await json<{ latest: { release: string }; versions: { id: string; url: string }[] }>(MANIFEST, signal);
  const v = m.versions.find((x) => x.id === m.latest.release) ?? m.versions[0];
  const meta = await json<{ assetIndex: { url: string } }>(v.url, signal);
  return hashesFrom((await json<{ objects: Record<string, { hash: string }> }>(meta.assetIndex.url, signal)).objects);
}

/** Like the launcher: asset index via piston-meta, files from resources.download.minecraft.net. */
export async function soundsFromMojang(onProgress: (p: number) => void, signal?: AbortSignal): Promise<SoundFiles> {
  const hashes = Object.entries(await mojangSoundHashes(signal));
  onProgress(0.3);
  const files: SoundFiles = {};
  const get = async ([inst, h]: [string, string]) => {
    let r: Response;
    try { r = await fetch(`${RESOURCES}${h.slice(0, 2)}/${h}`, { signal }); } catch (e) {
      if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') throw e;
      throw new Error('Mojangs Download-Server erlaubt keinen Abruf aus dem Browser (CORS).');
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    files[inst] = new Uint8Array(await r.arrayBuffer());
    onProgress(0.3 + (0.7 * Object.keys(files).length) / hashes.length);
  };
  if (!hashes.length) throw new Error('Keine Notenblock-Sounds im Asset-Index gefunden.');
  await get(hashes[0]); // fail fast before firing the rest
  await Promise.all(hashes.slice(1).map(get));
  return files;
}

/** Reads only the note block sounds from a picked Minecraft `assets` folder (or any folder containing it). */
export async function soundsFromFolder(files: File[], onProgress: (p: number) => void = () => undefined): Promise<SoundFiles> {
  const objects = new Map<string, File>(), direct = new Map<string, File>(), indexes: File[] = [];
  for (const f of files) {
    const p = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const obj = /(?:^|\/)objects\/[0-9a-f]{2}\/([0-9a-f]{40})$/.exec(p);
    if (obj) objects.set(obj[1], f);
    else if (/(?:^|\/)indexes\/[^/]+\.json$/.test(p)) indexes.push(f);
    else { const m = /sounds\/note\/(\w+)\.ogg$/.exec(p); if (m) direct.set(m[1], f); }
  }
  const out: SoundFiles = {};
  const insts = Object.keys(NOTE_FILES);
  const take = async (inst: string, f: File | undefined) => {
    if (!f || out[inst]) return;
    out[inst] = new Uint8Array(await f.arrayBuffer());
    onProgress(Object.keys(out).length / insts.length);
  };
  for (const inst of insts) await take(inst, direct.get(NOTE_FILES[inst]));
  indexes.sort((a, b) => b.lastModified - a.lastModified);
  const fromHashes = async (h: Record<string, string>) => { for (const inst of insts) if (h[inst]) await take(inst, objects.get(h[inst])); };
  for (const ix of indexes) {
    if (insts.every((i) => out[i])) break;
    try { await fromHashes(hashesFrom((JSON.parse(await ix.text()) as { objects?: Record<string, { hash: string }> }).objects)); } catch { /* broken index */ }
  }
  if (objects.size && !insts.every((i) => out[i])) await fromHashes(await mojangSoundHashes().catch(() => ({})));
  return out;
}

/** Note block sounds from a resource pack / zip (`assets/minecraft/sounds/note/*.ogg`). */
export async function soundsFromZip(bytes: Uint8Array): Promise<SoundFiles> {
  const byFile = new Map(Object.entries(NOTE_FILES).map(([inst, file]) => [file, inst]));
  const out: SoundFiles = {};
  for (const e of listZip(bytes)) {
    const inst = byFile.get(/sounds\/note\/(\w+)\.ogg$/.exec(e.name)?.[1] ?? '');
    if (inst && !out[inst]) out[inst] = await readEntry(bytes, e);
  }
  return out;
}

export class NoteAudio {
  ctx: AudioContext | null = null;
  /** Where the original sounds came from; '' = synth fallback. */
  label = '';
  count = 0;
  private out: AudioNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private live = new Set<AudioScheduledSourceNode>();
  private noise: AudioBuffer | null = null;
  private prepared = false;

  /** Creates/resumes the AudioContext; call it inside a user gesture. */
  unlock(): AudioContext | null {
    if (!this.ctx) {
      if (typeof AudioContext === 'undefined') return null;
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0.45;
      gain.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
      this.ctx = ctx;
      this.out = gain;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Before the first play: cached sounds, else one try at Mojang (skipped for a week after it failed). */
  async prepare(onProgress: (p: number) => void) {
    if (this.prepared) return;
    this.prepared = true;
    const cached = await idbGet<{ label: string; files: SoundFiles }>(CACHE_KEY);
    if (cached?.files && (await this.use(cached.files, cached.label, false))) return;
    let failed = 0;
    try { failed = Number(localStorage.getItem(FAIL_KEY) ?? 0); } catch { /* ignore */ }
    if (Date.now() - failed < 7 * 86_400_000) return;
    await this.fromMojang(onProgress).catch(() => undefined);
  }

  async fromMojang(onProgress: (p: number) => void): Promise<number> {
    try {
      const n = await this.use(await soundsFromMojang(onProgress, AbortSignal.timeout(20_000)), 'Mojang');
      try { localStorage.removeItem(FAIL_KEY); } catch { /* ignore */ }
      return n;
    } catch (e) {
      try { localStorage.setItem(FAIL_KEY, String(Date.now())); } catch { /* ignore */ }
      throw e;
    }
  }

  /** Decodes the sounds (and caches the raw bytes). Returns how many instruments are available. */
  async use(files: SoundFiles, label: string, save = true): Promise<number> {
    const ctx = this.unlock();
    if (!ctx) return 0;
    const next = new Map<string, AudioBuffer>();
    for (const [inst, bytes] of Object.entries(files)) {
      try { next.set(inst, await ctx.decodeAudioData(bytes.slice().buffer)); } catch { /* not decodable */ }
    }
    if (!next.size) return 0;
    this.buffers = next;
    this.label = label;
    this.count = next.size;
    if (save) await idbSet(CACHE_KEY, { label, files });
    return next.size;
  }

  async forget() {
    this.buffers.clear();
    this.label = '';
    this.count = 0;
    await idbDel(CACHE_KEY);
  }

  /** Plays a note `delay` seconds from now (vanilla pitch: 2^((note−12)/12), same volume for all instruments). */
  play(inst: string, note: number, delay: number) {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    const t = ctx.currentTime + Math.max(0, delay);
    const buf = this.buffers.get(inst);
    if (buf) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = 2 ** ((note - 12) / 12);
      s.connect(out);
      this.start(s, t);
    } else this.synth(ctx, out, inst, note, t);
  }

  stopAll() {
    for (const s of this.live) try { s.stop(); } catch { /* not started */ }
    this.live.clear();
  }

  private start(s: AudioScheduledSourceNode, t: number, stop?: number) {
    s.start(t);
    if (stop) s.stop(stop);
    this.live.add(s);
    s.onended = () => this.live.delete(s);
  }

  private synth(ctx: AudioContext, out: AudioNode, inst: string, note: number, t: number) {
    const env = ctx.createGain();
    env.connect(out);
    const rate = 2 ** ((note - 12) / 12);
    if (inst === 'basedrum') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150 * rate, t);
      o.frequency.exponentialRampToValueAtTime(45 * rate, t + 0.12);
      env.gain.setValueAtTime(0.9, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(env);
      this.start(o, t, t + 0.3);
      return;
    }
    if (inst === 'snare' || inst === 'hat') {
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      src.buffer = this.noise;
      f.type = inst === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = (inst === 'hat' ? 7000 : 1800) * rate;
      const len = inst === 'hat' ? 0.06 : 0.16;
      env.gain.setValueAtTime(inst === 'hat' ? 0.5 : 0.7, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + len);
      src.connect(f).connect(env);
      this.start(src, t, t + len + 0.02);
      return;
    }
    const [type, decay, overtone, lowpass] = TIMBRE[inst] ?? TIMBRE.harp;
    const f0 = 440 * 2 ** (((LOW[inst] ?? 54) + note - 69) / 12);
    const attack = inst === 'flute' ? 0.04 : 0.005, end = t + attack + decay;
    let dest: AudioNode = env;
    if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; f.connect(env); dest = f; }
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.4, t + attack);
    env.gain.exponentialRampToValueAtTime(0.001, end);
    for (const [ratio, gain] of overtone ? [[1, 1], [overtone, 0.25]] : [[1, 1]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.value = f0 * ratio;
      g.gain.value = gain;
      o.connect(g).connect(dest);
      this.start(o, t, end + 0.05);
    }
  }
}
