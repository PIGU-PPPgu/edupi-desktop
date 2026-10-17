import asyncio, base64, json, math, os, pathlib, re, subprocess, time
SWISS = bool(os.environ.get('SWISS'))
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).parent
SP = pathlib.Path((HERE/'build/sp.txt').read_text().strip())
URL = "http://127.0.0.1:30373/"
BUILD = HERE/('swiss/build' if SWISS else 'build'); TAKESDIR = 'stakes' if SWISS else 'takes'
EVT = json.load(open(BUILD/'events.json')); VO = json.load(open(BUILD/'vo.json'))
SC = {s['id']: s for s in EVT['scenes']}
FPS = 30
def sm(u): u = max(0, min(1, u)); return u*u*(3-2*u)
def chunks(text):
    cl = re.findall(r'[^，。：；？、]+[，。：；？、]?', text) or [text]; ch=[]; cur=''
    for c in cl:
        if len(cur+c) > 21 and cur: ch.append(cur); cur=c
        else: cur += c
    if cur: ch.append(cur)
    return ch
class Take:
    def __init__(self, rec, scene):
        self.rec=rec; self.page=rec.page; self.sc=SC[scene]; self.name=scene; self.dur=self.sc['t1']-self.sc['t0']; self.events=[]; self.T0=None; self.warps=[]; self.saved=0.0
        self.L={k:v-self.sc['t0'] for k,v in self.sc['L'].items()}
    def now(self): return (time.time()-self.T0)-self.saved
    def a(self, line): return self.L[line]
    def w(self, line, word, off=0.0):
        v = VO[line]; words = v.get('words')
        if words:
            acc = ''
            for w_ in words:
                acc += w_['text']
                if word in acc: return self.L[line] + w_['t'] + off
        t = v['text']; i = max(0, t.find(word)); return self.L[line] + v['d']*i/len(t) + off
    async def wait(self, aw, factor=8, grace=1.2):
        task = asyncio.ensure_future(aw)
        done, _ = await asyncio.wait({task}, timeout=grace)
        if task.done():
            try: task.result()
            except Exception as e: print('wait failed', repr(e)[:120])
            return
        a = time.time()-self.T0; await self.fx('warp', True, factor)
        try: await task
        except Exception as e: print('wait timeout', repr(e)[:120])
        b = time.time()-self.T0; await self.fx('warp', False, factor)
        self.warps.append((a, b, factor)); self.saved += (b-a)*(1-1/factor)
    async def at(self, t):
        d = t-self.now()
        if d>0: await asyncio.sleep(d)
    async def fx(self, name, *args):
        if SWISS and name in ('chap','part','sub','stand','cam','hideMascot','wiggle','warp','hideAll'): return None
        return await self.page.evaluate(f"(a)=>window.__fx.{name}(...a)", list(args))
    def log(self, type_, **kw): self.events.append({'t':round(self.now(),3),'type':type_,**kw})
    async def glide(self, x, y, dur=0.7, arc=0.06):
        x0,y0=self.rec.mx,self.rec.my; d=math.hypot(x-x0,y-y0) or 1; nx,ny=-(y-y0)/d,(x-x0)/d; t0=time.time(); n=max(2,int(dur*60))
        for i in range(1,n+1):
            u=sm(i/n); a=math.sin(math.pi*u)*d*arc
            await self.page.mouse.move(x0+(x-x0)*u+nx*a, y0+(y-y0)*u+ny*a)
            await asyncio.sleep(max(0, t0+dur*i/n-time.time()))
        self.rec.mx,self.rec.my=x,y
    async def mark(self, loc, name='m'):
        try:
            b = await loc.first.bounding_box(timeout=1500)
            if b: self.log('mark', name=name, box=[round(b['x'],1), round(b['y'],1), round(b['width'],1), round(b['height'],1)])
        except Exception: pass
    async def box(self, loc, timeout=8000):
        await loc.first.wait_for(state='visible', timeout=timeout); b=await loc.first.bounding_box(); return b
    async def to(self, loc, fx=0.5, fy=0.5, dur=0.7):
        b=await self.box(loc); await self.glide(b['x']+fx*b['width'], b['y']+fy*b['height'], dur)
    async def click(self, loc, fx=0.5, fy=0.5, dur=0.7):
        await self.to(loc,fx,fy,dur); await asyncio.sleep(.12); await self.page.mouse.down(); await asyncio.sleep(.07); await self.page.mouse.up(); self.log('click')
    async def type(self, text, cps=11):
        self.log('keys', t1=round(self.now()+len(text)/cps,3))
        for ch in text: await self.page.keyboard.type(ch); await asyncio.sleep(1/cps)
    async def subs(self):
        async def run(line, text, d, start):
            ch=chunks(text); tot=sum(len(c) for c in ch); tt=start+.05
            for c in ch:
                dd=(d-.1)*len(c)/tot; await self.at(tt); await self.fx('sub', re.sub(r'[，；、。]$','',c)); await self.at(tt+dd-.05); tt+=dd
            await self.fx('sub','')
        return [asyncio.ensure_future(run(k, VO[k]['text'], VO[k]['d'], v)) for k,v in self.L.items()]
def narr(r, warps):
    n = r
    for a, b, f in warps:
        if r > a: n -= (min(r, b)-a)*(1-1/f)
    return n
async def clip(frames, T0, dur, outpath, warps=()):
    ent=[(max(0.0,narr(ts-T0, warps)),str(p)) for ts,p in frames]
    ent=[e for e in ent if e[0]<dur]
    if not ent: raise RuntimeError('no frames')
    ent[0]=(0.0,ent[0][1]); lst=[]
    for i,(t,p) in enumerate(ent):
        d=(ent[i+1][0]-t) if i+1<len(ent) else (dur-t)
        lst.append(f"file '{p}'\nduration {max(d,0.001):.4f}")
    lst.append(f"file '{ent[-1][1]}'")
    lf=outpath.with_suffix('.txt'); lf.write_text("\n".join(lst))
    subprocess.run(["ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(lf),"-vf",f"fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p","-c:v","libx264","-crf","12","-preset","fast","-t",f"{dur:.3f}",str(outpath)],check=True)
class Rec:
    async def start(self, p):
        try: self.b = await p.chromium.launch(channel="chrome")
        except Exception: self.b = await p.chromium.launch()
        self.ctx = await self.b.new_context(viewport={"width":1440,"height":810}, device_scale_factor=4/3)
        await self.ctx.add_init_script(path=str(HERE/'fx.js'))
        self.page = await self.ctx.new_page(); self.mx,self.my=1300.0,700.0
        await self.page.goto(URL, wait_until='load', timeout=120000)
        for _ in range(80):
            await self.page.wait_for_timeout(1000)
            if "正在读取教育工作区" not in await self.page.inner_text("body"): break
        await self.page.mouse.move(self.mx,self.my)
    async def take(self, name, fn, record=True):
        T=Take(self, name); frames=[]; out=SP/TAKESDIR/name; out.mkdir(parents=True,exist_ok=True)
        cdp=None
        if record:
            cdp=await self.ctx.new_cdp_session(self.page)
            async def handle(ev):
                ts=ev['metadata']['timestamp']; pth=out/f'{len(frames):05d}.jpg'; pth.write_bytes(base64.b64decode(ev['data'])); frames.append((ts,pth))
                try: await cdp.send('Page.screencastFrameAck',{'sessionId':ev['sessionId']})
                except Exception: pass
            cdp.on('Page.screencastFrame', lambda ev: asyncio.ensure_future(handle(ev)))
            await cdp.send('Page.startScreencast',{'format':'jpeg','quality':92,'maxWidth':1920,'maxHeight':1080,'everyNthFrame':1})
        T.T0=time.time()
        chap=T.sc.get('chap');
        await T.fx('chap', chap[0], chap[1]) if chap else None
        await T.fx('part','PART 2 · 核心功能演示与典型应用场景模拟')
        subs=await T.subs()
        err=None
        try: await fn(T)
        except Exception as e:
            err=e; print('TAKE ERROR', name, repr(e)[:300])
            try: await self.page.screenshot(path=str(SP/f'fail_{name}.png'))
            except Exception: pass
        await T.at(T.dur)
        for s in subs: s.cancel()
        if record:
            await asyncio.sleep(.2); await cdp.send('Page.stopScreencast')
            await clip(frames, T.T0, T.dur, out/'clip.mp4', T.warps); (out/'events.json').write_text(json.dumps(T.events,ensure_ascii=False)); (out/'warps.json').write_text(json.dumps([[round(narr(a,[]) - sum((min(a,bb)-aa)*(1-1/ff) for aa,bb,ff in T.warps if a>aa),3), round(narr(a,[]) - sum((min(a,bb)-aa)*(1-1/ff) for aa,bb,ff in T.warps if a>aa) + (b-a)/f,3), f] for a,b,f in T.warps]))
        await T.fx('sub','')
        if record:
            await T.fx('hideAll'); await asyncio.sleep(.3); await self.page.screenshot(path=str(out/'end.png'))
            await self.page.evaluate("document.getElementById('fxl').style.display=''")
        return err
