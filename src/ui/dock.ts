import type { App, Mode } from '../app';
import { fmt, h, icon } from './dom';

export function buildDock(app: App): { elements: HTMLElement[]; frame: () => void } {
  // ---- modes + hotbar
  const modes: [Mode, string, string, string][] = [['view', 'eye', 'Ansehen', 'V'], ['build', 'hammer', 'Bauen', 'B'], ['box', 'box', 'Box', 'G']];
  const modeBtns = modes.map(([m, ic, label, key]) => h('button', { class: 'mode', type: 'button', title: `${label} (${key})`, on: { click: () => app.setMode(m) } }, icon(ic, 19), h('span', null, label)));
  const slots = Array.from({ length: 9 }, (_, i) => {
    const c = h('canvas');
    const el = h('button', { class: 'slot', type: 'button', title: `Slot ${i + 1}`, on: { click: () => { app.setSlot(i); if (app.mode === 'view') app.setMode('build'); } } }, h('span', { class: 'n' }, String(i + 1)), c);
    return { el, c };
  });
  const renderModes = () => modeBtns.forEach((b, i) => b.classList.toggle('on', modes[i][0] === app.mode));
  const renderHotbar = () => slots.forEach((s, i) => {
    app.icons.paint(s.c, app.hotbar[i], 32);
    s.el.classList.toggle('on', i === app.hotIndex);
    s.el.title = `${i + 1}: ${app.hotbar[i].replace('minecraft:', '').split('[')[0]}`;
  });
  app.on('mode', renderModes);
  app.on('selected', renderHotbar);
  app.on('textures', renderHotbar);
  renderModes();
  renderHotbar();
  const dock = h('div', { class: 'dock glass' }, h('div', { class: 'modes' }, modeBtns), h('div', { class: 'hotbar' }, slots.map((s) => s.el)));

  // ---- status line
  const status = h('div', { class: 'status glass' });
  const HINTS: Record<Mode, string> = {
    view: 'Linke Maus: drehen · Rechte Maus: verschieben · Mittelklick: Block aufnehmen',
    build: '<b>Rechtsklick</b> platzieren · <b>Linksklick</b> abbauen · <b>Mittelklick</b> Pipette',
    box: '<b>Linksklick</b>: Ecke auf Block · <b>Rechtsklick</b>: Ecke davor · <b>Enter</b> füllen · <b>Entf</b> leeren',
    afk: '<b>Klicke</b> auf den Block, auf dem du AFK stehst',
  };
  const renderStatus = () => {
    const hit = app.hover;
    if (hit && !hit.floor) {
      const info = app.reg.info(hit.id);
      status.innerHTML = '';
      status.append(h('span', { class: 'coords' }, `${hit.x} ${hit.y} ${hit.z}`), h('b', null, info.display), h('span', null, '·'), h('span', { html: HINTS[app.mode] }));
    } else status.innerHTML = HINTS[app.mode];
  };
  app.on('hover', renderStatus);
  app.on('mode', renderStatus);
  renderStatus();

  // ---- compass
  const needle = h('div', { class: 'needle' }, h('span', { class: 'N' }, 'N'), h('span', { class: 'E' }, 'O'), h('span', { class: 'S' }, 'S'), h('span', { class: 'W' }, 'W'));
  const compass = h('button', { class: 'compass glass', type: 'button', title: 'Blick nach Norden', on: { click: () => {
    const v = app.view, t = v.controls.target, d = v.camera.position.distanceTo(t), y = v.camera.position.y - t.y;
    const hd = Math.sqrt(Math.max(0, d * d - y * y));
    v.camera.position.set(t.x, v.camera.position.y, t.z + hd);
    v.controls.update();
  } } }, needle);

  // ---- box bar
  const dims = h('span', { class: 'dims' });
  const boxbar = h('div', { class: 'boxbar glass', style: 'display:none' },
    dims,
    h('button', { class: 'btn small primary', type: 'button', title: 'Mit ausgewähltem Block füllen (Enter)', on: { click: () => app.fillBox('fill') } }, icon('cube', 15), h('span', null, 'Füllen')),
    h('button', { class: 'btn small', type: 'button', title: 'Nur die Hülle füllen', on: { click: () => app.fillBox('hollow') } }, icon('frame', 15), h('span', null, 'Hohl')),
    h('button', { class: 'btn small', type: 'button', title: 'Vorhandene Blöcke ersetzen (den Block unter dem Cursor, sonst alle)', on: { click: () => app.fillBox('replace') } }, icon('replace', 15), h('span', null, 'Ersetzen')),
    h('button', { class: 'btn small danger', type: 'button', title: 'Leeren (Entf)', on: { click: () => app.fillBox('clear') } }, icon('trash', 15), h('span', null, 'Leeren')),
    h('button', { class: 'icon-btn', type: 'button', title: 'Auswahl aufheben (Esc)', on: { click: () => app.clearBox() } }, icon('x', 16)));
  const renderBox = () => {
    const bb = app.boxBounds();
    const show = app.mode === 'box' && (!!bb || !!app.box.a);
    boxbar.style.display = show ? '' : 'none';
    status.style.display = show ? 'none' : '';
    if (bb) {
      const s = [bb.max[0] - bb.min[0] + 1, bb.max[1] - bb.min[1] + 1, bb.max[2] - bb.min[2] + 1];
      dims.textContent = `${s.join(' × ')} = ${fmt(s[0] * s[1] * s[2])}`;
      boxbar.querySelectorAll('button').forEach((b) => (b.style.display = ''));
    } else if (app.box.a) {
      dims.textContent = 'Zweite Ecke wählen…';
      boxbar.querySelectorAll('button.btn').forEach((b) => ((b as HTMLElement).style.display = 'none'));
    }
  };
  app.on('box', renderBox);
  app.on('mode', renderBox);

  // ---- timelapse HUD
  const clock = h('span', { class: 'clock' });
  const harvested = h('span', { class: 'muted' });
  const speed = h('select', { title: 'Geschwindigkeit' }, [50, 200, 1000, 5000, 20000].map((s) => h('option', { value: String(s), selected: s === 200 }, `×${fmt(s)}`)));
  speed.addEventListener('change', () => { if (app.sim.timelapse) app.sim.timelapse.speed = Number(speed.value); });
  const pause = h('button', { class: 'icon-btn', type: 'button', title: 'Pause', on: { click: () => { const t = app.sim.timelapse; if (t) { t.paused = !t.paused; pause.replaceChildren(icon(t.paused ? 'play' : 'pause', 16)); } } } }, icon('pause', 16));
  const hud = h('div', { class: 'hud glass', style: 'display:none' }, icon('sprout', 16), clock, harvested, speed, pause,
    h('button', { class: 'btn small', type: 'button', on: { click: () => app.sim.stopTimelapse() } }, icon('stop', 14), h('span', null, 'Stopp')));
  app.on('loading', () => {
    hud.style.display = app.sim.timelapse ? '' : 'none';
    if (app.sim.timelapse) { app.sim.timelapse.speed = Number(speed.value); pause.replaceChildren(icon('pause', 16)); }
  });

  let lastHud = 0;
  const frame = () => {
    const yaw = app.view.yaw();
    needle.style.transform = `rotate(${-yaw}deg)`;
    const t = app.sim.timelapse;
    const now = performance.now();
    if (t && now - lastHud > 120) {
      lastHud = now;
      const s = Math.floor(t.engine.time / 20);
      clock.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      harvested.textContent = [...t.harvested].slice(0, 3).map(([k, v]) => `${fmt(v)} ${k}`).join(' · ') || 'wächst…';
    }
  };

  return { elements: [dock, status, compass, boxbar, hud], frame };
}
