import type { App } from '../app';
import { DATA_MC_VERSION } from '../blocks/data';
import { DEMOS } from '../demos/demos';
import { IMPORT_ACCEPT, MC_VERSIONS } from '../formats';
import { button, download, field, fmt, h, icon, modal, toast } from './dom';

export const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 29 10 16 17 3 10Z" fill="#6fd16a"/><path d="M3 10l13 7v12L3 22Z" fill="#8a5a33"/><path d="M29 10 16 17v12l13-7Z" fill="#6b4426"/><path d="M3 10l13 7v3L3 13Z" fill="#58b552"/><path d="M29 10 16 17v3l13-7Z" fill="#479a42"/><path d="M9 14l2 1v2l-2-1ZM21 19l2-1v2l-2 1Z" fill="#5c3a1f"/></svg>';

function menu(label: string, items: (HTMLElement | 'sep')[], right = false): HTMLElement {
  const m = h('div', { class: `menu ${right ? 'right' : ''}` }, items.map((i) => (i === 'sep' ? h('hr') : i)));
  const trigger = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'true', on: { click: (e: MouseEvent) => { e.stopPropagation(); const open = !m.classList.contains('open'); document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open')); m.classList.toggle('open', open); } } }, h('span', null, label), icon('chevron', 14));
  m.addEventListener('click', () => m.classList.remove('open'));
  return h('div', { class: 'menu-wrap' }, trigger, m);
}
document.addEventListener('click', () => document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open')));

function item(iconName: string, label: string, run: () => void, hint?: string, kbd?: string): HTMLElement {
  return h('button', { class: 'btn', type: 'button', on: { click: run } }, icon(iconName, 16), h('span', { class: 'grow' }, label, hint ? h('div', { class: 'hint' }, hint) : null), kbd ? h('kbd', null, kbd) : null);
}

export function exportDialog(app: App) {
  const d = app.exportDefaults();
  let format: 'litematic' | 'schem' = 'litematic';
  const name = h('input', { value: d.name, maxLength: 80 });
  const author = h('input', { value: d.author, maxLength: 60, placeholder: 'dein Name' });
  const desc = h('textarea', { rows: 2, maxLength: 400 }, d.description);
  const versions = MC_VERSIONS.some((v) => v.dataVersion === d.dataVersion) ? MC_VERSIONS : [{ label: `Original (${d.dataVersion})`, dataVersion: d.dataVersion }, ...MC_VERSIONS];
  const ver = h('select', null, versions.map((v) => h('option', { value: String(v.dataVersion), selected: v.dataVersion === d.dataVersion }, `Minecraft ${v.label}`)));
  const seg = h('div', { class: 'seg' });
  const segBtn = (f: typeof format, label: string) => h('button', { type: 'button', class: f === format ? 'on' : '', on: { click: () => { format = f; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === f)); note.textContent = notes[f]; } }, 'data-f': f }, label);
  seg.append(segBtn('litematic', '.litematic (Litematica)'), segBtn('schem', '.schem (WorldEdit)'));
  const notes = { litematic: 'Für Litematica (Fabric/Forge). Schematic-Version 7 ab MC 1.20.5, sonst 6 – wird automatisch gewählt.', schem: 'Sponge Schematic v2 – lesbar von WorldEdit, FAWE, Axiom und Amulet.' };
  const note = h('div', { class: 'field-hint' }, notes.litematic);
  const b = app.world.bounds();
  const size = b ? `${b.max[0] - b.min[0] + 1} × ${b.max[1] - b.min[1] + 1} × ${b.max[2] - b.min[2] + 1}` : '–';
  modal('Struktur exportieren', [
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), seg, note),
    field('Name', name),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Autor', author)), h('div', { class: 'grow' }, field('Zielversion', ver))),
    field('Beschreibung', desc),
    h('div', { class: 'notice info' }, icon('info', 16), h('span', null, `${size} Blöcke · ${fmt(app.world.blockCount())} gesetzt. Blöcke werden mit den Namen von MC ${DATA_MC_VERSION} gespeichert; neuere Versionen konvertieren beim Laden automatisch.`)),
  ], [
    { label: 'Abbrechen' },
    { label: 'Exportieren', primary: true, run: async () => {
      app.world.meta.name = name.value.trim() || 'Struktur';
      app.world.meta.author = author.value.trim();
      app.world.meta.description = desc.value.trim();
      app.saveMeta();
      await app.exportFile(format, { name: app.world.meta.name, author: app.world.meta.author, description: app.world.meta.description, dataVersion: Number(ver.value) });
    } },
  ]);
}

export function helpDialog() {
  const row = (a: string, b: string) => h('div', null, h('span', null, a), h('span', { class: 'muted', html: b }));
  modal('Steuerung & Tipps', [
    h('div', { class: 'shortcuts' },
      h('h4', null, 'Kamera'),
      row('Drehen', '<kbd>Linke Maus</kbd> ziehen'), row('Verschieben', '<kbd>Rechte Maus</kbd> ziehen'),
      row('Zoomen', '<kbd>Mausrad</kbd>'), row('Fliegen', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <kbd>Leertaste</kbd> <kbd>Shift</kbd>'),
      row('Schneller fliegen', '<kbd>Strg</kbd> halten'), row('Struktur zentrieren', '<kbd>F</kbd>'),
      h('h4', null, 'Bauen (Modus B)'),
      row('Block abbauen', '<kbd>Linksklick</kbd>'), row('Block platzieren', '<kbd>Rechtsklick</kbd> / <kbd>Shift</kbd>+Klick'),
      row('Block aufnehmen (Pipette)', '<kbd>Mittelklick</kbd> / <kbd>Alt</kbd>+Klick'), row('Hotbar', '<kbd>1</kbd>–<kbd>9</kbd>'),
      row('Rückgängig / Wiederholen', '<kbd>Strg</kbd>+<kbd>Z</kbd> / <kbd>Strg</kbd>+<kbd>Y</kbd>'), row('Modi', '<kbd>V</kbd> Ansehen · <kbd>B</kbd> Bauen · <kbd>G</kbd> Box'),
      h('h4', null, 'Box-Werkzeug (Modus G)'),
      row('Ecke auf Block', '<kbd>Linksklick</kbd>'), row('Ecke davor', '<kbd>Rechtsklick</kbd>'),
      row('Füllen / Leeren', '<kbd>Enter</kbd> / <kbd>Entf</kbd>'), row('Abbrechen', '<kbd>Esc</kbd>'),
      h('h4', null, 'Ebenen & Dateien'),
      row('Ebene hoch / runter', '<kbd>Bild↑</kbd> <kbd>Bild↓</kbd>'), row('Öffnen / Exportieren', '<kbd>Strg</kbd>+<kbd>O</kbd> / <kbd>Strg</kbd>+<kbd>S</kbd>'),
    ),
    h('p', { class: 'small muted', style: 'margin-top:14px' }, 'Dateien (.litematic, .schem, .nbt, Minecraft-.jar, Resourcepacks) kannst du auch einfach ins Fenster ziehen. Alles läuft lokal in deinem Browser – nichts wird hochgeladen.'),
    h('p', { class: 'small muted' }, 'Blockdaten: minecraft-data (MIT). LiteCraft ist kein offizielles Minecraft-Produkt und steht in keiner Verbindung zu Mojang oder Microsoft.'),
  ], [{ label: 'Alles klar', primary: true }], { wide: true });
}

export function texturesDialog(app: App) {
  const jarInput = h('input', { type: 'file', accept: '.jar,.zip', style: 'display:none' });
  const packInput = h('input', { type: 'file', accept: '.zip', multiple: true, style: 'display:none' });
  const list = h('div', { class: 'stack' });
  const progress = h('div', { class: 'progress', style: 'display:none' }, h('i'));
  const render = () => {
    list.innerHTML = '';
    const s = app.stack;
    if (!s.base && !s.overlays.length) list.append(h('div', { class: 'notice info' }, icon('palette', 16), h('span', null, 'Aktuell: eigene prozedurale Texturen. Für den Original-Look lade deine Minecraft-Client-.jar.')));
    if (s.base) list.append(h('div', { class: 'card row between' }, h('div', null, h('b', null, s.base.label), h('div', { class: 'small muted' }, `Minecraft-Jar · ${Object.keys(s.base.textures).length} Texturen · ${Object.keys(s.base.blockstates).length} Blockstates`)), button(null, 'trash', () => void app.removePack('base').then(render), { title: 'Entfernen', class: 'small' })));
    s.overlays.forEach((o, i) => list.append(h('div', { class: 'card row between' }, h('div', null, h('b', null, o.label), h('div', { class: 'small muted' }, `Resourcepack · ${Object.keys(o.textures).length} Texturen`)), button(null, 'trash', () => void app.removePack(i).then(render), { title: 'Entfernen', class: 'small' }))));
    if (app.packLoading) { progress.style.display = ''; (progress.firstChild as HTMLElement).style.width = `${Math.round(app.packLoading.progress * 100)}%`; }
    else progress.style.display = 'none';
  };
  const off = app.on('loading', render);
  const offT = app.on('textures', render);
  jarInput.addEventListener('change', () => { const f = jarInput.files?.[0]; if (f) void app.loadPack(f); jarInput.value = ''; });
  packInput.addEventListener('change', async () => { for (const f of Array.from(packInput.files ?? [])) await app.loadPack(f); packInput.value = ''; });
  render();
  const m = modal('Texturen & Resourcepacks', [
    h('p', { class: 'muted', style: 'margin-top:0' }, 'LiteCraft liest Texturen und Block-Modelle direkt aus deiner eigenen Minecraft-Installation. Die Dateien bleiben in deinem Browser (lokaler Cache) und werden nirgends hochgeladen.'),
    list, progress,
    h('div', { class: 'row', style: 'margin:12px 0 4px' }, button('Minecraft-Jar laden', 'cube', () => jarInput.click(), { class: 'primary' }), button('Resourcepack hinzufügen', 'palette', () => packInput.click(), { class: 'outline' })),
    h('details', { class: 'small muted', style: 'margin-top:10px' },
      h('summary', { style: 'cursor:pointer' }, 'Wo finde ich die Jar?'),
      h('ul', { style: 'padding-left:18px;line-height:1.7' },
        h('li', null, 'Prism Launcher: ', h('code', null, '~/.local/share/PrismLauncher/libraries/com/mojang/minecraft/<Version>/minecraft-<Version>-client.jar')),
        h('li', null, 'Offizieller Launcher: ', h('code', null, '.minecraft/versions/<Version>/<Version>.jar'), ' (Windows: ', h('code', null, '%appdata%\\.minecraft'), ')'),
        h('li', null, 'Resourcepacks: ', h('code', null, '.minecraft/resourcepacks/*.zip'), ' – werden über die Jar gelegt, HD bis 64×.'))),
    jarInput, packInput,
  ], [{ label: 'Fertig', primary: true }]);
  const obs = new MutationObserver(() => { if (!m.root.isConnected) { off(); offT(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

export function buildTopbar(app: App, toggles: { left: () => void; right: () => void }): HTMLElement {
  const fileInput = h('input', { type: 'file', accept: `${IMPORT_ACCEPT},.jar,.zip`, multiple: true, style: 'display:none' });
  fileInput.addEventListener('change', () => { if (fileInput.files?.length) void app.importFiles(fileInput.files); fileInput.value = ''; });
  app.ui.openFile = () => fileInput.click();

  const title = h('input', { class: 'title-input', value: app.world.meta.name, title: 'Name der Struktur', maxLength: 80, spellcheck: false });
  title.addEventListener('change', () => { app.world.meta.name = title.value.trim() || 'Unbenannt'; app.saveMeta(); });
  app.on('meta', () => { if (document.activeElement !== title) title.value = app.world.meta.name; });

  const fileMenu = menu('Datei', [
    item('file-plus', 'Neue Struktur', () => {
      if (!app.world.blockCount()) { app.newWorld(); return; }
      modal('Neue Struktur?', [h('p', { class: 'muted' }, 'Die aktuelle Struktur wird geleert. Exportiere sie vorher, wenn du sie behalten willst.')], [{ label: 'Abbrechen' }, { label: 'Leeren', primary: true, run: () => app.newWorld() }]);
    }),
    item('open', 'Öffnen…', () => fileInput.click(), '.litematic · .schem · .nbt', 'Strg O'),
    item('download', 'Exportieren…', () => exportDialog(app), '.litematic oder .schem', 'Strg S'),
    'sep',
    item('link', 'Link zum Teilen kopieren', async () => {
      const url = await app.shareLink();
      if (!url) return;
      try { await navigator.clipboard.writeText(url); toast('Link kopiert – die Struktur steckt komplett im Link.', 'ok'); }
      catch { modal('Link zum Teilen', [h('textarea', { class: 'input', rows: 4, readOnly: true }, url)]); }
    }, 'Struktur steckt im Link'),
    item('camera', 'Screenshot speichern', async () => download(await app.view.screenshot(), `${app.world.meta.name || 'litecraft'}.png`)),
    'sep',
    item('palette', 'Texturen & Resourcepacks…', () => texturesDialog(app)),
  ]);
  const demoMenu = menu('Beispiele', [
    h('div', { class: 'menu-title' }, 'Beispiel-Strukturen'),
    ...DEMOS.map((d) => h('button', { class: 'btn demo-item', type: 'button', on: { click: () => app.loadDemo(d.id) } }, h('span', { class: 'd-name' }, d.name), h('span', { class: 'd-desc' }, d.description))),
  ]);

  const badge = h('button', { class: 'pack-badge hide-narrow', type: 'button', title: 'Texturen verwalten', on: { click: () => texturesDialog(app) } }, h('span', { class: 'dot' }), h('span', { class: 'lbl' }));
  const renderBadge = () => {
    const label = app.packLabel();
    badge.classList.toggle('on', !!label);
    (badge.querySelector('.lbl') as HTMLElement).textContent = app.packLoading ? `Lade ${Math.round(app.packLoading.progress * 100)} %…` : label || 'Prozedurale Texturen';
  };
  app.on('textures', renderBadge);
  app.on('loading', renderBadge);
  renderBadge();

  const undo = h('button', { class: 'icon-btn', type: 'button', title: 'Rückgängig (Strg+Z)', on: { click: () => app.undo() } }, icon('undo'));
  const redo = h('button', { class: 'icon-btn', type: 'button', title: 'Wiederholen (Strg+Y)', on: { click: () => app.redo() } }, icon('redo'));
  const hist = () => { undo.disabled = !app.history.canUndo; redo.disabled = !app.history.canRedo; };
  app.on('history', hist);
  hist();

  return h('header', { class: 'topbar glass' },
    h('div', { class: 'brand' }, h('span', { class: 'logo', html: LOGO }), h('span', { class: 'word' }, 'Lite', h('b', null, 'Craft')), h('span', { class: 'tag' }, 'beta')),
    fileMenu, demoMenu,
    h('div', { class: 'sep hide-narrow' }),
    title,
    h('div', { class: 'spacer' }),
    badge,
    undo, redo,
    h('div', { class: 'sep' }),
    h('button', { class: 'icon-btn', type: 'button', title: 'Block-Palette ein/aus', on: { click: toggles.left } }, icon('panel-left')),
    h('button', { class: 'icon-btn', type: 'button', title: 'Seitenleiste ein/aus', on: { click: toggles.right } }, icon('panel-right')),
    h('button', { class: 'icon-btn', type: 'button', title: 'Hilfe (H)', on: { click: helpDialog } }, icon('help')),
    fileInput,
  );
}
