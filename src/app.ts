import { addToStack, clearCachedStack, loadCachedStack, type PackStack, readPackFile, saveStack, stackLabel, VanillaResolver } from './assets/vanilla';
import { DATA_VERSION } from './blocks/data';
import { BlockRegistry } from './blocks/info';
import { DEMOS } from './demos/demos';
import { History } from './editor/history';
import type { Change } from './editor/placement';
import { shapeUpdates } from './editor/placement';
import type { Hit } from './editor/raycast';
import { exportLitematic, exportSchem, type ExportOptions, importFile, MC_VERSIONS } from './formats';
import { gunzip, isGzip } from './nbt/nbt';
import { View } from './render/view';
import { SimController } from './sim/controller';
import { BlockIcons } from './ui/blockicons';
import { download, toast } from './ui/dom';
import { idbGet, idbSet } from './util/idb';
import { World } from './world/world';

export type Mode = 'view' | 'build' | 'box' | 'afk';
export type LayerMode = 'all' | 'below' | 'only';
type EventName = 'world' | 'selected' | 'mode' | 'hover' | 'textures' | 'layer' | 'meta' | 'history' | 'box' | 'afk' | 'loading';

const AUTOSAVE_KEY = 'autosave-v1';
const DEFAULT_HOTBAR = ['grass_block[snowy=false]', 'stone_bricks', 'oak_planks', 'glass', 'oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]', 'oak_slab[type=bottom,waterlogged=false]', 'torch', 'water[level=0]', 'hopper[enabled=true,facing=down]'].map((s) => 'minecraft:' + s);

export class App {
  readonly world = new World();
  readonly reg = new BlockRegistry(this.world);
  readonly view: View;
  readonly history = new History(this.world);
  readonly icons: BlockIcons;
  readonly sim: SimController;
  mode: Mode = 'view';
  hotbar = [...DEFAULT_HOTBAR];
  hotIndex = 1;
  hover: Hit | null = null;
  box: { a: [number, number, number] | null; b: [number, number, number] | null } = { a: null, b: null };
  layer: { mode: LayerMode; y: number } = { mode: 'all', y: 0 };
  stack: PackStack = { base: null, overlays: [] };
  packLoading: { label: string; progress: number } | null = null;
  locked = false; // true while a timelapse is running
  /** Hooks into the UI layer (dialogs etc.), wired up in main.ts. */
  ui: { exportDialog?: () => void; openFile?: () => void; help?: () => void; textures?: () => void; pickAfk?: () => void } = {};
  private listeners = new Map<EventName, Set<() => void>>();
  private saveTimer = 0;
  private worldEventQueued = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.view = new View(canvas, this.world, this.reg);
    this.icons = new BlockIcons(this.view.lib);
    this.sim = new SimController(this);
    this.history.onChange = () => this.emit('history');
    this.world.onChange(() => {
      if (this.worldEventQueued) return;
      this.worldEventQueued = true;
      requestAnimationFrame(() => { this.worldEventQueued = false; this.emit('world'); });
      this.scheduleSave();
    });
    try {
      const hb = JSON.parse(localStorage.getItem('litecraft-hotbar') ?? 'null');
      if (Array.isArray(hb) && hb.length === 9) this.hotbar = hb;
    } catch { /* ignore */ }
  }

  get selected(): string { return this.hotbar[this.hotIndex]; }

  on(ev: EventName, fn: () => void): () => void {
    let s = this.listeners.get(ev);
    if (!s) { s = new Set(); this.listeners.set(ev, s); }
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit(ev: EventName) {
    this.view.requestRender();
    for (const fn of this.listeners.get(ev) ?? []) fn();
  }

  // ---- selection & modes ------------------------------------------------------

  select(key: string, intoSlot = true) {
    if (intoSlot) {
      const existing = this.hotbar.indexOf(key);
      if (existing >= 0) this.hotIndex = existing;
      else this.hotbar[this.hotIndex] = key;
      try { localStorage.setItem('litecraft-hotbar', JSON.stringify(this.hotbar)); } catch { /* ignore */ }
    }
    this.emit('selected');
  }
  setSlot(i: number) { this.hotIndex = Math.max(0, Math.min(8, i)); this.emit('selected'); }

  setMode(m: Mode) {
    if (this.locked && m !== 'view') { toast('Während der Zeitraffer-Simulation ist Bearbeiten gesperrt.', 'warn'); return; }
    this.mode = m;
    if (m !== 'box') this.clearBox();
    this.canvas.className = `view mode-${m}`;
    this.emit('mode');
  }

  clearBox() {
    if (!this.box.a && !this.box.b) return;
    this.box = { a: null, b: null };
    this.view.selection.visible = false;
    this.emit('box');
  }

  // ---- editing ---------------------------------------------------------------

  /** Applies changes (plus neighbour connection updates) as one undo step. */
  edit(changes: Change[]): number {
    if (this.locked || !changes.length) return 0;
    const n = this.history.apply(changes);
    if (!n) return 0;
    const upd = shapeUpdates(this.world, this.reg, changes.map((c) => [c.x, c.y, c.z]));
    if (upd.length && this.history.apply(upd)) this.history.mergeLast();
    return n;
  }

  undo() { if (!this.locked && this.history.undo()) this.emit('history'); }
  redo() { if (!this.locked && this.history.redo()) this.emit('history'); }

  boxBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    const { a, b } = this.box;
    if (!a || !b) return null;
    return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
  }

  fillBox(kind: 'fill' | 'clear' | 'hollow' | 'replace') {
    const bb = this.boxBounds();
    if (!bb) return;
    const vol = (bb.max[0] - bb.min[0] + 1) * (bb.max[1] - bb.min[1] + 1) * (bb.max[2] - bb.min[2] + 1);
    if (vol > 2_000_000) { toast('Auswahl zu groß (max. 2 Mio. Blöcke)', 'warn'); return; }
    const id = kind === 'clear' ? 0 : this.world.stateFromKey(this.selected);
    const replaceFrom = kind === 'replace' && this.hover && !this.hover.floor ? this.world.get(this.hover.x, this.hover.y, this.hover.z) : -1;
    const changes: Change[] = [];
    for (let x = bb.min[0]; x <= bb.max[0]; x++) for (let y = bb.min[1]; y <= bb.max[1]; y++) for (let z = bb.min[2]; z <= bb.max[2]; z++) {
      if (kind === 'hollow' && x > bb.min[0] && x < bb.max[0] && y > bb.min[1] && y < bb.max[1] && z > bb.min[2] && z < bb.max[2]) continue;
      if (kind === 'replace') {
        const cur = this.world.get(x, y, z);
        if (replaceFrom >= 0 ? cur !== replaceFrom : cur === 0) continue;
      }
      changes.push({ x, y, z, id });
    }
    const n = this.edit(changes);
    toast(`${n.toLocaleString('de-DE')} Blöcke ${kind === 'clear' ? 'entfernt' : 'gesetzt'}`, 'ok', 2000);
  }

  // ---- layers ----------------------------------------------------------------

  setLayer(mode: LayerMode, y = this.layer.y) {
    const b = this.world.bounds();
    const lo = b ? b.min[1] : 0, hi = b ? b.max[1] : 0;
    this.layer = { mode, y: Math.max(lo, Math.min(hi, y)) };
    this.view.setClip(mode === 'all' ? null : mode === 'below' ? { min: -1e9, max: this.layer.y } : { min: this.layer.y, max: this.layer.y });
    this.emit('layer');
  }
  isVisible = (_x: number, y: number) => {
    const l = this.layer;
    return l.mode === 'all' || (l.mode === 'below' ? y <= l.y : y === l.y);
  };

  // ---- files -----------------------------------------------------------------

  private afterLoad(fit = true) {
    this.history.clear();
    this.clearBox();
    this.sim.reset();
    const b = this.world.bounds();
    this.view.gridY = b ? b.min[1] : 0;
    this.layer = { mode: 'all', y: b ? b.max[1] : 0 };
    this.view.setClip(null);
    if (fit) this.view.fit(b);
    this.emit('layer');
    this.emit('meta');
    this.emit('world');
  }

  newWorld() {
    this.world.clear();
    this.world.meta.source = 'new';
    this.afterLoad();
  }

  loadDemo(id: string) {
    const d = DEMOS.find((x) => x.id === id);
    if (!d) return;
    this.world.clear();
    d.build(this.world);
    this.world.finishBulk();
    this.world.meta = { ...World.defaultMeta(), name: d.name, description: d.description, author: 'LiteCraft', source: 'demo' };
    this.afterLoad();
    this.sim.setAfk(d.afk ?? null);
    if (d.baseY !== undefined) this.sim.baseY = d.baseY;
  }

  async importBytes(bytes: Uint8Array, filename: string) {
    const backup = await this.snapshot();
    try {
      this.world.clear();
      const res = await importFile(bytes, filename, this.world);
      this.afterLoad();
      const dims = res.size.every((v) => v > 0) ? res.size : (() => { const b = this.world.bounds(); return b ? [b.max[0] - b.min[0] + 1, b.max[1] - b.min[1] + 1, b.max[2] - b.min[2] + 1] : [0, 0, 0]; })();
      toast(`${this.world.meta.name} geladen · ${dims.join(' × ')} · ${res.blocks.toLocaleString('de-DE')} Blöcke`, 'ok');
    } catch (e) {
      console.error(e);
      toast(`Import fehlgeschlagen: ${(e as Error).message}`, 'error', 6000);
      if (backup) { this.world.clear(); await importFile(backup, 'backup.litematic', this.world).catch(() => undefined); this.afterLoad(false); }
    }
  }

  async importFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (/\.(jar|zip)$/i.test(f.name)) await this.loadPack(f);
      else await this.importBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    }
  }

  exportDefaults(): ExportOptions {
    const m = this.world.meta;
    return { name: m.name || 'Struktur', author: m.author, description: m.description, dataVersion: m.dataVersion || DATA_VERSION };
  }

  async exportFile(format: 'litematic' | 'schem', opts: ExportOptions) {
    if (!this.world.bounds()) { toast('Nichts zu exportieren – die Struktur ist leer.', 'warn'); return; }
    const bytes = format === 'litematic' ? await exportLitematic(this.world, opts) : await exportSchem(this.world, opts);
    const safe = (opts.name || 'struktur').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'struktur';
    download(bytes, `${safe}.${format}`);
    const ver = MC_VERSIONS.find((v) => v.dataVersion === opts.dataVersion)?.label ?? opts.dataVersion;
    toast(`${safe}.${format} exportiert (MC ${ver}, ${(bytes.length / 1024).toFixed(1)} KB)`, 'ok');
  }

  async snapshot(): Promise<Uint8Array | null> {
    if (!this.world.bounds()) return null;
    return exportLitematic(this.world, this.exportDefaults());
  }

  async shareLink(): Promise<string | null> {
    const bytes = await this.snapshot();
    if (!bytes) { toast('Die Struktur ist leer.', 'warn'); return null; }
    if (bytes.length > 400_000) { toast('Zu groß für einen Link – nutze den Export.', 'warn'); return null; }
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${location.origin}${location.pathname}#s=${b64}`;
  }

  private async fromHash(): Promise<boolean> {
    const m = /#s=([\w-]+)/.exec(location.hash);
    if (!m) return false;
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.world.clear();
      await importFile(isGzip(bytes) ? await gunzip(bytes) : bytes, 'geteilt.litematic', this.world);
      this.afterLoad();
      history.replaceState(null, '', location.pathname + location.search);
      toast('Geteilte Struktur geladen', 'ok');
      return true;
    } catch {
      toast('Der geteilte Link ist beschädigt.', 'error');
      return false;
    }
  }

  private scheduleSave() {
    if (this.locked) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 1500);
  }
  saveMeta() { this.scheduleSave(); this.emit('meta'); }

  private async saveNow() {
    if (this.locked) return;
    try {
      const bytes = await this.snapshot();
      await idbSet(AUTOSAVE_KEY, bytes ? { bytes, meta: this.world.meta, at: Date.now() } : null);
    } catch { /* storage unavailable */ }
  }

  // ---- texture packs -----------------------------------------------------------

  private applyStack(stack: PackStack) {
    this.stack = stack;
    const has = !!stack.base || stack.overlays.length > 0;
    this.view.lib.reset(has ? new VanillaResolver(stack) : null);
    this.icons.reset();
    this.view.rebuildAll();
    this.emit('textures');
  }

  async loadPack(file: File) {
    this.packLoading = { label: file.name, progress: 0 };
    this.emit('loading');
    try {
      const pack = await readPackFile(file, (p) => { this.packLoading = { label: file.name, progress: p }; this.emit('loading'); });
      const next = addToStack(this.stack, pack);
      this.applyStack(next);
      const ok = await saveStack(next);
      const n = Object.keys(pack.textures).length;
      toast(`${pack.kind === 'jar' ? 'Minecraft-Jar' : 'Resourcepack'} „${pack.label}“ geladen · ${n} Texturen${ok ? '' : ' (nicht gespeichert)'}`, 'ok', 5000);
    } catch (e) {
      toast(`Texturen konnten nicht geladen werden: ${(e as Error).message}`, 'error', 7000);
    } finally {
      this.packLoading = null;
      this.emit('loading');
    }
  }

  async removePack(index: number | 'base') {
    const next: PackStack = index === 'base' ? { base: null, overlays: this.stack.overlays } : { base: this.stack.base, overlays: this.stack.overlays.filter((_, i) => i !== index) };
    this.applyStack(next);
    if (!next.base && !next.overlays.length) await clearCachedStack(); else await saveStack(next);
  }

  packLabel(): string { return stackLabel(this.stack); }

  // ---- startup -----------------------------------------------------------------

  async start() {
    const cached = await loadCachedStack();
    if (cached && (cached.base || cached.overlays?.length)) this.applyStack({ base: cached.base ?? null, overlays: cached.overlays ?? [] });
    if (await this.fromHash()) return;
    const saved = await idbGet<{ bytes: Uint8Array; meta: World['meta'] } | null>(AUTOSAVE_KEY);
    if (saved?.bytes) {
      try {
        await importFile(saved.bytes, 'autosave.litematic', this.world);
        this.world.meta = { ...this.world.meta, ...saved.meta };
        this.afterLoad();
        return;
      } catch { this.world.clear(); }
    }
    this.loadDemo('house');
  }
}
