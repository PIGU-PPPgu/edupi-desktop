import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright
from rs import open_page, SP
FPS = 30; W = 8
async def worker(p, ids, out):
    b, pg = await open_page(p)
    for i in ids:
        await pg.evaluate(f'renderAt({i/FPS})'); await pg.screenshot(path=str(out/f'{i:05d}.jpg'), type='jpeg', quality=95)
    await b.close()
async def main():
    out = SP/'swout'; out.mkdir(exist_ok=True)
    dur = json.load(open(pathlib.Path(__file__).parent/'build/events.json'))['dur']; n = int(dur*FPS)+1
    todo = [i for i in range(n) if not (out/f'{i:05d}.jpg').exists()]
    print('frames', n, 'todo', len(todo), flush=True)
    async with async_playwright() as p:
        await asyncio.gather(*[worker(p, todo[k::W], out) for k in range(W)])
    print('done', flush=True)
asyncio.run(main())
