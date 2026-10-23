import * as THREE from 'three';
import type { App } from '../app';
import { toast } from '../ui/dom';
import { breakChanges, placeChanges } from './placement';
import { FACE_NORMALS, type Hit, pickBoxes, raycast } from './raycast';

const CLICK_PX = 6, CLICK_MS = 450;

export class Editor {
  private down: { x: number; y: number; t: number; button: number } | null = null;
  private pointer: { x: number; y: number; shift: boolean } | null = null;
  private dirty = true;
  private ray = new THREE.Raycaster();
  private prevMode: App['mode'] = 'view';

  constructor(private app: App) {
    const c = app.canvas;
    c.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button }; c.focus(); });
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointermove', (e) => { this.pointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey }; this.dirty = true; });
    c.addEventListener('pointerleave', () => { this.pointer = null; this.dirty = true; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('auxclick', (e) => e.preventDefault());
    c.tabIndex = 0;
    app.view.controls.addEventListener('change', () => { this.dirty = true; });
    for (const ev of ['mode', 'world', 'selected', 'layer', 'box'] as const) app.on(ev, () => { this.dirty = true; });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => app.view.keys.clear());
    window.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (this.typing(e.target) || !text.trim()) return;
      e.preventDefault();
      app.pasteText(text);
    });
    window.addEventListener('copy', (e) => {
      if (this.typing(e.target) || window.getSelection()?.toString()) return;
      const text = app.selectionClip();
      if (!text) { toast('Zum Kopieren erst mit dem Box-Werkzeug (G) einen Bereich auswählen.', 'info', 2600); return; }
      e.preventDefault();
      e.clipboardData?.setData('text/plain', text);
      toast('Auswahl kopiert – mit Strg+V einfügen (auch in anderen Tabs).', 'ok', 2600);
    });
  }

  private typing(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!document.querySelector('.modal-root'));
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.refreshHover();
  }

  private cast(cx: number, cy: number): Hit | null {
    const r = this.app.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.app.view.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const floor = this.app.mode === 'view' ? null : this.app.view.gridY;
    return raycast(this.app.world, this.app.reg, [o.x, o.y, o.z], [d.x, d.y, d.z], 1500, (x, y) => this.app.isVisible(x, y), floor);
  }

  private look(): number[] {
    const d = new THREE.Vector3();
    this.app.view.camera.getWorldDirection(d);
    return [d.x, d.y, d.z];
  }

  private adjacent(h: Hit): [number, number, number] {
    const n = FACE_NORMALS[h.face];
    return [h.x + n[0], h.y + n[1], h.z + n[2]];
  }

  private boxCorner(h: Hit, adjacent: boolean): [number, number, number] {
    return adjacent || h.floor ? this.adjacent(h) : [h.x, h.y, h.z];
  }

  private refreshHover() {
    const app = this.app, v = app.view;
    const h = this.pointer ? this.cast(this.pointer.x, this.pointer.y) : null;
    app.hover = h;
    v.hover.visible = false;
    v.ghost.visible = false;
    if (h && !h.floor) {
      const boxes = pickBoxes(app.reg.info(h.id));
      const mn = [16, 16, 16], mx = [0, 0, 0];
      for (const b of boxes) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b[i]); mx[i] = Math.max(mx[i], b[i + 3]); }
      if (!boxes.length) { mn.fill(0); mx.fill(16); }
      v.hover.position.set(h.x + (mn[0] + mx[0]) / 32, h.y + (mn[1] + mx[1]) / 32, h.z + (mn[2] + mx[2]) / 32);
      v.hover.scale.set((mx[0] - mn[0]) / 16 + 0.006, (mx[1] - mn[1]) / 16 + 0.006, (mx[2] - mn[2]) / 16 + 0.006);
      v.hover.visible = true;
    }
    if (h && (app.mode === 'build' || app.mode === 'afk')) {
      let pos: [number, number, number] | null = null;
      if (app.mode === 'afk') pos = this.adjacent(h);
      else { const ch = placeChanges(app.world, app.reg, app.selected, h, this.look()); if (ch.length) pos = [ch[0].x, ch[0].y, ch[0].z]; }
      if (pos) {
        v.ghost.position.set(pos[0] + 0.5, pos[1] + (app.mode === 'afk' ? 0.9 : 0.5), pos[2] + 0.5);
        v.ghost.scale.set(app.mode === 'afk' ? 0.6 : 1.002, app.mode === 'afk' ? 1.8 : 1.002, app.mode === 'afk' ? 0.6 : 1.002);
        (v.ghost.material as THREE.MeshBasicMaterial).color.set(app.mode === 'afk' ? 0x38bdf8 : 0xffffff);
        v.ghost.visible = true;
      }
    }
    this.updateSelection();
    app.emit('hover');
  }

  private updateSelection() {
    const app = this.app, sel = app.view.selection;
    const a = app.box.a;
    let b = app.box.b;
    if (app.mode === 'box' && a && !b && app.hover) b = this.boxCorner(app.hover, !!this.pointer?.shift);
    if (!a || !b) { sel.visible = false; return; }
    const mn = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
    const mx = [Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1, Math.max(a[2], b[2]) + 1];
    sel.position.set((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
    sel.scale.set(mx[0] - mn[0] + 0.01, mx[1] - mn[1] + 0.01, mx[2] - mn[2] + 0.01);
    sel.visible = true;
  }

  private onUp(e: PointerEvent) {
    const d = this.down;
    this.down = null;
    if (!d || d.button !== e.button) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX || performance.now() - d.t > CLICK_MS) return;
    const app = this.app;
    const h = this.cast(e.clientX, e.clientY);
    if (!h) return;
    const button = e.button === 0 && e.altKey ? 1 : e.button === 0 && e.shiftKey && app.mode === 'build' ? 2 : e.button;
    if (button === 1) { this.pick(h); return; }
    switch (app.mode) {
      case 'view':
        if (button === 0 && !h.floor) app.redstone.interact(h.x, h.y, h.z);
        break;
      case 'build':
        if (button === 0 && !h.floor) app.edit(breakChanges(app.world, app.reg, h.x, h.y, h.z));
        else if (button === 2) app.edit(placeChanges(app.world, app.reg, app.selected, h, this.look()));
        break;
      case 'box': {
        const corner = this.boxCorner(h, button === 2);
        if (app.box.a && !app.box.b) app.box.b = corner;
        else app.box = { a: corner, b: null };
        app.emit('box');
        break;
      }
      case 'afk':
        app.sim.setAfk(this.adjacent(h));
        app.setMode(this.prevMode === 'afk' ? 'view' : this.prevMode);
        toast('AFK-Punkt gesetzt', 'ok', 1800);
        break;
    }
    this.dirty = true;
  }

  enterAfkMode() {
    this.prevMode = this.app.mode === 'afk' ? 'view' : this.app.mode;
    this.app.setMode('afk');
    toast('Klicke auf den Block, auf dem der Spieler AFK steht.', 'info', 3500);
  }

  private pick(h: Hit) {
    if (h.floor || !h.id) return;
    const key = this.app.world.palette[h.id].key;
    this.app.select(key);
    toast(`${this.app.reg.info(h.id).display} ausgewählt`, 'info', 1400);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (this.typing(e.target)) return;
    const app = this.app;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', ' ', 'shift', 'control'].includes(k) && !e.metaKey && !(e.ctrlKey && k !== 'control')) {
      if (down) app.view.keys.add(k); else app.view.keys.delete(k);
      if (k === ' ') e.preventDefault();
      if (k === 'shift' && this.pointer) { this.pointer.shift = down; this.dirty = true; }
      if (k !== 'shift' && k !== 'control') return;
    }
    if (!down) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); app.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); app.ui.exportDialog?.(); return; }
    if (mod && k === 'o') { e.preventDefault(); app.ui.openFile?.(); return; }
    if (mod) return;
    if (k >= '1' && k <= '9') { app.setSlot(Number(k) - 1); return; }
    switch (k) {
      case 'b': app.setMode('build'); break;
      case 'v': app.setMode('view'); break;
      case 'g': app.setMode('box'); break;
      case 'escape': if (app.box.a) app.clearBox(); else app.setMode('view'); break;
      case 'f': app.view.fit(app.world.bounds(), true); break;
      case 'pageup': case ']': this.layerStep(1); e.preventDefault(); break;
      case 'pagedown': case '[': this.layerStep(-1); e.preventDefault(); break;
      case 'enter': if (app.mode === 'box' && app.box.b) app.fillBox('fill'); break;
      case 'delete': case 'backspace': if (app.mode === 'box' && app.box.b) app.fillBox('clear'); break;
      case 'h': case '?': case 'f1': e.preventDefault(); app.ui.help?.(); break;
    }
  }

  private layerStep(d: number) {
    const app = this.app;
    const mode = app.layer.mode === 'all' ? 'below' : app.layer.mode;
    app.setLayer(mode, app.layer.y + d);
  }
}
