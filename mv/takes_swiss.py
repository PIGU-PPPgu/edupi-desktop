import asyncio, os, sys
os.environ['SWISS'] = '1'
from takes import nav, btn, tag, ASSETS, RAIL
from rec import *

async def go2(T, label, dur=0.8):
    await asyncio.sleep(0.3); await T.click(nav(T.page, label), dur=dur)

async def take_E(T):
    pg = T.page; a1, a2 = T.a('e1'), T.a('e2')
    await T.at(a1 + 0.3); await T.mark(pg.locator('.edupi-first-run__dialog'), 'tour')
    steps = ['连接模型', '确认教师资料', '导入学生名单', '导入校历与课表', '上传第一份材料', '第一次备课', '进入今天']
    ts = [T.w('e1', s) for s in steps]
    for k in range(1, 7):
        await T.at(max(T.now(), ts[k] - 0.4))
        await T.click(pg.locator('.edupi-first-run__skip', has_text='跳过此步').first, dur=0.5)
    await T.at(a2 + 0.2)
    await T.click(pg.locator('.edupi-first-run__skip', has_text='稍后再说').first, dur=0.6)
    try: await pg.locator('.edupi-first-run').wait_for(state='hidden', timeout=5000)
    except Exception: print('tour still visible')
    await T.at(a2 + 1.6)
    async def open_ctx():
        for _ in range(6):
            await T.click(btn(pg, '教学上下文'), dur=0.9)
            try: await pg.locator('[role=dialog]').first.wait_for(state='visible', timeout=7000); return
            except Exception: pass
    await T.wait(open_ctx())
    await T.mark(pg.locator('[role=dialog]'), 'ctx')
    await T.at(a2 + 8.5); await pg.keyboard.press('Escape')

async def take_F(T):
    pg = T.page; f1, f2, f3 = T.a('f1'), T.a('f2'), T.a('f3')
    await T.at(0.4); await T.click(nav(pg, '日程'), dur=0.7)
    await T.wait(btn(pg, '上传文件').wait_for(state='visible', timeout=120000))
    await T.at(f1 + 1.0); await T.mark(btn(pg, '上传文件'), 'upload'); await T.to(btn(pg, '上传文件'), dur=0.9)
    await T.at(f1 + 2.4)
    async with pg.expect_file_chooser(timeout=10000) as fc:
        await T.click(btn(pg, '上传文件'), dur=0.2)
    await (await fc.value).set_files(str(ASSETS / 'notice2.pdf'))
    await T.wait(pg.get_by_text('待接入材料').first.wait_for(timeout=120000))
    await T.mark(pg.get_by_text('待接入材料').first, 'staged')
    await T.at(f1 + 5.2); await T.click(btn(pg, '接入 EduPi'), dur=0.9)
    await T.wait(pg.get_by_text('确认接入').first.wait_for(timeout=60000))
    await tag(T, '材料名称', 'intake', 3); await T.mark(pg.locator('[data-fx=intake]'), 'intake')
    await T.at(f1 + 7.4)
    inp = pg.locator('input[value="notice2.pdf"]').first
    await T.click(inp, dur=0.7); await pg.keyboard.press('Meta+A'); await T.type('期中复习及考试安排通知', cps=9)
    await T.at(f1 + 10.2); await T.click(btn(pg, '确认接入'), dur=0.8)
    await T.wait(pg.get_by_text('待接入材料').first.wait_for(state='detached', timeout=120000))
    await T.at(f2 + 0.1); await go2(T, '日程')
    await T.wait(btn(pg, '上传文件').wait_for(state='visible', timeout=120000))
    await T.at(f2 + 1.8); await T.click(pg.get_by_text('七年级家长会').first, dur=0.9)
    await tag(T, '来源', 'src', 2); await T.mark(pg.locator('[data-fx=src]'), 'source')
    await T.at(f2 + 5.6); await pg.keyboard.press('Escape')
    await T.at(f3 + 0.5); await T.click(pg.get_by_text('期中考试').first, dur=0.9)
    await T.at(f3 + 2.4); await tag(T, '日期待确认', 'pend'); await T.mark(pg.locator('[data-fx=pend]'), 'pending')

async def take_G(T):
    pg = T.page; g1, g2 = T.a('g1'), T.a('g2')
    await T.at(0.4); await T.click(nav(pg, '今天'), dur=0.7)
    await T.wait(pg.get_by_text('接下来').first.wait_for(timeout=120000))
    await T.at(g1 + 0.6); await tag(T, '简报', 'brief', 3); await T.mark(pg.locator('[data-fx=brief]'), 'brief')
    await T.at(g1 + 5.0); await tag(T, '接下来', 'nextcard', 2); await T.mark(pg.locator('[data-fx=nextcard]'), 'next')
    await T.at(g2 + 0.1); await go2(T, '工作区')
    await T.wait(pg.get_by_text('待我确认').first.wait_for(timeout=120000))
    await T.at(g2 + 2.0); await tag(T, '第 7 周班级周报（今天 18:00 提交）', 'cardw', 3); await T.mark(pg.locator('[data-fx=cardw]'), 'weekly')
    await T.at(g2 + 6.0)
    sel = pg.locator('[data-fx=cardw] select').first
    await T.click(sel, dur=0.9); await sel.select_option(value='done')
    await T.wait(pg.get_by_text('正在移动').first.wait_for(state='detached', timeout=180000))
    await T.mark(pg.get_by_text('已完成').first, 'done')

async def take_H(T):
    pg = T.page; h1, h2, h3 = T.a('h1'), T.a('h2'), T.a('h3')
    await T.at(0.4); await T.click(nav(pg, '待我确认'), dur=0.8)
    await T.wait(pg.get_by_text('观察确认').first.wait_for(timeout=120000))
    await T.at(h1 + 2.0); await tag(T, '观察确认', 'lane1', 2); await T.mark(pg.locator('[data-fx=lane1]'), 'lane')
    c = pg.get_by_text('张三这周解方程连续三次在移项变号上出错，需要课前单独强调。').first
    await T.at(h1 + 6.0); await T.to(c, dur=1.0)
    await T.at(h2 + 0.3); await T.click(c, dur=0.8)
    await T.wait(btn(pg, '接受').wait_for(state='visible', timeout=120000))
    await T.mark(pg.get_by_text('教师内部').first, 'internal'); await T.mark(btn(pg, '接受'), 'accept')
    for nm in ['接受', '修改', '拒绝', '暂缓']:
        await T.at(max(T.now(), T.w('h2', nm, -0.15))); await T.to(btn(pg, nm), dur=0.4)
    await T.at(T.w('h2', '接受之后', 0.0)); await T.click(btn(pg, '接受'), dur=0.5)
    await T.wait(btn(pg, '接受').wait_for(state='detached', timeout=180000))
    await T.at(h3 + 0.1); await go2(T, '班级')
    await T.wait(pg.get_by_text('张三', exact=True).first.wait_for(timeout=120000))
    await T.at(h3 + 1.6); await T.click(pg.get_by_text('张三', exact=True).first, dur=0.9)
    await T.at(h3 + 3.6); await T.click(pg.get_by_text('家校人物').first, dur=0.8)
    await T.at(h3 + 5.6)
    rec_ = btn(pg, '记录')
    if await rec_.count(): await T.click(rec_, dur=0.7)
    await T.mark(pg.get_by_text('家校记录').first, 'family')

async def take_I(T):
    pg = T.page; i1 = T.a('i1')
    await T.at(0.4); await T.click(nav(pg, '材料'), dur=0.8)
    await T.wait(pg.get_by_text('已接入材料').first.wait_for(timeout=120000))
    await T.at(i1 + 1.8); await T.mark(pg.get_by_text('已接入材料').first, 'table')
    row = pg.get_by_text('七年级数学 第三章 有理数的加减 教案').first
    await T.at(i1 + 4.6); await T.click(row, dur=0.9)
    await T.mark(pg.get_by_text('材料信息').first, 'detail')

TAKES = {'E': take_E, 'F': take_F, 'G': take_G, 'H': take_H, 'I': take_I}
async def main(names, record=True):
    async with async_playwright() as p:
        R = Rec(); await R.start(p)
        for n in names:
            err = await R.take(n, TAKES[n], record=record); print('take', n, 'ok' if not err else 'ERR')
        await R.b.close()
if __name__ == '__main__':
    asyncio.run(main(sys.argv[2:] or list(TAKES), record=(sys.argv[1] != 'dry')))
