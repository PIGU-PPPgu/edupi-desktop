import asyncio, render
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b, pg = await render.open_page(p)
        print(await pg.evaluate("JSON.stringify(SC.map(s=>[s.id,+s.t0.toFixed(1),+s.t1.toFixed(1),Object.fromEntries(Object.entries(s.L).map(([k,v])=>[k,+v.toFixed(1)]))]))"))
        await b.close()
asyncio.run(main())
