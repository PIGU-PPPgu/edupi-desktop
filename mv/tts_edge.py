import asyncio, json, subprocess, pathlib, edge_tts
B = pathlib.Path('build'); VO = json.load(open(B/'vo.json')); OLD = {k: v['d'] for k, v in VO.items()}
VOICE = 'zh-CN-XiaoxiaoNeural'
def dur(p): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
async def gen(text, rate, out):
    for _ in range(4):
        try: await edge_tts.Communicate(text, VOICE, rate=rate).save(str(out)); return
        except Exception as e: err = e; await asyncio.sleep(2)
    raise err
async def main():
    for k, v in VO.items():
        t = v['text']; tmp = B/'tmp.mp3'; await gen(t, '+0%', tmp); d0 = dur(tmp)
        pct = max(-25, min(40, round((d0/OLD[k] - 1)*100))); await gen(t, f"{pct:+d}%", tmp); d1 = dur(tmp)
        ratio = max(0.85, min(1.2, d1/OLD[k]))
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(tmp),'-af',f"atempo={ratio:.4f},apad,highpass=f=70,loudnorm=I=-18:TP=-2",'-t',f"{OLD[k]:.3f}",'-ar','44100','-ac','1',str(B/'vo'/f'{k}.wav')],check=True)
        print(k, f"old {OLD[k]:.1f}s  edge {d0:.1f}s -> rate {pct:+d}% -> {d1:.1f}s  atempo {ratio:.3f}")
asyncio.run(main())
