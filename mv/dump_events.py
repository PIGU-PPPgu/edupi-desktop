import asyncio, json, pathlib, render
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b, pg = await render.open_page(p)
        d = await pg.evaluate("getEvents()"); await b.close()
    pathlib.Path(__file__).parent.joinpath("build/events.json").write_text(json.dumps(d, ensure_ascii=False))
    from collections import Counter; print(Counter(e["type"] for e in d["ev"]), d["dur"])
asyncio.run(main())
