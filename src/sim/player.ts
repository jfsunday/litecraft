// Plays redstone in real time: steps the RedstoneSim on the wall clock, schedules note sounds and draws the glow overlay.
import * as THREE from 'three';
import type { App } from '../app';
import { fmt, toast } from '../ui/dom';
import { posFromKey } from '../world/world';
import { NOTE_FILES, NoteAudio } from './noteaudio';
import { type NoteEvent, RedstoneSim } from './redstone';

const LOOKAHEAD_MS = 60; // the simulation runs this far ahead so sounds can be scheduled precisely
const GLOW_MS = 400;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const RED = new THREE.Color(1, 0.08, 0.04);
const INSTRUMENTS = Object.keys(NOTE_FILES);
const glowColor = (inst: string) => new THREE.Color().setHSL(Math.max(0, INSTRUMENTS.indexOf(inst)) / INSTRUMENTS.length, 0.9, 0.62);

type Vec3 = [number, number, number];
interface Item { p: Vec3; s: Vec3; c: THREE.Color }

export class RedstonePlayer {
  sim: RedstoneSim | null = null;
  readonly audio = new NoteAudio();
  speed = 1;
  /** Sound loading progress (0–1) while starting, otherwise null. */
  loading: number | null = null;
  /** All notes of the current/last run (ticks relative to the first press). */
  log: NoteEvent[] = [];
  private starting = false;
  private baseTick = 0;
  private baseWall = 0;
  private lastFrame = 0;
  private idleSince = 0;
  private leverUsed = false;
  private glows: { p: Vec3; at: number; c: THREE.Color }[] = [];
  private power: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;

  constructor(private app: App) {
    this.power = this.mesh(256);
    this.glow = this.mesh(64);
    app.view.onFrame(() => this.frame());
  }

  get running(): boolean { return !!this.sim || this.starting; }
  /** Tick that is currently audible. */
  get clockTick(): number { return this.sim ? Math.max(0, Math.min(this.sim.tick, Math.floor(this.ticksAt(performance.now())))) : 0; }

  private isSwitch(p: Vec3): boolean { return /_button$|^lever$/.test(this.app.reg.info(this.app.world.get(p[0], p[1], p[2])).short); }

  /** The pasted song's start button, else the only button in the world. */
  startButton(): Vec3 | 'none' | 'many' {
    const s = this.app.song?.start_button;
    if (s && this.isSwitch(s)) return s;
    const found: Vec3[] = [];
    this.app.world.forEach((x, y, z, id) => { if (this.app.reg.info(id).short.endsWith('_button')) found.push([x, y, z]); });
    return found.length === 1 ? found[0] : found.length ? 'many' : 'none';
  }

  async play(at?: Vec3): Promise<boolean> {
    if (this.sim) { if (at) this.press(at); return true; }
    if (this.starting) return false;
    const pos = at ?? this.startButton();
    if (pos === 'none') { toast('Kein Knopf gefunden – baue einen Knopf oder Hebel an den Anfang der Schaltung.', 'warn'); return false; }
    if (pos === 'many') { toast('Mehrere Knöpfe – klicke im Ansehen-Modus auf den, den du drücken willst.', 'info', 4500); return false; }
    const app = this.app;
    if (app.sim.timelapse) app.sim.stopTimelapse();
    app.setMode('view');
    app.locked = true;
    this.starting = true;
    this.audio.unlock();
    app.emit('redstone');
    await this.audio.prepare((p) => { this.loading = p; app.emit('redstone'); });
    this.loading = null;
    if (!this.starting) return false; // stopped while loading
    this.starting = false;
    this.sim = new RedstoneSim(app.world, app.reg);
    this.log = [];
    this.glows = [];
    this.leverUsed = false;
    this.idleSince = 0;
    this.baseTick = 0;
    this.baseWall = this.lastFrame = performance.now();
    this.press(pos);
    app.emit('redstone');
    return true;
  }

  /** Click on a block in view mode: presses buttons / flips levers (starting the simulation if needed). */
  interact(x: number, y: number, z: number): boolean {
    if (!this.isSwitch([x, y, z])) return false;
    if (this.sim) this.press([x, y, z]);
    else void this.play([x, y, z]);
    return true;
  }

  stop() {
    if (!this.running) return;
    this.sim = null;
    this.starting = false;
    this.loading = null;
    this.audio.stopAll();
    this.glows = [];
    this.power.count = this.glow.count = 0;
    this.app.locked = false;
    this.app.view.requestRender();
    this.app.emit('redstone');
  }

  setSpeed(s: number) {
    const now = performance.now();
    this.baseTick = this.ticksAt(now);
    this.baseWall = now;
    this.speed = s;
    this.app.emit('redstone');
  }

  private ticksAt(wall: number) { return this.baseTick + ((wall - this.baseWall) / 100) * this.speed; }
  private wallAt(tick: number) { return this.baseWall + ((tick - this.baseTick) * 100) / this.speed; }

  private press(p: Vec3) {
    const sim = this.sim!;
    if (this.app.reg.info(this.app.world.get(p[0], p[1], p[2])).short === 'lever') this.leverUsed = true;
    const ev = sim.press(p[0], p[1], p[2]);
    if (ev) { this.handle(ev, performance.now()); this.drawPower(); }
  }

  private handle(events: NoteEvent[], now: number) {
    for (const e of events) {
      this.log.push(e);
      const at = this.wallAt(e.tick);
      this.audio.play(e.instrument, e.note, (at - now) / 1000);
      this.glows.push({ p: [e.x, e.y, e.z], at, c: glowColor(e.instrument) });
    }
  }

  private frame() {
    const sim = this.sim;
    if (!sim) return;
    const now = performance.now();
    if (now - this.lastFrame > 2500) { this.baseTick = sim.tick; this.baseWall = now; } // tab was hidden: resume instead of fast-forwarding
    this.lastFrame = now;
    const target = Math.floor(this.ticksAt(now + LOOKAHEAD_MS));
    let stepped = false;
    for (let i = 0; i < 1000 && sim.tick < target; i++) { this.handle(sim.step(), now); stepped = true; }
    if (stepped) this.drawPower();
    this.drawGlow(now);
    if (sim.idle && !this.leverUsed && !this.glows.length) {
      this.idleSince ||= now;
      if (now - this.idleSince > 600) this.finish();
    } else this.idleSince = 0;
  }

  private finish() {
    const n = this.log.length, s = (this.log.at(-1)?.tick ?? 0) / 10;
    this.stop();
    if (n) toast(`Fertig · ${fmt(n)} Noten in ${fmt(s, 1)} s`, 'ok', 3000);
  }

  // ---- overlay -------------------------------------------------------------------

  private mesh(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), cap);
    m.setColorAt(0, RED);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 6;
    this.app.view.overlay.add(m);
    return m;
  }

  private fill(which: 'power' | 'glow', items: Item[]) {
    let m = this[which];
    if (items.length > m.instanceMatrix.count) {
      this.app.view.overlay.remove(m);
      m.dispose();
      m = this[which] = this.mesh(items.length * 2);
    }
    const mat = new THREE.Matrix4();
    items.forEach((it, i) => {
      mat.makeScale(it.s[0], it.s[1], it.s[2]).setPosition(it.p[0], it.p[1], it.p[2]);
      m.setMatrixAt(i, mat);
      m.setColorAt(i, it.c);
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.app.view.requestRender();
  }

  private drawPower() {
    const snap = this.sim!.snapshot(), items: Item[] = [];
    for (const [k, p] of snap.dust) {
      const [x, y, z] = posFromKey(k);
      items.push({ p: [x + 0.5, y + 0.04, z + 0.5], s: [0.92, 0.06, 0.92], c: RED.clone().multiplyScalar(0.3 + (0.7 * p) / 15) });
    }
    for (const k of snap.parts) {
      const [x, y, z] = posFromKey(k);
      const diode = /^(repeater|comparator)$/.test(this.app.reg.info(this.app.world.get(x, y, z)).short);
      items.push(diode ? { p: [x + 0.5, y + 0.08, z + 0.5], s: [0.98, 0.16, 0.98], c: RED } : { p: [x + 0.5, y + 0.45, z + 0.5], s: [0.4, 0.4, 0.4], c: RED });
    }
    for (const k of snap.blocks) {
      const [x, y, z] = posFromKey(k);
      items.push({ p: [x + 0.5, y + 0.5, z + 0.5], s: [1.02, 1.02, 1.02], c: RED.clone().multiplyScalar(0.25) });
    }
    this.fill('power', items);
  }

  private drawGlow(now: number) {
    if (!this.glows.length && !this.glow.count) return;
    this.glows = this.glows.filter((g) => now - g.at < GLOW_MS);
    const items: Item[] = [];
    for (const g of this.glows) {
      if (g.at > now) continue;
      const k = 1 - (now - g.at) / GLOW_MS, s = 1.04 + 0.14 * k;
      items.push({ p: [g.p[0] + 0.5, g.p[1] + 0.5, g.p[2] + 0.5], s: [s, s, s], c: g.c.clone().multiplyScalar(k) });
    }
    this.fill('glow', items);
  }
}
