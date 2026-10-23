import type { App } from '../app';
import { PLANT_LABEL } from '../sim/plants';
import { button, field, fmt, h, icon, setChildren, toast } from './dom';
import type { Tab } from './panels';

const opt = (v: string, label: string, sel = false) => h('option', { value: v, selected: sel }, label);

function table(rows: [string, string, string?][], heads: [string, string, string?]): HTMLElement {
  return h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, heads[0]), h('th', { class: 'num' }, heads[1]), heads[2] !== undefined ? h('th', { class: 'num' }, heads[2]) : null)),
    h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r[0]), h('td', { class: 'num' }, r[1]), r[2] !== undefined ? h('td', { class: 'num muted' }, r[2]) : null))));
}

export function simTab(app: App): Tab {
  const sim = app.sim;
  // ---------------------------------------------------------------- plants
  let harvest: 'instant' | 'interval' = 'instant';
  const interval = h('input', { type: 'number', min: '1', max: '240', value: '20' });
  const intervalField = field('Ernte alle … Minuten', interval);
  intervalField.style.display = 'none';
  const hours = h('select', null, opt('1', '1 Stunde'), opt('5', '5 Stunden', true), opt('24', '24 Stunden'), opt('100', '100 Stunden'));
  const rts = h('input', { type: 'number', min: '0', max: '4096', value: '3' });
  const harvestSeg = h('div', { class: 'seg' });
  const segBtn = (v: typeof harvest, label: string) => h('button', { type: 'button', class: v === harvest ? 'on' : '', on: { click: () => { harvest = v; harvestSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === label)); intervalField.style.display = v === 'interval' ? '' : 'none'; } } }, label);
  harvestSeg.append(segBtn('instant', 'Sofort (Observer)'), segBtn('interval', 'Im Intervall'));
  const plantSummary = h('div', { class: 'stack' });
  const plantResult = h('div');
  const opts = () => ({ hours: Number(hours.value), randomTickSpeed: Math.max(0, Number(rts.value) || 0), harvest, intervalMin: Math.max(1, Number(interval.value) || 20), runs: 4 });

  const renderPlantSummary = () => {
    const plants = sim.analyzePlants();
    if (!plants.length) { setChildren(plantSummary, h('div', { class: 'muted small' }, 'Keine Pflanzen gefunden. Unterstützt: Weizen, Karotten, Kartoffeln, Rote Bete, Kürbis-/Melonenstängel, Zuckerrohr, Kaktus, Bambus, Seetang, Netherwarzen, Kakao, Süßbeeren.')); return; }
    const by = new Map<string, { total: number; valid: number }>();
    const reasons = new Map<string, number>();
    for (const p of plants) {
      const c = by.get(p.block) ?? { total: 0, valid: 0 };
      c.total++; if (p.valid) c.valid++;
      by.set(p.block, c);
      if (p.reason) reasons.set(p.reason, (reasons.get(p.reason) ?? 0) + 1);
    }
    const eff = plants.filter((p) => p.valid).reduce((a, p) => a + p.efficiency, 0) / Math.max(1, plants.length);
    setChildren(plantSummary, 
      h('div', { class: 'row wrap' }, [...by].map(([b, c]) => h('span', { class: 'chip', style: 'cursor:default' }, `${c.total}× ${PLANT_LABEL[b] ?? b}${c.valid < c.total ? ` (${c.total - c.valid} ungültig)` : ''}`))),
      h('div', { class: 'small muted' }, `Ø Layout-Effizienz: ${Math.round(eff * 100)} %`),
      reasons.size ? h('div', { class: 'notice warn' }, icon('alert', 16), h('div', null, [...reasons].map(([r, n]) => h('div', null, `${n}× ${r}`)))) : null,
    );
  };

  const runPlants = () => {
    const plants = sim.analyzePlants();
    if (!plants.some((p) => p.valid)) { toast('Keine gültigen Pflanzen zum Simulieren.', 'warn'); return; }
    const t0 = performance.now();
    const r = sim.runPlants(opts());
    const ms = performance.now() - t0;
    setChildren(plantResult, h('div', { class: 'card' },
      h('div', { class: 'row between', style: 'margin-bottom:6px' }, h('b', null, 'Ertrag pro Stunde'), h('span', { class: 'small muted' }, `${fmt(Number(hours.value))} h simuliert · ${fmt(ms)} ms`)),
      table(r.items.map((i) => [i.name, fmt(i.perHour, 1), i.std > 0.05 ? `± ${fmt(i.std, 1)}` : '']), ['Item', 'pro h', '']),
      h('div', { class: 'small muted', style: 'margin-top:8px' }, `${fmt(r.harvestsPerHour, 1)} Ernten/h. Random Ticks nach Java-Regeln (Wachstumsbonus durch bewässerten Ackerboden, Reihen-Malus, Licht).`)));
  };

  const timelapseBtn = button('Zeitraffer', 'play', () => {
    if (sim.timelapse) { sim.stopTimelapse(); return; }
    if (!sim.startTimelapse(opts())) toast('Keine gültigen Pflanzen gefunden.', 'warn');
  }, { class: 'outline' });
  app.on('loading', () => { timelapseBtn.querySelector('span')!.textContent = sim.timelapse ? 'Stoppen' : 'Zeitraffer'; });

  // ---------------------------------------------------------------- mobs
  const afkInfo = h('div', { class: 'grow' });
  const baseY = h('input', { type: 'number', min: '-64', max: '320', value: String(sim.baseY) });
  baseY.addEventListener('change', () => { sim.baseY = Number(baseY.value) || 0; });
  const death = h('input', { type: 'number', min: '1', max: '900', value: '12' });
  let night = true;
  const nightSeg = h('div', { class: 'seg' },
    h('button', { type: 'button', class: 'on', on: { click: (e: MouseEvent) => { night = true; setOn(e); } } }, 'Immer Nacht'),
    h('button', { type: 'button', on: { click: (e: MouseEvent) => { night = false; setOn(e); } } }, 'Tag-Nacht-Zyklus'));
  const setOn = (e: MouseEvent) => { nightSeg.querySelectorAll('button').forEach((b) => b.classList.remove('on')); (e.currentTarget as HTMLElement).classList.add('on'); };
  const mobHours = h('select', null, opt('1', '1 Stunde', true), opt('3', '3 Stunden'), opt('10', '10 Stunden'));
  const spotInfo = h('div');
  const mobResult = h('div');
  const progress = h('div', { class: 'progress', style: 'display:none;margin-top:10px' }, h('i'));
  let running = false;

  const renderAfk = () => {
    const a = sim.afk;
    setChildren(afkInfo, h('div', { class: 'small muted' }, 'AFK-Punkt'), h('div', { class: 'mono' }, a ? `X ${a[0]}  Y ${a[1]}  Z ${a[2]}` : 'nicht gesetzt'));
    if (document.activeElement !== baseY) baseY.value = String(sim.baseY);
  };

  const renderSpots = () => {
    const b = app.world.bounds();
    if (!b) { setChildren(spotInfo); return; }
    const vol = (b.max[0] - b.min[0] + 1) * (b.max[1] - b.min[1] + 1) * (b.max[2] - b.min[2] + 1);
    if (vol > 3_000_000 && !sim.showSpawns) { setChildren(spotInfo, h('div', { class: 'small muted' }, 'Große Struktur – Spawnflächen werden beim Simulieren berechnet.')); return; }
    const map = sim.spawnMap();
    if (!map) return;
    const spots = map.spots(sim.afk);
    const inRange = spots.filter((s) => s.dist > 24 && s.dist <= 128);
    const close = spots.filter((s) => s.dist >= 0 && s.dist <= 24).length;
    const sky = spots.filter((s) => s.sky > 0).length;
    const warn: string[] = [];
    if (!spots.length) warn.push('Keine Spawnflächen: Mobs brauchen dunkle (Blocklicht 0), feste Oberflächen mit 2 Blöcken Platz.');
    if (sim.afk && close) warn.push(`${close} Flächen sind näher als 24 Blöcke am AFK-Punkt – dort spawnt nichts.`);
    if (sky) warn.push(`${sky} Flächen haben Himmelslicht – dort spawnt es nur nachts (und seltener).`);
    setChildren(spotInfo, 
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(spots.length)), h('div', { class: 'l' }, 'Spawnflächen')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, sim.afk ? fmt(inRange.length) : '–'), h('div', { class: 'l' }, 'davon 24–128 Blöcke entfernt'))),
      warn.length ? h('ul', { class: 'warn-list' }, warn.map((w) => h('li', null, w))) : null);
  };

  const runMobs = async () => {
    if (running) return;
    if (!sim.afk) { toast('Setze zuerst einen AFK-Punkt.', 'warn'); return; }
    running = true;
    progress.style.display = '';
    const bar = progress.firstChild as HTMLElement;
    const t0 = performance.now();
    try {
      const r = await sim.runMobs({ baseY: sim.baseY, deathSeconds: Math.max(1, Number(death.value) || 12), hours: Number(mobHours.value), night }, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
      if (!r) return;
      if (sim.showSpawns) sim.buildSpawns(r.heat);
      const warn: string[] = [];
      if (r.capFullPct > 10) warn.push(`Mob-Cap war ${fmt(r.capFullPct)} % der Zeit voll – Mobs schneller töten erhöht die Rate.`);
      if (r.despawnedPct > 5) warn.push(`${fmt(r.despawnedPct)} % der Mobs sind despawnt (über 32 Blöcke weg und länger als 30 s am Leben).`);
      setChildren(mobResult, h('div', { class: 'card' },
        h('div', { class: 'stats' },
          h('div', { class: 'stat accent' }, h('div', { class: 'v' }, fmt(r.spawnsPerHour)), h('div', { class: 'l' }, 'Kills pro Stunde')),
          h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(r.xpPerHour)), h('div', { class: 'l' }, 'XP pro Stunde')),
          h('div', { class: 'stat' }, h('div', { class: 'v' }, fmt(r.avgAlive, 1)), h('div', { class: 'l' }, 'Ø lebende Mobs (Cap 70)')),
          h('div', { class: 'stat' }, h('div', { class: 'v' }, `${fmt(r.capFullPct)} %`), h('div', { class: 'l' }, 'Zeit mit vollem Cap'))),
        h('div', { style: 'margin-top:10px' }, table(r.byMob.map((m) => [m.label, fmt(m.perHour)]), ['Mob', 'pro h'])),
        h('div', { style: 'margin-top:10px' }, table(r.drops.map((d) => [d.name, fmt(d.perHour)]), ['Drop (Spieler-Kill)', 'pro h'])),
        warn.length ? h('ul', { class: 'warn-list' }, warn.map((w) => h('li', null, w))) : null,
        h('div', { class: 'small muted', style: 'margin-top:8px' }, `${fmt(Number(mobHours.value))} h in ${fmt((performance.now() - t0) / 1000, 1)} s simuliert.`)));
    } finally {
      running = false;
      progress.style.display = 'none';
    }
  };

  const heatToggle = (() => {
    const input = h('input', { type: 'checkbox' });
    input.addEventListener('change', () => sim.setHeat(input.checked));
    return h('label', { class: 'toggle' }, h('span', null, 'Effizienz-Heatmap', h('div', { class: 'field-hint' }, 'Grün = optimal, Rot = schlecht/ungültig')), input, h('span', { class: 'sw' }));
  })();
  const spawnToggle = (() => {
    const input = h('input', { type: 'checkbox' });
    input.addEventListener('change', () => { sim.setSpawns(input.checked); if (input.checked && sim.lastMob) sim.buildSpawns(sim.lastMob.heat); renderSpots(); });
    return h('label', { class: 'toggle' }, h('span', null, 'Spawnflächen anzeigen'), input, h('span', { class: 'sw' }));
  })();
  const sphereToggle = (() => {
    const input = h('input', { type: 'checkbox', checked: true });
    input.addEventListener('change', () => sim.setSpheres(input.checked));
    return h('label', { class: 'toggle' }, h('span', null, 'Spawn-Radien (24 / 128)'), input, h('span', { class: 'sw' }));
  })();

  const el = h('div', null,
    h('div', { class: 'section' }, h('h3', null, icon('sprout', 14), 'Pflanzen-Farm'),
      plantSummary,
      h('div', { style: 'margin-top:10px' }, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Ernte'), harvestSeg)),
      intervalField,
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Dauer', hours)), h('div', { style: 'width:110px' }, field('randomTickSpeed', rts))),
      heatToggle,
      h('div', { class: 'row', style: 'margin:4px 0 10px' }, button('Simulieren', 'flask', runPlants, { class: 'primary' }), timelapseBtn),
      plantResult),
    h('div', { class: 'section' }, h('h3', null, icon('skull', 14), 'Mob-Farm (Spawning)'),
      h('div', { class: 'card row' }, afkInfo, button('Setzen', 'pin', () => app.ui.pickAfk?.(), { class: 'small outline' }), button(null, 'x', () => sim.setAfk(null), { class: 'small', title: 'AFK-Punkt entfernen' })),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, field('Y des untersten Blocks', baseY)), h('div', { class: 'grow' }, field('Ø Sekunden bis Kill', death))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tageszeit'), nightSeg),
      field('Dauer', mobHours),
      spawnToggle, sphereToggle,
      h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:#4ade80' }), 'spawnt'), h('span', null, h('i', { style: 'background:#f59e0b' }), 'nur nachts'), h('span', null, h('i', { style: 'background:#ef4444' }), 'zu nah'), h('span', null, h('i', { style: 'background:#64748b' }), 'zu weit')),
      h('div', { style: 'margin-top:10px' }, spotInfo),
      h('div', { class: 'row', style: 'margin-top:10px' }, button('Mob-Spawns simulieren', 'flask', () => void runMobs(), { class: 'primary' })),
      progress,
      h('div', { style: 'margin-top:10px' }, mobResult),
      h('p', { class: 'small muted' }, 'Simuliert den Java-Spawn-Algorithmus (Packs, Lichtregeln, Hitboxen, 24/128-Radius, Mob-Cap, Despawn) in einer idealen Welt: Farm über dem Ozean im Ebenen-Biom, sonst keine Spawnflächen. Die Mob-KI ist vereinfacht – statt Wegfindung zählt die Ø Zeit bis zum Kill.')),
  );
  return {
    id: 'sim', label: 'Simulation', icon: 'flask', el, on: ['world', 'afk'],
    refresh: () => { if (app.locked) return; renderPlantSummary(); renderAfk(); renderSpots(); },
  };
}
