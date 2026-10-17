import asyncio, sys
sys.path.insert(0,'.')
from real import *
async def main():
    async with async_playwright() as p:
        b, ctx, pg = await open_app(p, tour=False)
        for label in ['今天','工作区','教学','班级','日程','教育记忆','观察与洞察','成长','材料','待我确认']:
            await nav(pg,label).click(); await pg.wait_for_timeout(5000); print('visited', label)
        await nav(pg,'今天').click(); await pg.wait_for_timeout(2500)
        await pg.get_by_role('button', name='教学上下文').first.click(); await pg.wait_for_timeout(5000); await pg.keyboard.press('Escape')
        await nav(pg,'日程').click(); await pg.wait_for_timeout(3000)
        await pg.get_by_text('期中考试').first.click(); await pg.wait_for_timeout(3000); await pg.keyboard.press('Escape')
        await nav(pg,'班级').click(); await pg.wait_for_timeout(3000); await pg.get_by_text('张三', exact=True).first.click(); await pg.wait_for_timeout(5000)
        await nav(pg,'待我确认').click(); await pg.wait_for_timeout(3000); await pg.get_by_text('张三这周解方程连续三次在移项变号上出错，需要课前单独强调。').first.click(); await pg.wait_for_timeout(3000)
        await nav(pg,'材料').click(); await pg.wait_for_timeout(3000); await pg.get_by_text('七年级数学 第三章 有理数的加减 教案').first.click(); await pg.wait_for_timeout(3000)
        res = await pg.evaluate("""async()=>{const j=(m,u,b)=>fetch(u,{method:m,headers:{'content-type':'application/json'},body:b}).then(r=>m+' '+u+' '+r.status).catch(e=>String(e));
          return [await j('POST','/api/edupi/reviews','{}'),await j('PATCH','/api/edupi/tasks/teacher-task-00000000-0000-4000-8000-000000000000','{}'),await j('POST','/api/edupi/intake','{}'),await j('DELETE','/api/edupi/materials/staging?id=x',null),await j('POST','/api/edupi/materials/staging','{}')]}""")
        print(res)
        await b.close()
asyncio.run(main())
