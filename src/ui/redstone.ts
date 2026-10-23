import type { App } from '../app';
import { INSTRUMENT_COUNT, soundsFromFolder, soundsFromMojang, soundsFromZip, type SoundFiles } from '../sim/noteaudio';
import { button, fmt, h, icon, modal, setChildren, toast } from './dom';

const SPEEDS: [number, string][] = [[0.5, '0,5×'], [1, '1×'], [2, '2×']];

function speedSelect(app: App, attrs: Record<string, string> = {}): HTMLSelectElement {
  const s = h('select', { title: 'Geschwindigkeit', ...attrs }, SPEEDS.map(([v, l]) => h('option', { value: String(v), selected: v === app.redstone.speed }, l)));
  s.addEventListener('change', () => app.redstone.setSpeed(Number(s.value)));
  app.on('redstone', () => { s.value = String(app.redstone.speed); });
  return s;
}

const SYNTH_LABEL = 'Synth-Klänge – Original-Sounds laden?';

/** Floating HUD while redstone is playing (tick, time, speed, sound source, stop). */
export function buildRedstoneHud(app: App): { el: HTMLElement; frame: () => void } {
  const clock = h('span', { class: 'clock' });
  const sound = h('button', { class: 'btn small', type: 'button', on: { click: () => soundDialog(app) } });
  const el = h('div', { class: 'hud glass', style: 'display:none' }, icon('music', 16), clock, speedSelect(app), sound,
    h('button', { class: 'btn small', type: 'button', title: 'Simulation beenden und zurücksetzen', on: { click: () => app.redstone.stop() } }, icon('stop', 14), h('span', null, 'Stopp')));
  app.on('redstone', () => {
    const r = app.redstone;
    el.style.display = r.running ? '' : 'none';
    clock.title = app.song?.title ?? 'Redstone';
    sound.textContent = r.audio.label ? '♪ Original-Sounds' : SYNTH_LABEL;
    sound.title = r.audio.label ? `Original-Notenblock-Klänge (${r.audio.label})` : 'Original-Klänge einmalig laden (Assets-Ordner, Zip oder Mojang)';
  });
  let last = 0;
  const frame = () => {
    const r = app.redstone;
    const now = performance.now();
    if (!r.running || now - last < 100) return;
    last = now;
    if (r.loading !== null || !r.sim) { clock.textContent = `Lade Sounds … ${Math.round((r.loading ?? 0) * 100)} %`; return; }
    const t = r.clockTick;
    clock.textContent = `Tick ${t} · ${fmt(t / 10, 1)} s`;
  };
  return { el, frame };
}

/** "Redstone & Notenblöcke" section of the simulation tab. */
export function redstoneSection(app: App): { el: HTMLElement; refresh: () => void } {
  const info = h('div', { class: 'stack' });
  const sound = h('div');
  const play = h('button', { class: 'btn primary', type: 'button', on: { click: () => { if (app.redstone.running) app.redstone.stop(); else void app.redstone.play(); } } });
  let counts = { notes: 0, switches: 0, redstone: 0 };

  const render = () => {
    const r = app.redstone, song = app.song;
    setChildren(play, icon(r.running ? 'stop' : 'play'), h('span', null, r.running ? 'Stoppen' : 'Abspielen'));
    const len = (song?.schedule ?? []).reduce((m, s) => Math.max(m, s.tick), 0) / 10;
    setChildren(info,
      song ? h('div', { class: 'card' }, h('b', null, song.title ?? 'Notenblock-Song'),
        h('div', { class: 'small muted' }, [song.bpm ? `${fmt(song.bpm)} BPM` : '', song.schedule ? `${fmt(song.schedule.length)} Noten` : '', len ? `${fmt(len, 1)} s` : ''].filter(Boolean).join(' · '))) : null,
      h('div', { class: 'small muted' }, `${fmt(counts.notes)} Notenblöcke · ${fmt(counts.switches)} Knöpfe/Hebel · ${fmt(counts.redstone)} Redstone-Bauteile`),
      r.running && r.log.length ? h('div', { class: 'small' }, `${fmt(r.log.length)} Noten gespielt`) : null);
    setChildren(sound, r.audio.label
      ? h('div', { class: 'notice ok' }, icon('music', 16), h('span', null, `Original-Notenblock-Klänge (${r.audio.label}, ${r.audio.count}/${INSTRUMENT_COUNT})`))
      : h('div', { class: 'notice info' }, icon('music', 16), h('span', { class: 'grow' }, SYNTH_LABEL), button('Laden…', null, () => soundDialog(app), { class: 'small' })));
  };
  const refresh = () => {
    if (!app.locked) {
      counts = { notes: 0, switches: 0, redstone: 0 };
      app.world.forEach((_x, _y, _z, id) => {
        const s = app.reg.info(id).short;
        if (s === 'note_block') counts.notes++;
        else if (s === 'lever' || s.endsWith('_button')) counts.switches++;
        else if (/^(redstone_wire|repeater|comparator|redstone_torch|redstone_wall_torch|redstone_block)$/.test(s)) counts.redstone++;
      });
    }
    render();
  };
  app.on('redstone', render);
  const el = h('div', { class: 'section' }, h('h3', null, icon('music', 14), 'Redstone & Notenblöcke'),
    info,
    h('div', { class: 'row', style: 'margin:10px 0' }, play, speedSelect(app, { class: 'input', style: 'width:84px' })),
    sound,
    h('p', { class: 'small muted' }, 'Echte Redstone-Simulation nach Java-Regeln (1 Redstone-Tick = 0,1 s): Knöpfe, Hebel, Redstone, Repeater mit Sperre, Komparatoren, Fackeln und Notenblöcke. Im Ansehen-Modus kannst du Knöpfe und Hebel direkt anklicken.'));
  return { el, refresh };
}

/** Loading the original note block sounds once (assets folder, zip or Mojang), cached in the browser. */
export function soundDialog(app: App) {
  const audio = app.redstone.audio;
  const status = h('div');
  const progress = h('div', { class: 'progress', style: 'display:none' }, h('i'));
  const folder = h('input', { type: 'file', webkitdirectory: true, style: 'display:none' });
  const zip = h('input', { type: 'file', accept: '.zip,.jar', style: 'display:none' });
  const render = () => setChildren(status, audio.label
    ? h('div', { class: 'notice ok' }, icon('check', 16), h('span', null, `Aktiv: Original-Klänge aus „${audio.label}“ (${audio.count} von ${INSTRUMENT_COUNT} Instrumenten).`))
    : h('div', { class: 'notice info' }, icon('music', 16), h('span', null, 'Aktiv: Synth-Klänge (Ersatz).')));
  const load = async (label: string, get: (p: (v: number) => void) => Promise<SoundFiles>) => {
    const bar = progress.firstChild as HTMLElement;
    progress.style.display = '';
    bar.style.width = '0%';
    try {
      const n = await audio.use(await get((v) => { bar.style.width = `${Math.round(v * 100)}%`; }), label);
      if (n) toast(`${n} von ${INSTRUMENT_COUNT} Notenblock-Klängen geladen und im Browser gespeichert.`, 'ok', 5000);
      else toast('Keine Notenblock-Sounds gefunden. Wähle den „assets“-Ordner deines Launchers oder ein Resourcepack mit assets/minecraft/sounds/note/.', 'warn', 8000);
    } catch (e) {
      toast(`Laden fehlgeschlagen: ${(e as Error).message}`, 'error', 8000);
    } finally {
      progress.style.display = 'none';
      render();
      app.emit('redstone');
    }
  };
  folder.addEventListener('change', () => {
    const files = Array.from(folder.files ?? []);
    folder.value = '';
    if (files.length) void load('Assets-Ordner', (p) => soundsFromFolder(files, p));
  });
  zip.addEventListener('change', () => {
    const f = zip.files?.[0];
    zip.value = '';
    if (f) void load(f.name.replace(/\.(zip|jar)$/i, ''), async () => soundsFromZip(new Uint8Array(await f.arrayBuffer())));
  });
  render();
  const off = app.on('redstone', render);
  const m = modal('Notenblock-Klänge', [
    h('p', { class: 'muted', style: 'margin-top:0' }, 'Die Original-Klänge gehören Mojang und werden nicht mitgeliefert. Mojangs Download-Server erlaubt keinen direkten Abruf aus dem Browser (CORS) – wähle deshalb einmalig den Assets-Ordner deines Launchers oder ein Resourcepack mit Notenblock-Sounds. Gelesen werden nur die 16 Notenblock-Dateien; sie bleiben lokal im Browser gespeichert.'),
    status, progress,
    h('div', { class: 'row wrap', style: 'margin:12px 0 4px' },
      button('Assets-Ordner wählen…', 'open', () => folder.click(), { class: 'primary' }),
      button('Resourcepack/Zip…', 'package', () => zip.click(), { class: 'outline' }),
      button('Von Mojang laden', 'sparkles', () => void load('Mojang', (p) => soundsFromMojang(p, AbortSignal.timeout(20_000))), { class: 'outline' }),
      button(null, 'trash', async () => { await audio.forget(); render(); app.emit('redstone'); }, { class: 'small', title: 'Gespeicherte Original-Klänge entfernen' })),
    h('details', { class: 'small muted', style: 'margin-top:10px' },
      h('summary', { style: 'cursor:pointer' }, 'Wo ist der Assets-Ordner?'),
      h('ul', { style: 'padding-left:18px;line-height:1.7' },
        h('li', null, 'Prism Launcher: ', h('code', null, '~/.local/share/PrismLauncher/assets')),
        h('li', null, 'Offizieller Launcher: ', h('code', null, '.minecraft/assets'), ' (Windows: ', h('code', null, '%appdata%\\.minecraft\\assets'), ')'),
        h('li', null, 'Darin liegen ', h('code', null, 'indexes/'), ' und ', h('code', null, 'objects/'), ' – der Browser fragt nach dem Hochladen, es wird aber nichts hochgeladen.'))),
    folder, zip,
  ], [{ label: 'Fertig', primary: true }]);
  const obs = new MutationObserver(() => { if (!m.root.isConnected) { off(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}
