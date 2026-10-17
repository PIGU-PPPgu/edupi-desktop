import sys, asyncio, pathlib, math
from playwright.async_api import async_playwright
import render
FPS = 30
async def worker(k, n, total, outdir, lo=0):
    async with async_playwright() as p:
        b, pg = await render.open_page(p)
        for i in range(lo+k, total, n):
            await pg.evaluate(f"renderAt({i/FPS})")
            await pg.screenshot(path=str(outdir/f"f{i:06d}.jpg"), type="jpeg", quality=92)
        await b.close()
async def main(outdir, n, lo=0, hi=None):
    async with async_playwright() as p:
        b, pg = await render.open_page(p); dur = await pg.evaluate("DUR"); await b.close()
    total = hi if hi else math.ceil(dur*FPS); print("frames", lo, total, flush=True)
    await asyncio.gather(*[worker(k, n, total, outdir, lo) for k in range(n)])
    print("done", flush=True)
if __name__ == "__main__":
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    asyncio.run(main(out, int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv)>3 else 0, int(sys.argv[4]) if len(sys.argv)>4 else None))
