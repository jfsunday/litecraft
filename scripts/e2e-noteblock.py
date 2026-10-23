"""E2E: paste the note block song fixture, click its start button, check the simulated notes against the schedule.

Usage: python scripts/e2e-noteblock.py [URL] [--out DIR]   (needs the dev server: npx vite --port 7668)
"""
import argparse
import json
import pathlib
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('url', nargs='?', default='http://localhost:7668/')
ap.add_argument('--out', default='/tmp/lcshots')
a = ap.parse_args()
pathlib.Path(a.out).mkdir(parents=True, exist_ok=True)
fixture = (pathlib.Path(__file__).parent.parent / 'tests/fixtures/final-countdown-riff_litecraft.json').read_text()

CHECK = """() => {
  const key = (t, p, i, n) => `${t}|${p.join(',')}|${i}|${n}`;
  const want = __lc.song.schedule.map((s) => key(s.tick, s.pos, s.instrument, s.note)).sort();
  const got = __lc.redstone.log.map((e) => key(e.tick, [e.x, e.y, e.z], e.instrument, e.note)).sort();
  const missing = want.filter((k) => !got.includes(k)), extra = got.filter((k) => !want.includes(k));
  return { want: want.length, got: got.length, missing: missing.slice(0, 5), extra: extra.slice(0, 5), equal: JSON.stringify(want) === JSON.stringify(got) };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome-stable', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    page = b.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.add_init_script("localStorage.setItem('litecraft-no-autoload', '1'); localStorage.setItem('litecraft-tab', 'sim');")
    page.goto(a.url)
    page.wait_for_function('() => window.__lc && __lc.world.blockCount() > 0', timeout=60000)
    res = {}

    page.evaluate('() => __lc.newWorld()')
    res['paste'] = page.evaluate('(t) => __lc.pasteText(t)', fixture)
    res['blocks'] = page.evaluate('() => __lc.world.blockCount()')
    res['schedule'] = page.evaluate('() => __lc.song.schedule.length')
    page.evaluate('() => __lc.undo()')
    res['after_undo'] = page.evaluate('() => __lc.world.blockCount()')
    # Ctrl+V path: a real paste event with clipboard data
    page.evaluate("""(t) => { const dt = new DataTransfer(); dt.setData('text/plain', t);
      document.querySelector('canvas.view').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }""", fixture)
    res['after_paste_event'] = page.evaluate('() => __lc.world.blockCount()')
    page.wait_for_function('() => __lc.view.pendingChunks === 0', timeout=120000)
    page.wait_for_timeout(1500)

    # Click the start button in the 3D view (view mode left click presses it).
    pt = page.evaluate("""() => { const [x, y, z] = __lc.song.start_button; const v = __lc.view.camera.position.clone().set(x + 0.5, y + 0.5, z + 0.5).project(__lc.view.camera);
      const r = __lc.canvas.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }""")
    page.evaluate('() => __lc.redstone.setSpeed(2)')
    page.mouse.move(pt[0], pt[1])
    page.wait_for_timeout(1200)
    page.mouse.down()
    page.mouse.up()
    res['started_by_click'] = page.evaluate('() => __lc.redstone.running')
    if not res['started_by_click']:
        page.evaluate('() => __lc.redstone.play()')
    page.evaluate('() => { const v = __lc.view; v.controls.target.set(48, 1, 11.5); v.camera.position.set(40, 24, 38); v.controls.update(); v.requestRender(); }')
    page.wait_for_function('() => __lc.redstone.sim && __lc.redstone.sim.tick > 70', timeout=90000, polling=200)
    page.screenshot(path=f'{a.out}/noteblock.png')
    res['locked_while_playing'] = page.evaluate('() => __lc.locked')
    res['hud'] = page.evaluate("() => [...document.querySelectorAll('.hud')].find((e) => e.style.display !== 'none')?.innerText.replace(/\\s+/g, ' ')")
    page.wait_for_function('() => !__lc.redstone.running', timeout=120000, polling=250)
    res['check'] = page.evaluate(CHECK)
    res['unlocked'] = not page.evaluate('() => __lc.locked')
    res['sound'] = page.evaluate("() => ({ label: __lc.redstone.audio.label || 'synth', mojangFailed: !!localStorage.getItem('litecraft-sounds-mojang-failed'), ctx: __lc.redstone.audio.ctx?.state })")
    b.close()

print(json.dumps(res, indent=1))
for e in errors[-10:]:
    print('console:', e)
ok = (res['paste'] and res['blocks'] == 1899 and res['schedule'] == 267 and res['after_undo'] == 0 and res['after_paste_event'] == 1899
      and res['check']['equal'] and res['unlocked'])
print('E2E', 'OK' if ok else 'FAILED')
raise SystemExit(0 if ok else 1)
