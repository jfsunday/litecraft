// Redstone simulation modelled on Java Edition's update rules, in redstone ticks (1 rt = 2 game ticks = 0.1 s).
// Pure logic: reads the World, never mutates it. Components: dust, repeater (incl. locking), comparator,
// torch, button, lever, redstone block, note block.
import { type BlockInfo, type BlockRegistry, DIR_INDEX } from '../blocks/info';
import { posFromKey, posKey, type World } from '../world/world';

export interface NoteEvent { tick: number; x: number; y: number; z: number; instrument: string; note: number }

const E = 0, W = 1, UP = 2, DOWN = 3, S = 4, N = 5;
const OPP = [W, E, DOWN, UP, N, S];
const HORIZONTAL = [E, W, S, N];
const R = 131072;
const STEP = [R * R, -R * R, R, -R, 1, -1]; // posKey offsets, same order as DIRS
const SIDES = [[S, N], [S, N], [], [], [E, W], [E, W]];

const DUST = 1, REPEATER = 2, COMPARATOR = 3, TORCH = 4, BUTTON = 5, LEVER = 6, RSBLOCK = 7, NOTE = 8;
const PRIO_EXTREMELY_HIGH = -3, PRIO_VERY_HIGH = -2, PRIO_HIGH = -1, PRIO_NORMAL = 0;

interface Comp {
  kind: number;
  dir: number;         // diode: towards its input · torch/button/lever: towards the attached block
  delay: number;       // repeater delay / button press length
  subtract: boolean;
  conn: boolean[];     // dust: powers the horizontal neighbour in this direction
  net: number;         // dust network
  outs: number[];      // dust that draws power from this dust
  instrument: string;
  note: number;
}

interface Tick { k: number; t: number; prio: number; seq: number }

// Blocks whose `opaque` full cube is not a redstone conductor in Java.
const NON_CONDUCTOR = /^(redstone_block|observer|piston|sticky_piston|glowstone)$/;
const WOOD = /_planks$|_log$|_wood$|_stem$|_hyphae$|^stripped_|^bamboo_(block|mosaic)$|bookshelf$|^crafting_table$|^(trapped_)?chest$|^barrel$|^jukebox$|^note_block$|^loom$|^composter$|^lectern$|^(cartography|fletching|smithing)_table$|^bee(hive|_nest)$|mushroom_(block|stem)$|^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_/;
const STONE = /stone|cobble|deepslate|_ore$|bricks?$|^netherrack$|obsidian|basalt|terracotta|_concrete$|quartz|prismarine|purpur|andesite|diorite|granite|tuff|calcite|dripstone|^bedrock$|_coral_block$|^magma_block$|^observer$|^dispenser$|^dropper$|furnace$|^smoker$|^respawn_anchor$|^enchanting_table$|^ender_chest$|^spawner$|nylium$|^amethyst_block$/;

/** Note block instrument from the block below it (Java mapping, mob heads excluded). */
export function instrumentBelow(b: BlockInfo): string {
  const s = b.short;
  const direct: Record<string, string> = {
    clay: 'flute', honeycomb_block: 'flute', gold_block: 'bell', packed_ice: 'chime', bone_block: 'xylophone',
    iron_block: 'iron_xylophone', soul_sand: 'cow_bell', pumpkin: 'didgeridoo', emerald_block: 'bit', hay_block: 'banjo', glowstone: 'pling',
  };
  if (direct[s]) return direct[s];
  if (s.endsWith('_wool')) return 'guitar';
  if (/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$|_concrete_powder$/.test(s)) return 'snare';
  if (/glass|^sea_lantern$|^beacon$/.test(s)) return 'hat';
  if (WOOD.test(s)) return 'bass';
  if (STONE.test(s)) return 'basedrum';
  return 'harp';
}

const axis = (d: number) => d >> 1;

export class RedstoneSim {
  private comps = new Map<number, Comp>();
  private infos = new Map<number, BlockInfo>();
  private nets: number[][] = [];
  private power = new Map<number, number>();      // dust power
  private on = new Set<number>();                 // powered repeaters/comparators/buttons/levers, lit torches
  private compOut = new Map<number, number>();    // comparator output strength
  private noteOn = new Set<number>();
  private buckets = new Map<number, Tick[]>();
  private pending = new Map<number, Tick>();
  private dueNow = new Set<number>();
  private netDirty = new Set<number>();
  private compDirty = new Set<number>();
  private events: NoteEvent[] = [];
  private time = 0;
  private epoch = 0;
  private seq = 0;

  constructor(readonly world: World, readonly reg: BlockRegistry) {
    world.forEach((x, y, z, id) => {
      const c = this.classify(reg.info(id), x, y, z);
      if (c) this.comps.set(posKey(x, y, z), c);
    });
    for (const [k, c] of this.comps) if (c.kind === DUST) this.linkDust(k, c);
    this.buildNets();
    for (const [k, c] of this.comps) {
      if (c.kind === DUST) continue;
      if (c.kind === NOTE) { if (this.info(k).props.powered === 'true') this.noteOn.add(k); continue; }
      const p = this.info(k).props;
      if (c.kind === TORCH ? p.lit !== 'false' : p.powered === 'true') this.on.add(k);
      if (c.kind === BUTTON && this.on.has(k)) this.schedule(k, c.delay, PRIO_NORMAL);
    }
    // Bring the circuit into its steady state before anything is pressed (notes from that are discarded).
    this.nets.forEach((_, i) => this.netDirty.add(i));
    for (const [k, c] of this.comps) if (c.kind !== DUST) this.compDirty.add(k);
    this.settle();
    for (let i = 0; i < 300 && !this.idle; i++) this.step();
    this.events = [];
    this.epoch = this.time;
  }

  /** Redstone ticks since construction (0 = the moment interactions like the start button happen). */
  get tick(): number { return this.time - this.epoch; }
  /** Nothing scheduled: the circuit stays as it is until the next interaction. */
  get idle(): boolean { return this.pending.size === 0; }
  get noteBlocks(): number { let n = 0; for (const c of this.comps.values()) if (c.kind === NOTE) n++; return n; }

  /** Buttons and levers in the world. */
  switches(): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const [k, c] of this.comps) if (c.kind === BUTTON || c.kind === LEVER) out.push(posFromKey(k));
    return out;
  }

  isSwitch(x: number, y: number, z: number): boolean {
    const c = this.comps.get(posKey(x, y, z));
    return !!c && (c.kind === BUTTON || c.kind === LEVER);
  }

  /** Presses a button / flips a lever at the current tick. Returns the notes it triggers right away, null if there is no switch. */
  press(x: number, y: number, z: number): NoteEvent[] | null {
    const k = posKey(x, y, z), c = this.comps.get(k);
    if (!c || (c.kind !== BUTTON && c.kind !== LEVER)) return null;
    if (c.kind === BUTTON) {
      if (this.on.has(k)) return [];
      this.setOn(k, true);
      this.schedule(k, c.delay, PRIO_NORMAL);
    } else this.setOn(k, !this.on.has(k));
    this.settle();
    return this.flush();
  }

  /** Advances one redstone tick and returns the note blocks that played in it. */
  step(): NoteEvent[] {
    this.time++;
    const due = this.buckets.get(this.time) ?? [];
    this.buckets.delete(this.time);
    due.sort((a, b) => a.prio - b.prio || a.seq - b.seq);
    for (const t of due) { this.pending.delete(t.k); this.dueNow.add(t.k); }
    for (const t of due) {
      this.dueNow.delete(t.k);
      this.run(t.k);
      this.settle();
    }
    return this.flush();
  }

  /** Powered state for highlighting: dust power, active components and strongly powered blocks. */
  snapshot(): { dust: [number, number][]; parts: number[]; blocks: number[] } {
    const parts: number[] = [], blocks = new Set<number>();
    const strong = (k: number) => { if (this.conductor(k)) blocks.add(k); };
    for (const k of this.on) {
      const c = this.comps.get(k)!;
      if (c.kind === COMPARATOR) continue;
      if (c.kind === TORCH) { strong(k + STEP[UP]); continue; }
      parts.push(k);
      strong(k + STEP[c.kind === REPEATER ? OPP[c.dir] : c.dir]);
    }
    for (const [k, v] of this.compOut) if (v > 0) { parts.push(k); strong(k + STEP[OPP[this.comps.get(k)!.dir]]); }
    return { dust: [...this.power], parts, blocks: [...blocks] };
  }

  // ---- setup -------------------------------------------------------------------

  private info(k: number): BlockInfo {
    let i = this.infos.get(k);
    if (!i) { const [x, y, z] = posFromKey(k); i = this.reg.info(this.world.get(x, y, z)); this.infos.set(k, i); }
    return i;
  }
  private conductor(k: number): boolean { const i = this.info(k); return i.opaque && !NON_CONDUCTOR.test(i.short); }
  private isDust(k: number): boolean { return this.comps.get(k)?.kind === DUST; }

  private classify(info: BlockInfo, x: number, y: number, z: number): Comp | null {
    const s = info.short, p = info.props;
    const c: Comp = { kind: 0, dir: DOWN, delay: 0, subtract: false, conn: [], net: -1, outs: [], instrument: '', note: 0 };
    const attached = () => (p.face === 'floor' ? DOWN : p.face === 'ceiling' ? UP : OPP[DIR_INDEX[p.facing] ?? N]);
    if (s === 'redstone_wire') c.kind = DUST;
    else if (s === 'repeater') { c.kind = REPEATER; c.dir = DIR_INDEX[p.facing] ?? N; c.delay = Math.min(4, Math.max(1, Number(p.delay) || 1)); }
    else if (s === 'comparator') { c.kind = COMPARATOR; c.dir = DIR_INDEX[p.facing] ?? N; c.subtract = p.mode === 'subtract'; }
    else if (s === 'redstone_torch') c.kind = TORCH;
    else if (s === 'redstone_wall_torch') { c.kind = TORCH; c.dir = OPP[DIR_INDEX[p.facing] ?? N]; }
    else if (s.endsWith('_button')) { c.kind = BUTTON; c.dir = attached(); c.delay = /^(stone|polished_blackstone)_button$/.test(s) ? 10 : 15; }
    else if (s === 'lever') { c.kind = LEVER; c.dir = attached(); }
    else if (s === 'redstone_block') c.kind = RSBLOCK;
    else if (s === 'note_block') {
      c.kind = NOTE;
      const raw = this.world.palette[this.world.get(x, y, z)].props.instrument;
      c.instrument = raw ?? instrumentBelow(this.reg.info(this.world.get(x, y - 1, z)));
      c.note = Math.min(24, Math.max(0, Number(p.note) || 0));
    } else return null;
    return c;
  }

  private connectsTo(i: BlockInfo, d: number): boolean {
    if (i.short === 'redstone_wire') return true;
    if (i.short === 'repeater') return axis(DIR_INDEX[i.props.facing] ?? N) === axis(d);
    if (i.short === 'observer') return DIR_INDEX[i.props.facing] === d;
    return i.signal;
  }

  /** Java's dust connection shape (decides where dust outputs) and the dust it takes power from. */
  private linkDust(k: number, c: Comp) {
    const aboveConductor = this.conductor(k + STEP[UP]);
    const conn = [false, false, false, false, false, false];
    for (const d of HORIZONTAL) {
      const s = k + STEP[d], si = this.info(s), sc = this.conductor(s);
      const holds = (si.faceFull & (1 << UP)) !== 0 || si.short === 'hopper';
      conn[d] = (!aboveConductor && holds && this.isDust(s + STEP[UP])) || this.connectsTo(si, d) || (!sc && this.isDust(s + STEP[DOWN]));
      const from = [s];
      if (sc && !aboveConductor) from.push(s + STEP[UP]);
      else if (!sc) from.push(s + STEP[DOWN]);
      for (const f of from) if (this.isDust(f)) this.comps.get(f)!.outs.push(k);
    }
    const p = this.info(k).props;
    const dot = HORIZONTAL.every((d) => (p[['east', 'west', '', '', 'south', 'north'][d]] ?? 'none') === 'none');
    if (!(dot && !HORIZONTAL.some((d) => conn[d]))) {
      const noEW = !conn[E] && !conn[W], noNS = !conn[N] && !conn[S];
      if (noNS) conn[E] = conn[W] = true;
      if (noEW) conn[N] = conn[S] = true;
    }
    c.conn = conn;
  }

  private buildNets() {
    const parent = new Map<number, number>();
    const find = (k: number): number => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(k, r); return r; };
    for (const [k, c] of this.comps) if (c.kind === DUST) parent.set(k, k);
    for (const [k, c] of this.comps) if (c.kind === DUST) for (const o of c.outs) parent.set(find(o), find(k));
    const ids = new Map<number, number>();
    for (const [k, c] of this.comps) {
      if (c.kind !== DUST) continue;
      const r = find(k);
      let id = ids.get(r);
      if (id === undefined) { id = this.nets.length; ids.set(r, id); this.nets.push([]); }
      c.net = id;
      this.nets[id].push(k);
    }
  }

  // ---- signals (d = direction from the source towards the receiver) ------------------

  private weak(k: number, d: number, forDust: boolean): number {
    const c = this.comps.get(k);
    if (!c) return 0;
    switch (c.kind) {
      case DUST: return forDust ? 0 : this.dustOut(k, c, d);
      case REPEATER: return this.on.has(k) && d === OPP[c.dir] ? 15 : 0;
      case COMPARATOR: return d === OPP[c.dir] ? this.compOut.get(k) ?? 0 : 0;
      case BUTTON: case LEVER: return this.on.has(k) ? 15 : 0;
      case TORCH: return this.on.has(k) && d !== c.dir ? 15 : 0;
      case RSBLOCK: return 15;
    }
    return 0;
  }

  private strong(k: number, d: number, forDust: boolean): number {
    const c = this.comps.get(k);
    if (!c) return 0;
    switch (c.kind) {
      case DUST: return forDust ? 0 : this.dustOut(k, c, d);
      case REPEATER: case COMPARATOR: return this.weak(k, d, forDust);
      case BUTTON: case LEVER: return this.on.has(k) && d === c.dir ? 15 : 0;
      case TORCH: return this.on.has(k) && d === UP ? 15 : 0;
    }
    return 0;
  }

  private dustOut(k: number, c: Comp, d: number): number {
    const p = this.power.get(k) ?? 0;
    return p && (d === DOWN || (d !== UP && c.conn[d])) ? p : 0;
  }

  /** Strong power going into block k (dust excluded when asked by dust: weakly powered blocks don't feed dust). */
  private strongInto(k: number, forDust: boolean): number {
    let m = 0;
    for (let d = 0; d < 6 && m < 15; d++) m = Math.max(m, this.strong(k + STEP[d], OPP[d], forDust));
    return m;
  }

  /** Java's Level.getSignal: what block k gives to its neighbour in direction d. */
  private signal(k: number, d: number, forDust: boolean): number {
    const s = this.weak(k, d, forDust);
    return s < 15 && this.conductor(k) ? Math.max(s, this.strongInto(k, forDust)) : s;
  }

  private bestSignal(k: number, forDust: boolean): number {
    let m = 0;
    for (let d = 0; d < 6 && m < 15; d++) m = Math.max(m, this.signal(k + STEP[d], OPP[d], forDust));
    return m;
  }

  private input(k: number, c: Comp): number {
    const b = k + STEP[c.dir];
    const s = this.signal(b, OPP[c.dir], false);
    return s < 15 && this.isDust(b) ? Math.max(s, this.power.get(b) ?? 0) : s;
  }

  private sideInput(k: number, c: Comp, diodesOnly: boolean): number {
    let m = 0;
    for (const sd of SIDES[c.dir]) {
      const s = k + STEP[sd], sc = this.comps.get(s);
      if (diodesOnly) { if (sc?.kind === REPEATER || sc?.kind === COMPARATOR) m = Math.max(m, this.strong(s, OPP[sd], false)); }
      else m = Math.max(m, sc?.kind === RSBLOCK ? 15 : sc?.kind === DUST ? this.power.get(s) ?? 0 : this.strong(s, OPP[sd], false));
    }
    return m;
  }

  private locked(k: number, c: Comp): boolean { return c.kind === REPEATER && this.sideInput(k, c, true) > 0; }

  private compare(k: number, c: Comp): number {
    const rear = this.input(k, c);
    if (!rear) return 0;
    const side = this.sideInput(k, c, false);
    return side > rear ? 0 : c.subtract ? rear - side : rear;
  }
  private comparatorOn(k: number, c: Comp): boolean {
    const rear = this.input(k, c);
    if (!rear) return false;
    const side = this.sideInput(k, c, false);
    return rear > side || (rear === side && !c.subtract);
  }

  private torchInput(k: number, c: Comp): boolean { return this.signal(k + STEP[c.dir], OPP[c.dir], false) > 0; }

  private prioritized(k: number, c: Comp): boolean {
    const f = this.comps.get(k + STEP[OPP[c.dir]]);
    return !!f && (f.kind === REPEATER || f.kind === COMPARATOR) && f.dir !== OPP[c.dir];
  }

  // ---- updates -----------------------------------------------------------------------

  private schedule(k: number, delay: number, prio: number) {
    if (this.pending.has(k)) return;
    const t: Tick = { k, t: this.time + delay, prio, seq: this.seq++ };
    this.pending.set(k, t);
    const b = this.buckets.get(t.t);
    if (b) b.push(t); else this.buckets.set(t.t, [t]);
  }

  private setOn(k: number, v: boolean) {
    if (v) this.on.add(k); else this.on.delete(k);
    this.touch(k, true);
  }

  /** Marks everything a change at k can affect (neighbours and their neighbours, like Java's update shape). */
  private touch(k: number, dust: boolean) {
    const mark = (p: number) => {
      const c = this.comps.get(p);
      if (!c) return;
      if (c.kind === DUST) { if (dust) this.netDirty.add(c.net); } else this.compDirty.add(p);
    };
    mark(k);
    for (let d = 0; d < 6; d++) {
      const n = k + STEP[d];
      mark(n);
      for (let d2 = 0; d2 < 6; d2++) if (d2 !== OPP[d]) mark(n + STEP[d2]);
    }
  }

  /** Recomputes a dust network: power = max(input from non-dust neighbours, neighbour dust − 1). */
  private recompute(net: number) {
    const members = this.nets[net];
    const lvl = new Map<number, number>();
    const buckets: number[][] = Array.from({ length: 16 }, () => []);
    for (const m of members) { const s = this.bestSignal(m, true); lvl.set(m, s); buckets[s].push(m); }
    for (let p = 15; p > 1; p--) for (const m of buckets[p]) {
      if (lvl.get(m) !== p) continue;
      for (const o of this.comps.get(m)!.outs) if (lvl.get(o)! < p - 1) { lvl.set(o, p - 1); buckets[p - 1].push(o); }
    }
    for (const m of members) {
      const v = lvl.get(m)!;
      if (v === (this.power.get(m) ?? 0)) continue;
      if (v) this.power.set(m, v); else this.power.delete(m);
      this.touch(m, false);
    }
  }

  private settle() {
    for (const n of this.netDirty) this.recompute(n);
    this.netDirty.clear();
    const list = [...this.compDirty];
    this.compDirty.clear();
    for (const k of list) this.evaluate(k);
  }

  /** Neighbour update: diodes and torches schedule a tick, note blocks play on a rising edge. */
  private evaluate(k: number) {
    const c = this.comps.get(k)!;
    switch (c.kind) {
      case REPEATER: {
        if (this.locked(k, c)) return;
        const on = this.on.has(k);
        if (on !== this.input(k, c) > 0 && !this.dueNow.has(k)) this.schedule(k, c.delay, this.prioritized(k, c) ? PRIO_EXTREMELY_HIGH : on ? PRIO_VERY_HIGH : PRIO_HIGH);
        return;
      }
      case COMPARATOR:
        if (this.dueNow.has(k)) return;
        if (this.compare(k, c) !== (this.compOut.get(k) ?? 0) || this.on.has(k) !== this.comparatorOn(k, c)) this.schedule(k, 1, this.prioritized(k, c) ? PRIO_HIGH : PRIO_NORMAL);
        return;
      case TORCH:
        if (this.on.has(k) === this.torchInput(k, c) && !this.dueNow.has(k)) this.schedule(k, 1, PRIO_NORMAL);
        return;
      case NOTE: {
        const p = this.bestSignal(k, false) > 0;
        if (p === this.noteOn.has(k)) return;
        if (!p) { this.noteOn.delete(k); return; }
        this.noteOn.add(k);
        if (this.info(k + STEP[UP]).air) { const [x, y, z] = posFromKey(k); this.events.push({ tick: this.tick, x, y, z, instrument: c.instrument, note: c.note }); }
      }
    }
  }

  /** Scheduled tick. */
  private run(k: number) {
    const c = this.comps.get(k)!;
    switch (c.kind) {
      case REPEATER: {
        if (this.locked(k, c)) return;
        const on = this.on.has(k), want = this.input(k, c) > 0;
        if (on && !want) this.setOn(k, false);
        else if (!on) { this.setOn(k, true); if (!want) this.schedule(k, c.delay, PRIO_VERY_HIGH); }
        return;
      }
      case COMPARATOR: {
        const out = this.compare(k, c), prev = this.compOut.get(k) ?? 0;
        if (out) this.compOut.set(k, out); else this.compOut.delete(k);
        const want = this.comparatorOn(k, c);
        if (out !== prev || want !== this.on.has(k)) this.setOn(k, want);
        return;
      }
      case TORCH: {
        const input = this.torchInput(k, c);
        if (this.on.has(k) === input) this.setOn(k, !input);
        return;
      }
      case BUTTON:
        if (this.on.has(k)) this.setOn(k, false);
    }
  }

  private flush(): NoteEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
