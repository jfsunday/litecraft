import type { App, LayerMode } from '../app';
import { prettyName } from '../blocks/colors';
import { MC_VERSIONS } from '../formats';
import { PLANT_LABEL } from '../sim/plants';
import { CATEGORIES, catalog, type CatalogEntry } from './catalog';
import { button, field, fmt, h, icon, setChildren, toast } from './dom';
import { texturesDialog } from './topbar';

// ---------------------------------------------------------------------------- palette

export function buildPalette(app: App): HTMLElement {
  const entries = catalog();
  let cat = localStorage.getItem('litecraft-cat') ?? 'Alle';
  let query = '';
  const body = h('div', { class: 'panel-body' });
  const grid = h('div', { class: 'block-grid' });
  const count = h('span', { class: 'grid-count' });
  const tiles = new Map<string, { el: HTMLElement; canvas: HTMLCanvasElement; painted: boolean; entry: CatalogEntry }>();
  const io = new IntersectionObserver((list) => {
    for (const e of list) {
      if (!e.isIntersecting) continue;
      const t = tiles.get((e.target as HTMLElement).dataset.key!);
      if (t && !t.painted) { app.icons.paint(t.canvas, t.entry.key, 36); t.painted = true; }
      io.unobserve(e.target);
    }
  }, { root: body, rootMargin: '160px' });

  const selCanvas = h('canvas');
  const selName = h('div', { class: 'sc-name' });
  const selId = h('div', { class: 'sc-id' });
  const renderSelected = () => {
    const key = app.selected;
    app.icons.paint(selCanvas, key, 40);
    const short = key.slice(key.indexOf(':') + 1).split('[')[0];
    selName.textContent = entries.find((e) => e.short === short)?.display ?? prettyName(short);
    selId.textContent = key.replace('minecraft:', '');
    for (const t of tiles.values()) t.el.classList.toggle('on', t.entry.short === short);
  };

  const tileFor = (e: CatalogEntry) => {
    let t = tiles.get(e.key);
    if (!t) {
      const canvas = h('canvas');
      const el = h('button', { class: 'tile', type: 'button', title: `${e.display}\n${e.short}`, 'data-key': e.key, on: { click: () => app.select(e.key) } }, canvas);
      t = { el, canvas, painted: false, entry: e };
      tiles.set(e.key, t);
    }
    return t;
  };

  const renderGrid = () => {
    const q = query.trim().toLowerCase();
    const qid = q.replace(/\s+/g, '_');
    const list = entries.filter((e) => (cat === 'Alle' || e.cats.includes(cat)) && (!q || e.display.toLowerCase().includes(q) || e.short.includes(qid)));
    setChildren(grid);
    for (const e of list) {
      const t = tileFor(e);
      grid.append(t.el);
      if (!t.painted) io.observe(t.el);
    }
    count.textContent = `${list.length} Blöcke`;
    if (!list.length) grid.append(h('div', { class: 'grid-empty', style: 'grid-column: 1 / -1' }, 'Nichts gefunden.'));
    renderSelected();
  };

  const chips = h('div', { class: 'chips' }, CATEGORIES.map((c) => h('button', { class: `chip ${c === cat ? 'on' : ''}`, type: 'button', on: { click: (ev: MouseEvent) => { cat = c; localStorage.setItem('litecraft-cat', c); chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); (ev.currentTarget as HTMLElement).classList.add('on'); renderGrid(); body.scrollTop = 0; } } }, c)));
  const search = h('input', { type: 'search', placeholder: 'Blöcke suchen… (z. B. stairs, glass)', 'aria-label': 'Blöcke suchen' });
  search.addEventListener('input', () => { query = search.value; renderGrid(); });

  app.on('selected', renderSelected);
  app.on('textures', () => {
    for (const t of tiles.values()) { t.painted = false; if (t.el.isConnected) io.observe(t.el); }
    renderSelected();
  });

  body.append(grid);
  renderGrid();
  return h('aside', { class: 'panel left glass' },
    h('div', { class: 'panel-head' },
      h('div', { class: 'selected-card' }, selCanvas, h('div', { class: 'grow' }, selName, selId)),
      h('div', { class: 'search' }, icon('search', 16), search),
      chips,
      h('div', { class: 'row between' }, h('span', { class: 'panel-title' }, 'Blöcke'), count)),
    body);
}

// ---------------------------------------------------------------------------- right panel

interface Tab { id: string; label: string; icon: string; el: HTMLElement; refresh?: () => void; on: string[] }

const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, h('span', null, label, hint ? h('div', { class: 'field-hint' }, hint) : null), input, h('span', { class: 'sw' }));
};

function seg<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement & { set: (v: T) => void } {
  const el = h('div', { class: 'seg' }) as unknown as HTMLElement & { set: (v: T) => void };
  const btns = options.map(([v, label]) => h('button', { type: 'button', class: v === value ? 'on' : '', on: { click: () => { el.set(v); onChange(v); } } }, label));
  el.append(...btns);
  el.set = (v: T) => btns.forEach((b, i) => b.classList.toggle('on', options[i][0] === v));
  return el;
}

function versionLabel(dv: number): string {
  if (!dv) return '–';
  const exact = MC_VERSIONS.find((v) => v.dataVersion === dv);
  if (exact) return `MC ${exact.label}`;
  const older = MC_VERSIONS.find((v) => v.dataVersion < dv);
  return older ? `neuer als MC ${older.label} (${dv})` : `DataVersion ${dv}`;
}

const SOURCE: Record<string, string> = { new: 'Neu erstellt', litematic: 'Litematica (.litematic)', schem: 'WorldEdit (.schem)', nbt: 'Strukturblock (.nbt)', demo: 'Beispiel' };

function infoTab(app: App): Tab {
  const name = h('input', { maxLength: 80 }), author = h('input', { maxLength: 60, placeholder: 'dein Name' }), desc = h('textarea', { rows: 2, maxLength: 400, placeholder: 'Wofür ist die Struktur?' });
  const bindMeta = () => { name.value = app.world.meta.name; author.value = app.world.meta.author; desc.value = app.world.meta.description; };
  for (const [el, key] of [[name, 'name'], [author, 'author'], [desc, 'description']] as const) el.addEventListener('change', () => { app.world.meta[key] = el.value.trim(); app.saveMeta(); });
  const stats = h('div', { class: 'stats' });
  const hover = h('div', { class: 'card' });
  const refreshStats = () => {
    const b = app.world.bounds();
    const size = b ? [b.max[0] - b.min[0] + 1, b.max[1] - b.min[1] + 1, b.max[2] - b.min[2] + 1] : [0, 0, 0];
    const stat = (v: string, l: string, cls = '') => h('div', { class: `stat ${cls}` }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    setChildren(stats, 
      stat(size.join(' × '), 'Breite × Höhe × Länge', 'big accent'),
      stat(fmt(app.world.blockCount()), 'Blöcke'),
      stat(fmt(size[0] * size[1] * size[2]), 'Volumen'),
      stat(String(app.world.entities.length), 'Entities'),
      stat(SOURCE[app.world.meta.source] ?? app.world.meta.source, versionLabel(app.world.meta.dataVersion)),
    );
  };
  const refreshHover = () => {
    const hit = app.hover;
    if (!hit || hit.floor) { setChildren(hover, h('div', { class: 'muted small' }, 'Fahre mit der Maus über einen Block, um Details zu sehen.')); return; }
    const info = app.reg.info(hit.id);
    const plant = app.sim.plants.length ? app.sim.plantAt(hit.x, hit.y, hit.z) : undefined;
    const props = Object.entries(info.props);
    const light = app.sim.lightIfCached();
    setChildren(hover, 
      h('div', { class: 'row' }, app.icons.canvas(app.world.palette[hit.id].key, 34), h('div', { class: 'grow' }, h('b', null, info.display), h('div', { class: 'mono muted' }, `${info.name}`))),
      h('div', { class: 'mono', style: 'margin:8px 0 6px' }, `X ${hit.x}  Y ${hit.y}  Z ${hit.z}`),
      props.length ? h('div', { class: 'props' }, props.flatMap(([k, v]) => [h('span', { class: 'k' }, k), h('span', null, v)])) : null,
      light ? h('div', { class: 'small muted', style: 'margin-top:6px' }, `Licht darüber: Himmel ${light.skyAt(hit.x, hit.y + 1, hit.z)} · Block ${light.blockAt(hit.x, hit.y + 1, hit.z)}`) : null,
      plant ? h('div', { class: `notice ${plant.valid && plant.efficiency > 0.95 ? 'ok' : 'warn'}`, style: 'margin-top:8px' }, icon('sprout', 16), h('span', null, `${PLANT_LABEL[plant.block] ?? plant.block}: Effizienz ${Math.round(plant.efficiency * 100)} %${plant.reason ? ` – ${plant.reason}` : ''}`)) : null,
    );
  };
  bindMeta();
  app.on('meta', bindMeta);
  const el = h('div', null,
    h('div', { class: 'section' }, h('h3', null, icon('cube', 14), 'Struktur'), field('Name', name), field('Autor', author), field('Beschreibung', desc)),
    h('div', { class: 'section' }, h('h3', null, icon('info', 14), 'Statistik'), stats),
    h('div', { class: 'section' }, h('h3', null, icon('search', 14), 'Block unter dem Cursor'), hover),
  );
  return { id: 'info', label: 'Info', icon: 'info', el, on: ['world', 'meta', 'hover'], refresh: () => { refreshStats(); refreshHover(); } };
}

const DOUBLE_PLANTS = /sunflower|lilac|rose_bush|peony|tall_grass|large_fern|pitcher_plant|small_dripleaf|tall_seagrass/;
const ITEM_FOR: Record<string, string> = {
  wall_torch: 'torch', soul_wall_torch: 'soul_torch', redstone_wall_torch: 'redstone_torch', copper_wall_torch: 'copper_torch', wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato',
  beetroots: 'beetroot_seeds', cocoa: 'cocoa_beans', sweet_berry_bush: 'sweet_berries', kelp_plant: 'kelp', cave_vines: 'glow_berries', cave_vines_plant: 'glow_berries',
  redstone_wire: 'redstone', tripwire: 'string', pumpkin_stem: 'pumpkin_seeds', melon_stem: 'melon_seeds', attached_pumpkin_stem: 'pumpkin_seeds', attached_melon_stem: 'melon_seeds',
  water: 'water_bucket', lava: 'lava_bucket', powder_snow: 'powder_snow_bucket', bamboo_sapling: 'bamboo', twisting_vines_plant: 'twisting_vines', weeping_vines_plant: 'weeping_vines',
};

export function materialCounts(app: App, visibleOnly: boolean): { item: string; count: number; key: string }[] {
  const counts = new Map<string, { count: number; key: string }>();
  const add = (item: string, n: number, key: string) => { const c = counts.get(item); if (c) c.count += n; else counts.set(item, { count: n, key }); };
  app.world.forEach((x, y, _z, id) => {
    if (visibleOnly && !app.isVisible(x, y)) return;
    const info = app.reg.info(id), s = info.short, p = info.props;
    if (info.air || /^(piston_head|moving_piston|fire|soul_fire|nether_portal|end_portal|end_gateway|bubble_column|frosted_ice|structure_void)$/.test(s)) return;
    if (p.half === 'upper' && (s.endsWith('_door') || DOUBLE_PLANTS.test(s))) return;
    if (p.part === 'head' && s.endsWith('_bed')) return;
    if ((s === 'water' || s === 'lava') && p.level !== '0') return;
    let n = 1;
    if (s.endsWith('_slab') && p.type === 'double') n = 2;
    for (const k of ['candles', 'pickles', 'eggs', 'flower_amount', 'segment_amount']) if (p[k]) n = Number(p[k]);
    if (s === 'snow') n = Number(p.layers ?? 1);
    const key = app.world.palette[id].key;
    if (s.startsWith('potted_')) { add('flower_pot', 1, 'minecraft:flower_pot'); add(s.slice(7), 1, key); return; }
    const item = ITEM_FOR[s] ?? s.replace(/_wall_(sign|banner|head|skull|fan|hanging_sign)$/, (_m, t) => `_${t}`);
    add(item, n, key);
  });
  return [...counts].map(([item, v]) => ({ item, ...v })).sort((a, b) => b.count - a.count);
}

function stacks(n: number): string {
  if (n < 64) return '';
  const s = Math.floor(n / 64), r = n % 64;
  if (n >= 1728) { const sb = n / 1728; return `${sb.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Shulker`; }
  return `${s} St.${r ? ` + ${r}` : ''}`;
}

function materialTab(app: App): Tab {
  let visibleOnly = false;
  const list = h('div');
  const total = h('div', { class: 'muted small' });
  let last: ReturnType<typeof materialCounts> = [];
  const asText = () => last.map((m) => `${prettyName(m.item)}: ${m.count}${stacks(m.count) ? ` (${stacks(m.count)})` : ''}`).join('\n');
  const refresh = () => {
    if (app.locked) return;
    last = materialCounts(app, visibleOnly);
    const max = last[0]?.count ?? 1;
    total.textContent = `${fmt(last.reduce((a, m) => a + m.count, 0))} Items · ${last.length} verschiedene`;
    setChildren(list, ...last.slice(0, 400).map((m) => h('div', { class: 'mat-row' },
      app.icons.canvas(m.key, 28),
      h('div', { class: 'mat-name' }, prettyName(m.item), h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(2, (m.count / max) * 100)}%` }))),
      h('div', { class: 'mat-stacks' }, h('div', { class: 'mat-count' }, fmt(m.count)), stacks(m.count)))));
    if (!last.length) list.append(h('div', { class: 'grid-empty' }, 'Noch keine Blöcke.'));
  };
  const el = h('div', null,
    h('div', { class: 'section' },
      h('div', { class: 'row between' }, total, h('div', { class: 'row' },
        button(null, 'copy', async () => { try { await navigator.clipboard.writeText(asText()); toast('Materialliste kopiert', 'ok', 1800); } catch { toast('Kopieren nicht möglich', 'warn'); } }, { title: 'Als Text kopieren', class: 'small' }),
        button('CSV', 'download', () => { const csv = 'Item;Anzahl;Stacks\n' + last.map((m) => `${prettyName(m.item)};${m.count};${(m.count / 64).toFixed(2)}`).join('\n'); const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `${app.world.meta.name || 'material'}.csv` }); a.click(); }, { class: 'small' }))),
      toggle('Nur sichtbare Ebenen', false, (v) => { visibleOnly = v; refresh(); }, 'Zählt nur, was der Ebenen-Filter gerade zeigt.')),
    h('div', { class: 'card', style: 'padding:4px 10px' }, list),
  );
  return { id: 'mat', label: 'Material', icon: 'package', el, on: ['world', 'layer'], refresh };
}

function layersTab(app: App): Tab {
  const modeSeg = seg<LayerMode>([['all', 'Alle'], ['below', 'Bis Ebene'], ['only', 'Nur Ebene']], app.layer.mode, (m) => app.setLayer(m));
  const slider = h('input', { type: 'range', min: '0', max: '0', step: '1' });
  slider.addEventListener('input', () => app.setLayer(app.layer.mode === 'all' ? 'below' : app.layer.mode, Number(slider.value)));
  const label = h('div', { class: 'stat' });
  const layerList = h('div');
  const refresh = () => {
    const b = app.world.bounds();
    const lo = b ? b.min[1] : 0, hi = b ? b.max[1] : 0;
    slider.min = String(lo); slider.max = String(hi); slider.value = String(app.layer.y);
    modeSeg.set(app.layer.mode);
    let n = 0;
    const counts = new Map<number, number>();
    if (b) for (let x = b.min[0]; x <= b.max[0]; x++) for (let z = b.min[2]; z <= b.max[2]; z++) {
      const id = app.world.get(x, app.layer.y, z);
      if (id) { n++; counts.set(id, (counts.get(id) ?? 0) + 1); }
    }
    setChildren(label, h('div', { class: 'v' }, `Y ${app.layer.y}`), h('div', { class: 'l' }, `Ebene ${app.layer.y - lo + 1} von ${hi - lo + 1} · ${fmt(n)} Blöcke`));
    const byName = new Map<string, { count: number; key: string; display: string }>();
    for (const [id, c] of counts) {
      const info = app.reg.info(id);
      const e = byName.get(info.short) ?? { count: 0, key: app.world.palette[id].key, display: info.display };
      e.count += c;
      byName.set(info.short, e);
    }
    setChildren(layerList, ...[...byName.values()].sort((a, c) => c.count - a.count).slice(0, 14).map((m) => h('div', { class: 'mat-row' }, app.icons.canvas(m.key, 24), h('div', { class: 'mat-name' }, m.display), h('div', { class: 'mat-count' }, fmt(m.count)))));
    if (!byName.size) layerList.append(h('div', { class: 'muted small', style: 'padding:8px 0' }, 'Diese Ebene ist leer.'));
  };
  const el = h('div', null,
    h('div', { class: 'section' }, h('h3', null, icon('layers', 14), 'Ebenen-Ansicht'), modeSeg,
      h('div', { class: 'row', style: 'margin-top:12px' }, button(null, 'minus', () => app.setLayer(app.layer.mode === 'all' ? 'below' : app.layer.mode, app.layer.y - 1), { title: 'Ebene runter (Bild↓)', class: 'outline' }), h('div', { class: 'grow' }, slider), button(null, 'plus', () => app.setLayer(app.layer.mode === 'all' ? 'below' : app.layer.mode, app.layer.y + 1), { title: 'Ebene hoch (Bild↑)', class: 'outline' })),
      h('div', { style: 'margin-top:10px' }, label),
      h('p', { class: 'small muted' }, 'Wie in Litematica: Baue Schicht für Schicht nach. Tasten ', h('kbd', null, 'Bild↑'), ' / ', h('kbd', null, 'Bild↓'), ' wechseln die Ebene.')),
    h('div', { class: 'section' }, h('h3', null, icon('package', 14), 'Material dieser Ebene'), h('div', { class: 'card', style: 'padding:4px 10px' }, layerList)),
  );
  return { id: 'layers', label: 'Ebenen', icon: 'layers', el, on: ['world', 'layer'], refresh };
}

function viewTab(app: App): Tab {
  const v = app.view;
  const packInfo = h('div');
  const refresh = () => {
    const label = app.packLabel();
    setChildren(packInfo, h('div', { class: `notice ${label ? 'ok' : 'info'}` }, icon('palette', 16), h('span', null, label ? `Original-Texturen aktiv: ${label}` : 'Prozedurale Texturen. Lade deine Minecraft-Jar für den Original-Look – die Datei bleibt lokal.')));
  };
  const fov = h('input', { type: 'range', min: '30', max: '100', value: String(v.camera.fov) });
  fov.addEventListener('input', () => { v.camera.fov = Number(fov.value); v.camera.updateProjectionMatrix(); });
  const el = h('div', null,
    h('div', { class: 'section' }, h('h3', null, icon('palette', 14), 'Texturen'), packInfo, h('div', { class: 'row wrap', style: 'margin-top:8px' }, app.packLabel() ? null : button('Von Mojang laden', 'sparkles', () => void app.loadMojang(), { class: 'primary' }), button('Resourcepack (.zip)', 'palette', () => app.ui.addPack?.(), { class: 'outline' }), button('Verwalten…', 'sliders', () => texturesDialog(app), { class: 'outline' }))),
    h('div', { class: 'section' }, h('h3', null, icon('sun', 14), 'Darstellung'),
      seg([['night', 'Nacht'], ['day', 'Tag']], v.theme, (t) => { v.setTheme(t); localStorage.setItem('litecraft-theme', t); }),
      toggle('Raster', v.showGrid, (on) => { v.showGrid = on; }),
      toggle('Ambient Occlusion', v.ao, (on) => { v.ao = on; v.rebuildAll(); }, 'Weiche Schatten in Ecken'),
      field('Sichtfeld', fov)),
    h('div', { class: 'section' }, h('h3', null, icon('camera', 14), 'Kamera'),
      h('div', { class: 'row wrap' },
        button('Zentrieren', 'focus', () => v.fit(app.world.bounds(), true), { class: 'outline', kbd: 'F' }),
        button('Von oben', 'grid', () => { const b = app.world.bounds(); v.fit(b); v.camera.position.set(v.controls.target.x + 0.01, v.controls.target.y + v.camera.position.distanceTo(v.controls.target), v.controls.target.z); v.controls.update(); }, { class: 'outline' }),
        button('Screenshot', 'camera', async () => { const blob = await v.screenshot(); const a = h('a', { href: URL.createObjectURL(blob), download: `${app.world.meta.name || 'litecraft'}.png` }); a.click(); }, { class: 'outline' }))),
  );
  return { id: 'view', label: 'Ansicht', icon: 'sliders', el, on: ['textures'], refresh };
}

export function buildRightPanel(app: App, simTab: (app: App) => Tab): HTMLElement {
  const tabs: Tab[] = [infoTab(app), materialTab(app), layersTab(app), simTab(app), viewTab(app)];
  let active = localStorage.getItem('litecraft-tab') ?? 'info';
  if (!tabs.some((t) => t.id === active)) active = 'info';
  const body = h('div', { class: 'panel-body' });
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  let pending = 0;
  const refreshActive = () => {
    clearTimeout(pending);
    pending = window.setTimeout(() => tabs.find((t) => t.id === active)?.refresh?.(), 90);
  };
  const show = (id: string) => {
    active = id;
    localStorage.setItem('litecraft-tab', id);
    bar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === id));
    setChildren(body, tabs.find((t) => t.id === id)!.el);
    refreshActive();
  };
  for (const t of tabs) {
    bar.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'data-id': t.id, on: { click: () => show(t.id) } }, icon(t.icon, 17), t.label));
    for (const ev of t.on) app.on(ev as never, () => { if (active === t.id) refreshActive(); });
  }
  show(active);
  return h('aside', { class: 'panel right glass' }, h('div', { class: 'panel-head' }, bar), body);
}

export type { Tab };
