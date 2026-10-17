import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).parent
URL = (HERE/"film.html").as_uri()
async def open_page(p, w=1920, h=1080):
    try: b = await p.chromium.launch(channel="chrome", args=["--font-render-hinting=none"])
    except Exception: b = await p.chromium.launch()
    pg = await b.new_page(viewport={"width": w, "height": h})
    pg.on("console", lambda m: print("console:", m.text) if m.type in ("error","warning") else None)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    await pg.goto(URL); await pg.wait_for_function("window.ready===true", timeout=30000)
    return b, pg
async def still(ts):
    async with async_playwright() as p:
        b, pg = await open_page(p)
        info = await pg.evaluate("getEvents()")
        print("DUR", round(info["dur"],1), [(x["p"], round(x["t0"],1), round(x["t1"],1), round(x["t1"]-x["t0"],1)) for x in info["parts"]])
        for t in ts:
            await pg.evaluate(f"renderAt({t})"); await pg.screenshot(path=str(HERE/"out"/f"still_{t:07.2f}.png"))
        await b.close()
if __name__ == "__main__":
    asyncio.run(still([float(x) for x in sys.argv[1:]]))
