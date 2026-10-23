"""Dev helper: end-to-end smoke test of the running dev server (headless Chrome).

Usage: python scripts/e2e.py [URL] [--jar PATH] [--out DIR]
"""
import argparse
import json
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('url', nargs='?', default='http://localhost:7668/')
ap.add_argument('--jar')
ap.add_argument('--out', default='/tmp/lcshots')
a = ap.parse_args()

def settle(page, ms=6000):
    page.wait_for_function('() => __lc.view.pendingChunks === 0 && __lc.world.dirty.size === 0', timeout=ms * 10)
    page.wait_for_timeout(800)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome-stable', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(a.url)
    page.wait_for_function('() => window.__lc && __lc.world.blockCount() > 0', timeout=30000)
    settle(page)
    res = {}

    # --- build: place a block on the grass in front of the house, then break it, then undo
    page.evaluate("() => { const v = __lc.view; v.controls.target.set(4, 1, 9); v.camera.position.set(4, 9, 17); v.controls.update(); }")
    page.wait_for_timeout(1500)
    page.keyboard.press('b')
    page.evaluate("() => __lc.setSlot(1)")
    before = page.evaluate('() => __lc.world.blockCount()')
    page.mouse.click(720, 520, button='right')
    page.wait_for_timeout(1200)
    after_place = page.evaluate('() => __lc.world.blockCount()')
    page.mouse.click(720, 520, button='left')
    page.wait_for_timeout(1200)
    after_break = page.evaluate('() => __lc.world.blockCount()')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(800)
    after_undo = page.evaluate('() => __lc.world.blockCount()')
    res['build'] = [before, after_place, after_break, after_undo]

    # --- stairs + fence connections via placement API
    res['shapes'] = page.evaluate("""() => {
      const app = __lc, w = app.world;
      const hit = { x: 20, y: 0, z: 20, face: 2, point: [20.5, 1, 20.5], floor: true, id: 0 };
      app.select('minecraft:oak_fence[east=false,north=false,south=false,waterlogged=false,west=false]');
      const h2 = { ...hit, x: 21, point: [21.5, 1, 20.5] };
      return import('/src/editor/placement.ts').then(({ placeChanges }) => {
        app.edit(placeChanges(w, app.reg, app.selected, hit, [0, -0.5, -1]));
        app.edit(placeChanges(w, app.reg, app.selected, h2, [0, -0.5, -1]));
        return [w.palette[w.get(20, 0, 20)].key, w.palette[w.get(21, 0, 20)].key];
      });
    }""")

    # --- box fill
    page.keyboard.press('g')
    page.evaluate("() => { __lc.box = { a: [30, 0, 30], b: [33, 2, 31] }; __lc.emit('box'); }")
    page.keyboard.press('Enter')
    page.wait_for_timeout(600)
    res['box'] = page.evaluate('() => __lc.world.get(31, 1, 30) !== 0')
    page.keyboard.press('Escape')
    page.keyboard.press('v')

    # --- plant simulation on the field demo
    page.evaluate("() => __lc.loadDemo('fields')")
    settle(page)
    res['plants'] = page.evaluate("""() => {
      const sim = __lc.sim; const plants = sim.analyzePlants();
      const r = sim.runPlants({ hours: 5, randomTickSpeed: 3, harvest: 'instant', intervalMin: 20, runs: 3 });
      const eff = (ox) => { const ps = plants.filter(p => p.x >= ox && p.x < ox + 9 && p.valid); return ps.reduce((a, p) => a + p.efficiency, 0) / Math.max(1, ps.length); };
      return { n: plants.length, valid: plants.filter(p => p.valid).length, items: r.items.map(i => [i.name, +i.perHour.toFixed(1)]), effAll: +eff(0).toFixed(2), effRows: +eff(13).toFixed(2), effDry: +eff(26).toFixed(2) };
    }""")
    page.evaluate("() => __lc.sim.setHeat(true)")
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{a.out}/e2e_heat.png')
    page.evaluate("() => __lc.sim.setHeat(false)")

    # --- sugar cane rate sanity check (expected ~3.3 per plant and hour)
    page.evaluate("() => __lc.loadDemo('sugarcane')")
    settle(page)
    res['cane'] = page.evaluate("""() => { const sim = __lc.sim; const ps = sim.analyzePlants(); const r = sim.runPlants({ hours: 100, randomTickSpeed: 3, harvest: 'instant', intervalMin: 20, runs: 2 }); return { plants: ps.length, perPlant: +(r.items[0].perHour / ps.length).toFixed(2) }; }""")

    # --- mob farm
    page.evaluate("() => __lc.loadDemo('mobfarm')")
    settle(page)
    res['mobs'] = page.evaluate("""async () => {
      const sim = __lc.sim; const map = sim.spawnMap(); const spots = map.spots(sim.afk);
      const r = await sim.runMobs({ baseY: 160, deathSeconds: 12, hours: 1, night: true }, () => {});
      return { spots: spots.length, inRange: spots.filter(s => s.dist > 24 && s.dist <= 128).length, perHour: Math.round(r.spawnsPerHour), byMob: r.byMob.map(m => [m.id, Math.round(m.perHour)]), cap: +r.capFullPct.toFixed(1), alive: +r.avgAlive.toFixed(1) };
    }""")
    page.evaluate("() => { __lc.sim.setSpawns(true); __lc.setLayer('below', 26); }")
    settle(page)
    page.screenshot(path=f'{a.out}/e2e_mobfarm.png')

    # --- export
    with page.expect_download() as dl:
        page.evaluate("() => __lc.exportFile('litematic', __lc.exportDefaults())")
    d = dl.value
    d.save_as(f'{a.out}/export.litematic')
    res['export'] = d.suggested_filename

    if a.jar:
        page.set_input_files('header input[type=file]', a.jar)
        page.wait_for_function('() => __lc.packLabel().length > 0', timeout=180000)
        page.evaluate("() => { __lc.setLayer('all'); __lc.loadDemo('house'); }")
        settle(page)
        page.wait_for_timeout(1500)
        page.screenshot(path=f'{a.out}/e2e_jar.png')

    print(json.dumps(res, indent=1, ensure_ascii=False))
    print('errors:', errors[:10])
    b.close()
