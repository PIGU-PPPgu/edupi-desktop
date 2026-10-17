import asyncio, pathlib
from playwright.async_api import async_playwright
SP = pathlib.Path(open(pathlib.Path(__file__).parent/'build/sp.txt').read().strip())
URL = "http://127.0.0.1:30373/"
async def open_app(p, tour=True, scale=4/3):
    try: b = await p.chromium.launch(channel="chrome")
    except Exception: b = await p.chromium.launch()
    ctx = await b.new_context(viewport={"width":1440,"height":810}, device_scale_factor=scale)
    pg = await ctx.new_page()
    await pg.goto(URL, wait_until="load", timeout=120000)
    for i in range(60):
        await pg.wait_for_timeout(1500)
        if "正在读取教育工作区" not in await pg.inner_text("body"): break
    if not tour:
        try: await pg.get_by_text("稍后再说").first.click(timeout=2500)
        except Exception: pass
    return b, ctx, pg
async def txt(pg, a=0, b=700): return (await pg.inner_text("body")).replace("\n"," | ")[a:b]
def nav(pg, label): return pg.locator(".edupi-teacher-rail__text").get_by_text(label, exact=True).first
