import asyncio, sys, pathlib
from playwright.async_api import async_playwright
SP=pathlib.Path(open('build/sp.txt').read().strip())
async def main():
    async with async_playwright() as p:
        try: b = await p.chromium.launch(channel="chrome")
        except Exception: b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1440,"height":900})
        pg.on("pageerror", lambda e: print("PAGEERR", str(e)[:200]))
        await pg.goto("http://127.0.0.1:30373/", wait_until="load", timeout=120000)
        await pg.wait_for_timeout(8000)
        await pg.screenshot(path=str(SP/"peek1.png"))
        print((await pg.inner_text("body"))[:1200])
        await b.close()
asyncio.run(main())
