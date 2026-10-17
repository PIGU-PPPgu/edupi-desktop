import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).parent; URL = (HERE/'swiss.html').as_uri()
SP = pathlib.Path((HERE.parent/'build/sp.txt').read_text().strip())
async def open_page(p):
    try: b = await p.chromium.launch(channel='chrome', args=['--allow-file-access-from-files'])
    except Exception: b = await p.chromium.launch(args=['--allow-file-access-from-files'])
    pg = await b.new_page(viewport={'width':1920,'height':1080})
    pg.on('console', lambda m: print('console:', m.text[:200]) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: print('PAGEERROR:', str(e)[:300]))
    await pg.goto(URL); await pg.wait_for_function('window.ready===true', timeout=30000); return b, pg
async def main(ts, dump):
    async with async_playwright() as p:
        b, pg = await open_page(p)
        ev = await pg.evaluate('getEvents()')
        if dump: (HERE/'build/events.json').write_text(json.dumps(ev, ensure_ascii=False)); print('events dumped; dur', round(ev['dur'],1), [(s['id'], round(s['t0'],1), round(s['t1'],1)) for s in ev['scenes']])
        for t in ts:
            await pg.evaluate(f'renderAt({t})'); await pg.screenshot(path=str(SP/f'sw_{t:07.2f}.png'))
        await b.close()
if __name__ == '__main__':
    dump = '--dump' in sys.argv; ts = [float(x) for x in sys.argv[1:] if not x.startswith('--')]
    asyncio.run(main(ts, dump))
