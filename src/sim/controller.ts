import * as THREE from 'three';
import type { App } from '../app';
import { posFromKey, posKey } from '../world/world';
import { computeLight, type LightGrid } from './light';
import { type MobSimOptions, type MobSimResult, simulateMobs, SpawnMap } from './mobs';
import { findPlants, type Plant, PlantEngine, type PlantSimOptions, type PlantSimResult, type PState, simulatePlants, YIELD } from './plants';

const FLAT = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);

function effColor(e: number): THREE.Color {
  const stops: [number, number][] = [[0, 0xef4444], [0.35, 0xf97316], [0.6, 0xfacc15], [0.85, 0xa3e635], [1, 0x4ade80]];
  for (let i = 1; i < stops.length; i++) {
    if (e <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      return new THREE.Color(ca).lerp(new THREE.Color(cb), (e - a) / (b - a));
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}

function circle(radius: number, axis: 'x' | 'y' | 'z', color: number, opacity: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2, c = Math.cos(a) * radius, s = Math.sin(a) * radius;
    pts.push(axis === 'y' ? new THREE.Vector3(c, 0, s) : axis === 'x' ? new THREE.Vector3(0, c, s) : new THREE.Vector3(c, s, 0));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

class Timelapse {
  speed = 200;
  paused = false;
  readonly engine: PlantEngine;
  readonly harvested = new Map<string, number>();
  private originals = new Map<number, number>();
  private pending = new Map<number, number>();
  private flashes: { i: number; until: number }[] = [];

  constructor(private app: App, private plants: Plant[], private opts: PlantSimOptions) {
    this.engine = new PlantEngine(plants, opts, Date.now() & 0xffff, (p, amount) => this.onHarvest(p, amount), (_i, p, st) => this.render(p, st));
    plants.forEach((p, i) => this.render(p, this.engine.states[i]));
    this.flush();
  }

  private set(x: number, y: number, z: number, id: number) {
    const k = posKey(x, y, z);
    if (!this.originals.has(k)) this.originals.set(k, this.app.world.get(x, y, z));
    this.pending.set(k, id);
  }
  private original(x: number, y: number, z: number) {
    return this.originals.get(posKey(x, y, z)) ?? this.app.world.get(x, y, z);
  }

  private columnBlock(p: Plant, k: number, height: number): number {
    const w = this.app.world;
    if (p.kind === 'kelp') return w.state(k === height - 1 ? 'kelp' : 'kelp_plant', k === height - 1 ? { age: '0' } : {});
    if (p.kind === 'bamboo') return w.state('bamboo', { age: '0', leaves: k === height - 1 ? 'small' : 'none', stage: '0' });
    return w.state(p.block, { age: '0' });
  }

  private render(p: Plant, st: PState, flash = false) {
    const w = this.app.world, reg = this.app.reg;
    if (!p.valid) return;
    switch (p.kind) {
      case 'crop': case 'wart': case 'cocoa': case 'berry':
        this.set(p.x, p.y, p.z, w.withProps(this.original(p.x, p.y, p.z), { age: String(flash ? p.maxAge : st.age) }));
        break;
      case 'stem': {
        const fruitAt = flash ? 0 : st.fruit;
        for (const [sx, sy, sz] of p.spots) {
          const orig = reg.info(this.original(sx, sy, sz));
          this.set(sx, sy, sz, orig.short === p.fruit ? 0 : this.original(sx, sy, sz));
        }
        if (fruitAt >= 0 && p.spots[fruitAt]) {
          const [sx, sy, sz] = p.spots[fruitAt];
          this.set(sx, sy, sz, w.state(p.fruit!));
          const facing = sx > p.x ? 'east' : sx < p.x ? 'west' : sz > p.z ? 'south' : 'north';
          this.set(p.x, p.y, p.z, w.state(`attached_${p.block}`, { facing }));
        } else this.set(p.x, p.y, p.z, w.state(p.block, { age: String(st.age) }));
        break;
      }
      default: {
        const height = flash ? Math.max(2, st.height + 1) : st.height;
        const top = Math.min(p.maxHeight, 6);
        for (let k = 1; k < top; k++) {
          const y = p.y + k;
          const orig = reg.info(this.original(p.x, y, p.z));
          if (!(orig.air || orig.fluid === 1 || orig.short === p.block || orig.short === 'kelp_plant')) break;
          const empty = p.kind === 'kelp' ? w.state('water', { level: '0' }) : 0;
          this.set(p.x, y, p.z, k < height ? this.columnBlock(p, k, height) : orig.short === p.block || orig.short === 'kelp_plant' ? empty : this.original(p.x, y, p.z));
        }
      }
    }
  }

  private onHarvest(p: Plant, amount: number) {
    for (const [item, n] of Object.entries(YIELD[p.block] ?? {})) this.harvested.set(item, (this.harvested.get(item) ?? 0) + n * amount);
    if (this.opts.harvest === 'instant') {
      const i = this.plants.indexOf(p);
      this.render(p, this.engine.states[i], true);
      this.flashes.push({ i, until: performance.now() + 350 });
    }
  }

  private apply(map: Map<number, number>) {
    const w = this.app.world;
    w.batch(() => { for (const [k, id] of map) { const [x, y, z] = posFromKey(k); w.set(x, y, z, id); } });
  }

  private flush() {
    if (!this.pending.size) return;
    this.apply(this.pending);
    this.pending.clear();
  }

  frame(dt: number) {
    const now = performance.now();
    if (this.flashes.length) {
      const keep: typeof this.flashes = [];
      for (const f of this.flashes) {
        if (f.until <= now) this.render(this.plants[f.i], this.engine.states[f.i]);
        else keep.push(f);
      }
      this.flashes = keep;
    }
    if (!this.paused) this.engine.run(this.engine.time + dt * 20 * this.speed);
    this.flush();
  }

  restore() {
    this.apply(this.originals);
    this.originals.clear();
  }
}

export class SimController {
  baseY = 64;
  afk: [number, number, number] | null = null;
  plants: Plant[] = [];
  lastPlant: PlantSimResult | null = null;
  lastMob: MobSimResult | null = null;
  showHeat = false;
  showSpawns = false;
  showSpheres = true;
  timelapse: Timelapse | null = null;
  readonly group = new THREE.Group();
  private lightCache: { v: number; grid: LightGrid } | null = null;
  private spawnCache: { v: number; map: SpawnMap } | null = null;
  private plantsVersion = -1;
  private heatMesh: THREE.InstancedMesh | null = null;
  private spawnMesh: THREE.InstancedMesh | null = null;
  private afkMarker = new THREE.Group();
  private spheres = new THREE.Group();

  constructor(private app: App) {
    app.view.overlay.add(this.group);
    const box = (w: number, h: number, d: number, y: number, color: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
      m.position.y = y;
      return m;
    };
    this.afkMarker.add(box(0.5, 0.75, 0.28, 0.375, 0x3b4fa8), box(0.5, 0.72, 0.28, 1.11, 0x1fa6a6), box(0.46, 0.46, 0.46, 1.71, 0xc69c6d));
    this.afkMarker.add(box(0.2, 0.72, 0.24, 1.11, 0xc69c6d).translateX(0.35), box(0.2, 0.72, 0.24, 1.11, 0xc69c6d).translateX(-0.35));
    this.afkMarker.visible = false;
    this.spheres.add(circle(24, 'y', 0xef4444, 0.7), circle(24, 'x', 0xef4444, 0.35), circle(24, 'z', 0xef4444, 0.35), circle(128, 'y', 0x94a3b8, 0.35), circle(128, 'x', 0x94a3b8, 0.15), circle(128, 'z', 0x94a3b8, 0.15));
    this.spheres.visible = false;
    this.group.add(this.afkMarker, this.spheres);
    app.view.onFrame((dt) => this.timelapse?.frame(dt));
    app.on('layer', () => {
      if (this.showHeat) this.buildHeat();
      if (this.showSpawns) this.buildSpawns(this.spawnHeat ?? undefined);
    });
  }
  private spawnHeat: Map<number, number> | null = null;

  reset() {
    this.stopTimelapse();
    this.lastPlant = null;
    this.lastMob = null;
    this.setHeat(false);
    this.setSpawns(false);
    this.setAfk(null);
  }

  light(): LightGrid | null {
    const b = this.app.world.bounds();
    if (!b) return null;
    if (this.timelapse && this.lightCache) return this.lightCache.grid;
    if (this.lightCache?.v !== this.app.world.version) this.lightCache = { v: this.app.world.version, grid: computeLight(this.app.world, this.app.reg, b) };
    return this.lightCache.grid;
  }

  lightIfCached(): LightGrid | null {
    return this.lightCache && (this.lightCache.v === this.app.world.version || this.timelapse) ? this.lightCache.grid : null;
  }

  spawnMap(): SpawnMap | null {
    const b = this.app.world.bounds();
    const light = this.light();
    if (!b || !light) return null;
    if (this.spawnCache?.v !== this.app.world.version) this.spawnCache = { v: this.app.world.version, map: new SpawnMap(this.app.world, this.app.reg, b, light) };
    return this.spawnCache.map;
  }

  analyzePlants(): Plant[] {
    if (this.timelapse) return this.plants;
    if (this.plantsVersion === this.app.world.version) return this.plants;
    const light = this.light();
    this.plants = light ? findPlants(this.app.world, this.app.reg, light) : [];
    this.plantsVersion = this.app.world.version;
    if (this.showHeat) this.buildHeat();
    return this.plants;
  }

  plantAt(x: number, y: number, z: number): Plant | undefined {
    return this.plants.find((p) => p.x === x && p.z === z && (p.y === y || ((p.kind === 'cane' || p.kind === 'cactus' || p.kind === 'bamboo' || p.kind === 'kelp') && y >= p.y && y < p.y + p.maxHeight)));
  }

  runPlants(opts: PlantSimOptions): PlantSimResult {
    this.lastPlant = simulatePlants(this.analyzePlants(), opts);
    return this.lastPlant;
  }

  // ---- overlays --------------------------------------------------------------

  /** Flat coloured markers; `floorY` is the block whose visibility (layer filter) decides if a marker is shown. */
  private instanced(all: { x: number; y: number; z: number; floorY: number; color: THREE.Color }[], opacity: number): THREE.InstancedMesh {
    const items = all.filter((it) => this.app.isVisible(it.x, it.floorY));
    const mesh = new THREE.InstancedMesh(FLAT, new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }), Math.max(1, items.length));
    const m = new THREE.Matrix4();
    items.forEach((it, i) => {
      m.makeTranslation(it.x + 0.5, it.y + 0.035, it.z + 0.5);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    });
    mesh.count = items.length;
    mesh.renderOrder = 5;
    return mesh;
  }

  private buildHeat() {
    if (this.heatMesh) { this.group.remove(this.heatMesh); this.heatMesh.dispose(); this.heatMesh = null; this.app.view.requestRender(); }
    if (!this.showHeat) return;
    this.heatMesh = this.instanced(this.plants.map((p) => ({ x: p.x, y: p.y, z: p.z, floorY: p.y, color: effColor(p.valid ? p.efficiency : 0) })), 0.72);
    this.group.add(this.heatMesh);
    this.app.view.requestRender();
  }
  setHeat(on: boolean) { this.showHeat = on; if (on) this.analyzePlants(); this.buildHeat(); }

  buildSpawns(heat?: Map<number, number>) {
    if (this.spawnMesh) { this.group.remove(this.spawnMesh); this.spawnMesh.dispose(); this.spawnMesh = null; this.app.view.requestRender(); }
    this.spawnHeat = heat ?? null;
    if (!this.showSpawns) return;
    const map = this.spawnMap();
    if (!map) return;
    const items: { x: number; y: number; z: number; floorY: number; color: THREE.Color }[] = [];
    if (heat && heat.size) {
      let max = 1;
      for (const n of heat.values()) if (n > max) max = n;
      for (const [ci, n] of heat) { const [x, y, z] = map.coords(ci); items.push({ x, y, z, floorY: y - 1, color: effColor(1 - n / max) }); }
    } else {
      for (const s of map.spots(this.afk)) {
        let c = 0x4ade80;
        if (s.dist >= 0 && s.dist <= 24) c = 0xef4444;
        else if (s.dist > 128) c = 0x64748b;
        else if (s.sky > 0) c = 0xf59e0b;
        else if (s.dist < 0) c = 0x38bdf8;
        items.push({ x: s.x, y: s.y, z: s.z, floorY: s.y - 1, color: new THREE.Color(c) });
      }
    }
    this.spawnMesh = this.instanced(items, 0.6);
    this.group.add(this.spawnMesh);
    this.app.view.requestRender();
  }
  setSpawns(on: boolean) { this.showSpawns = on; this.buildSpawns(); }

  setAfk(p: [number, number, number] | null) {
    this.afk = p;
    this.afkMarker.visible = !!p;
    this.spheres.visible = !!p && this.showSpheres;
    if (p) { this.afkMarker.position.set(p[0] + 0.5, p[1], p[2] + 0.5); this.spheres.position.set(p[0] + 0.5, p[1], p[2] + 0.5); }
    if (this.showSpawns) this.buildSpawns();
    this.app.emit('afk');
  }
  setSpheres(on: boolean) { this.showSpheres = on; this.spheres.visible = on && !!this.afk; this.app.view.requestRender(); }

  async runMobs(opts: Omit<MobSimOptions, 'afk'>, onProgress: (p: number) => void): Promise<MobSimResult | null> {
    const map = this.spawnMap();
    if (!map || !this.afk) return null;
    this.lastMob = await simulateMobs(map, { ...opts, afk: this.afk }, onProgress);
    return this.lastMob;
  }

  // ---- timelapse ---------------------------------------------------------------

  startTimelapse(opts: PlantSimOptions) {
    this.stopTimelapse();
    const plants = this.analyzePlants().filter((p) => p.valid);
    if (!plants.length) return false;
    this.app.redstone.stop();
    this.app.setMode('view');
    this.app.locked = true;
    this.timelapse = new Timelapse(this.app, plants, opts);
    this.app.emit('loading');
    return true;
  }

  stopTimelapse() {
    if (!this.timelapse) return;
    this.timelapse.restore();
    this.timelapse = null;
    this.app.locked = false;
    this.app.emit('loading');
  }
}
