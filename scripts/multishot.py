"""Dev helper: load the app once (optionally with a jar) and screenshot several states.

Usage: python scripts/multishot.py URL OUTDIR [--jar PATH] [--step NAME=JS ...]
Each step runs JS in the page, waits, then saves OUTDIR/NAME.png.
"""
import argparse
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('url')
ap.add_argument('outdir')
ap.add_argument('--jar')
ap.add_argument('--step', action='append', default=[])
ap.add_argument('--size', default='1400x900')
ap.add_argument('--wait', type=int, default=1500)
a = ap.parse_args()
w, h = map(int, a.size.split('x'))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome-stable', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': w, 'height': h})
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto(a.url)
    page.wait_for_timeout(1500)
    if a.jar:
        page.set_input_files('header input[type=file]', a.jar)
        page.wait_for_function('() => window.__lc && window.__lc.packLabel().length > 0', timeout=180000)
    for s in a.step:
        name, js = s.split('=', 1)
        r = page.evaluate(js)
        if r is not None:
            print(name, '->', r)
        page.wait_for_timeout(a.wait)
        page.screenshot(path=f'{a.outdir}/{name}.png')
    b.close()
    for l in logs[-20:]:
        print(l)
