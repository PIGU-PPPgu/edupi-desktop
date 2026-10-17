import asyncio, json, pathlib, subprocess, sys
from rec import *

ASSETS = SP/'demo-assets'
RAIL = ".edupi-teacher-rail__text"
def nav(pg, label): return pg.locator(RAIL).get_by_text(label, exact=True).first
def btn(pg, name): return pg.locator(f'button:visible:text-is("{name}")').first
async def settle(T, ms=1200): await T.page.wait_for_timeout(ms)
async def reset_cam(T, dur=1.0): await T.fx('cam', 1.0, 720, 405, dur)
async def go(T, label, pre=0.9, dur=0.8):
    await T.fx('hideMascot'); await reset_cam(T, pre); await asyncio.sleep(pre + 0.1); await T.click(nav(T.page, label), dur=dur)

async def take_E(T):
    pg = T.page; a1, a2 = T.a('e1'), T.a('e2')
    await T.fx('cam', 1.35, 1290, 650, 1.4)
    await T.at(a1 + 0.2); await T.fx('stand', '.edupi-first-run__dialog', 0.88, 0.7)
    steps = ['连接模型', '确认教师资料', '导入学生名单', '导入校历与课表', '上传第一份材料', '第一次备课', '进入今天']
    ts = [T.w('e1', s) for s in steps]
    for k in range(1, 7):
        await T.at(max(T.now(), ts[k] - 0.45))
        await T.click(pg.locator('.edupi-first-run__skip', has_text='跳过此步').first, dur=0.55)
    await T.at(a2 + 0.2)
    await T.click(pg.locator('.edupi-first-run__skip', has_text='稍后再说').first, dur=0.6)
    await T.fx('hideMascot'); await reset_cam(T, 0.9)
    try: await pg.locator('.edupi-first-run').wait_for(state='hidden', timeout=5000)
    except Exception: print('tour still visible')
    await T.at(a2 + 1.8)
    async def open_ctx():
        for _ in range(6):
            await T.click(btn(pg, '教学上下文'), dur=0.9)
            try:
                await pg.locator('[role=dialog]').first.wait_for(state='visible', timeout=7000); return
            except Exception: pass
    await T.wait(open_ctx())
    await T.fx('cam', 1.15, 720, 400, 1.2)
    await T.at(max(T.now(), a2 + 4.6))
    await T.fx('stand', '[role=dialog]', 0.9, 0.7)
    await T.at(a2 + 9.0)
    await pg.keyboard.press('Escape'); await reset_cam(T, 1.0)


async def tag(T, text, name, up=0):
    """Mark the smallest element whose own text is `text` (optionally its ancestor) with data-fx=name."""
    return await T.page.evaluate("""([t,n,up])=>{const els=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()===t&&e.getBoundingClientRect().width>0);if(!els.length)return false;let e=els[0];for(let i=0;i<up;i++)e=e.parentElement||e;e.setAttribute('data-fx',n);return true}""", [text, name, up])
async def stand(T, name, f=0.9, dur=0.7): return await T.fx('stand', f'[data-fx={name}]', f, dur)

async def take_F(T):
    pg = T.page; f1, f2, f3 = T.a('f1'), T.a('f2'), T.a('f3')
    await T.at(0.4); await T.click(nav(pg, '日程'), dur=0.7)
    await T.wait(btn(pg, '上传文件').wait_for(state='visible', timeout=120000))
    await T.at(f1 + 1.2); await T.to(btn(pg, '上传文件'), dur=0.9)
    await T.at(f1 + 2.6)
    async with pg.expect_file_chooser(timeout=10000) as fc:
        await T.click(btn(pg, '上传文件'), dur=0.2)
    await (await fc.value).set_files(str(ASSETS / 'notice2.pdf'))
    await T.wait(pg.get_by_text('待接入材料').first.wait_for(timeout=120000))
    await T.fx('cam', 1.25, 760, 240, 1.2)
    await T.at(f1 + 5.4); await T.click(btn(pg, '接入 EduPi'), dur=0.9)
    await T.wait(pg.get_by_text('确认接入').first.wait_for(timeout=60000))
    await tag(T, '材料名称', 'intake', 3); await T.fx('stand', '[data-fx=intake]', 0.92, 0.7)
    await T.at(f1 + 7.6)
    name = pg.locator('input').filter(has=None).first
    inp = pg.locator('input[value="notice2.pdf"]').first
    await T.click(inp, dur=0.7); await pg.keyboard.press('Meta+A'); await T.type('期中复习及考试安排通知', cps=9)
    await T.at(f1 + 10.8); await T.click(btn(pg, '确认接入'), dur=0.8)
    await T.wait(pg.get_by_text('待接入材料').first.wait_for(state='detached', timeout=120000))
    # f2: month view with sources
    await T.at(f2 + 0.1); await go(T, '日程')
    await T.wait(btn(pg, '上传文件').wait_for(state='visible', timeout=120000))
    await T.fx('cam', 1.12, 960, 420, 1.2)
    await T.at(f2 + 2.4); await T.click(pg.get_by_text('七年级家长会').first, dur=0.9)
    await T.at(f2 + 6.8)
    await pg.keyboard.press('Escape')
    # f3: pending date
    await T.at(f3 + 0.6); await T.click(pg.get_by_text('期中考试').first, dur=0.9)
    await T.fx('cam', 1.2, 1000, 300, 1.2)
    await T.at(f3 + 2.6); await stand(T, 'pend') if await tag(T, '日期待确认', 'pend') else None
    await T.fx('wiggle', 1.4)
    await T.at(T.dur - 1.2); await reset_cam(T, 1.0)

async def take_G(T):
    pg = T.page; g1, g2 = T.a('g1'), T.a('g2')
    await T.at(0.4); await T.click(nav(pg, '今天'), dur=0.7)
    await T.wait(pg.get_by_text('接下来').first.wait_for(timeout=120000))
    await T.fx('cam', 1.1, 760, 380, 1.2)
    await T.at(g1 + 1.8); await tag(T, '接下来', 'nextcard', 2); await stand(T, 'nextcard', 0.8)
    await T.at(g1 + 5.5); await T.fx('hideMascot'); await reset_cam(T, 0.9); await asyncio.sleep(1.0); await T.to(pg.locator(RAIL).get_by_text('待我确认', exact=True).first, fx=1.6, dur=1.0)
    await T.at(g2 + 0.1); await go(T, '工作区')
    await T.wait(pg.get_by_text('待处理').first.wait_for(timeout=120000))
    await T.fx('cam', 1.2, 760, 400, 1.2)
    await T.at(g2 + 2.6)
    card = pg.get_by_text('七年级数学《有理数的加减》课前准备').first
    await T.to(card, dur=0.9)
    await tag(T, '七年级数学《有理数的加减》课前准备', 'card1', 3); await stand(T, 'card1', 0.5)
    await T.at(g2 + 3.4)
    sel = pg.locator('[data-fx=card1] select').first
    await T.click(sel, dur=0.9)
    await sel.select_option(value='progress')
    await T.wait(pg.get_by_text('正在移动').first.wait_for(state='detached', timeout=180000))
    await T.at(T.dur - 1.0); await reset_cam(T, 1.0)

async def take_H(T):
    pg = T.page; h1, h2, h3 = T.a('h1'), T.a('h2'), T.a('h3')
    await T.at(0.4); await T.click(nav(pg, '待我确认'), dur=0.8)
    await T.wait(pg.get_by_text('观察确认').first.wait_for(timeout=120000))
    await T.fx('cam', 1.15, 820, 470, 1.2)
    await T.at(h1 + 2.0); await tag(T, '观察确认', 'lane1', 2); await stand(T, 'lane1', 0.5)
    await T.at(h1 + 5.0); await T.to(pg.get_by_text('张三这周解方程连续三次在移项变号上出错，需要课前单独强调。').first, dur=1.0)
    await T.at(h1 + 8.5); await T.to(pg.get_by_text('教师内部').first, dur=0.8) if await pg.get_by_text('教师内部').count() else None
    await T.at(h2 + 0.4); await T.fx('hideMascot')
    await T.click(pg.get_by_text('张三这周解方程连续三次在移项变号上出错，需要课前单独强调。').first, dur=0.9)
    await T.wait(btn(pg, '接受').wait_for(state='visible', timeout=120000))
    await T.fx('cam', 1.25, 900, 330, 1.2)
    for nm in ['接受', '修改', '拒绝', '暂缓']:
        await T.at(max(T.now(), T.w('h2', nm, -0.2))); await T.to(btn(pg, nm), dur=0.45)
    await T.at(T.w('h2', '接受之后', 0.0)); await T.click(btn(pg, '接受'), dur=0.6)
    await T.wait(btn(pg, '接受').wait_for(state='detached', timeout=180000))
    await T.at(h3 + 0.1); await go(T, '班级')
    await T.wait(pg.get_by_text('张三', exact=True).first.wait_for(timeout=120000))
    await T.at(h3 + 2.4); await T.click(pg.get_by_text('张三', exact=True).first, dur=0.9)
    await T.fx('cam', 1.25, 1100, 330, 1.2)
    await T.at(h3 + 5.2)
    lst = btn(pg, '列表')
    if await lst.count(): await T.click(lst, dur=0.8)
    await T.at(T.dur - 1.0); await reset_cam(T, 1.0)

async def take_I(T):
    pg = T.page; i1, i2 = T.a('i1'), T.a('i2')
    await T.at(0.4); await T.click(nav(pg, '材料'), dur=0.8)
    await T.wait(pg.get_by_text('已接入材料').first.wait_for(timeout=120000))
    await T.fx('cam', 1.12, 960, 400, 1.2)
    await T.at(i1 + 2.4); await T.to(pg.get_by_text('七年级数学 第三章 有理数的加减 教案').first, dur=0.9)
    await tag(T, '七年级数学 第三章 有理数的加减 教案', 'mat1', 2); await stand(T, 'mat1', 0.55)
    await T.at(i1 + 6.0); await T.click(pg.get_by_text('七年级数学 第三章 有理数的加减 教案').first, dur=0.7)
    await T.at(i2 + 0.1); await T.fx('hideMascot'); await pg.keyboard.press('Escape'); await reset_cam(T, 0.9); await asyncio.sleep(1.0)
    try:
        async with pg.expect_file_chooser(timeout=6000) as fc:
            await T.click(btn(pg, '上传材料'), dur=0.8)
        await (await fc.value).set_files(str(ASSETS / 'extra.pdf'))
    except Exception:
        print('chooser fallback'); await pg.locator('input[type=file]').first.set_input_files(str(ASSETS / 'extra.pdf'))
    await T.wait(pg.get_by_text('待接入材料').first.wait_for(timeout=120000))
    await T.fx('cam', 1.15, 1100, 240, 1.0)
    await T.at(T.w('i2', '移除', -0.4))
    rm = pg.locator('button:not([disabled])', has_text='移除').first
    await T.click(rm, dur=0.8); await T.wait(pg.get_by_text('待接入材料').first.wait_for(state='detached', timeout=120000))
    await T.at(T.dur - 1.0); await reset_cam(T, 1.0)

async def take_J(T):
    pg = T.page; j1, j2 = T.a('j1'), T.a('j2')
    ta = pg.locator('textarea:visible').first
    await T.at(0.4); await T.click(ta, fx=0.3, dur=0.8)
    await T.at(j1 + 1.0); await T.type('根据我的七年级数学安排，今天先准备什么？', cps=9)
    await T.at(max(T.now(), j1 + 4.4))
    send = pg.get_by_role('button', name='发送').first
    await T.click(send, dur=0.7)
    await T.fx('cam', 1.12, 960, 480, 1.4)
    await T.wait(pg.get_by_text('提醒还有 1 项待审核').first.wait_for(timeout=300000))
    await asyncio.sleep(2.5)
    await T.at(T.dur - 1.0); await reset_cam(T, 1.0)

TAKES = {'E': take_E, 'F': take_F, 'G': take_G, 'H': take_H, 'I': take_I, 'J': take_J}
START = {'E': None, 'F': None, 'G': None, 'H': None, 'I': None, 'J': 'AI 协作'}

async def main(names, record=True):
    async with async_playwright() as p:
        R = Rec(); await R.start(p)
        for n in names:
            if START.get(n):
                await nav(R.page, START[n]).click(); await R.page.wait_for_timeout(1500)
                if n == 'J':
                    for _ in range(40):
                        if '帮我批准' in await R.page.inner_text('body'): break
                        await R.page.wait_for_timeout(2500)
                    await R.page.wait_for_timeout(2000)
            err = await R.take(n, TAKES[n], record=record)
            print('take', n, 'ok' if not err else 'ERR')
        await R.b.close()

if __name__ == '__main__':
    mode = sys.argv[1]; names = sys.argv[2:] or list(TAKES)
    asyncio.run(main(names, record=(mode != 'dry')))
