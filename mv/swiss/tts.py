import asyncio, json, subprocess, pathlib, edge_tts
HERE = pathlib.Path(__file__).parent; B = HERE/'build'
VOICE = 'zh-CN-XiaoxiaoNeural'; RATE = '-4%'
lines = [l.split('|',1) for l in (HERE/'vo.txt').read_text().splitlines() if l.strip()]
def dur(p): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
async def one(k, text):
    mp3 = B/'vo'/f'{k}.mp3'; words = []
    for attempt in range(5):
        try:
            c = edge_tts.Communicate(text, VOICE, rate=RATE, boundary='WordBoundary'); words = []
            with open(mp3, 'wb') as f:
                async for ch in c.stream():
                    if ch['type'] == 'audio': f.write(ch['data'])
                    elif ch['type'] == 'WordBoundary': words.append({'t': ch['offset']/1e7, 'd': ch['duration']/1e7, 'text': ch['text']})
            break
        except Exception as e: print('retry', k, repr(e)[:80]); await asyncio.sleep(2)
    wav = B/'vo'/f'{k}.wav'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(mp3),'-af','highpass=f=70,loudnorm=I=-18:TP=-2','-ar','44100','-ac','1',str(wav)],check=True)
    return {'text': text, 'd': dur(wav), 'words': words}
import sys
async def main():
    out = json.load(open(B/'vo.json')) if (B/'vo.json').exists() and len(sys.argv) > 1 else {}
    only = set(sys.argv[1:])
    for k, t in lines:
        if only and k not in only: continue
        out[k] = await one(k, t); print(k, round(out[k]['d'],1), len(out[k]['words']))
    (B/'vo.json').write_text(json.dumps(out, ensure_ascii=False))
    print('total', round(sum(v['d'] for v in out.values()),1))
asyncio.run(main())
