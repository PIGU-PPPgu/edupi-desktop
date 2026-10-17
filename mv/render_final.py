import sys, asyncio, pathlib, math, json
from playwright.async_api import async_playwright
import render
HERE = pathlib.Path(__file__).parent; SP = pathlib.Path((HERE/'build/sp.txt').read_text().strip())
FPS = 30
EV = json.load(open(HERE/'build/events.json')); SC = {s['id']: s for s in EV['scenes']}
nA = round(SC['E']['t0']*FPS); iK = round(SC['K']['t0']*FPS); N = math.ceil(EV['dur']*FPS)
async def page(p):
    b, pg = await render.open_page(p)
    await pg.evaluate(f"(()=>{{const i=document.getElementById('realbg');i.src='{(HERE/'build/realbg.png').as_uri()}';return new Promise(r=>{{i.onload=r;setTimeout(r,4000)}})}})()")
    return b, pg
async def worker(k, n, idxs, out):
    async with async_playwright() as p:
        b, pg = await page(p)
        for i in idxs[k::n]:
            if (out/f"f{i:06d}.jpg").exists(): continue
            await pg.evaluate(f"renderAt({i/FPS})"); await pg.screenshot(path=str(out/f"f{i:06d}.jpg"), type="jpeg", quality=92)
        await b.close()
async def wipes(out):
    async with async_playwright() as p:
        b, pg = await page(p)
        for k in range(0, 19):
            t = SC['E']['t0'] + k/FPS
            await pg.evaluate(f"renderWipeOnly({t})"); await pg.screenshot(path=str(out/f"w{k:03d}.png"), type="png", omit_background=True)
        await b.close()
async def main(n):
    out = SP/'final'; out.mkdir(exist_ok=True); w = SP/'wipe'; w.mkdir(exist_ok=True)
    print('nA', nA, 'iK', iK, 'N', N, flush=True)
    await wipes(w)
    idxs = list(range(0, nA)) + list(range(iK, N))
    await asyncio.gather(*[worker(k, n, idxs, out) for k in range(n)])
    print('done', flush=True)
if __name__ == '__main__': asyncio.run(main(int(sys.argv[1])))
