import json, math, pathlib, subprocess, sys
HERE = pathlib.Path(__file__).parent; SP = pathlib.Path((HERE/'build/sp.txt').read_text().strip())
EV = json.load(open(HERE/'build/events.json')); SC = {s['id']: s for s in EV['scenes']}
FPS = 30; nA = round(SC['E']['t0']*FPS); iK = round(SC['K']['t0']*FPS); N = math.ceil(EV['dur']*FPS)
def run(*a): subprocess.run([str(x) for x in a], check=True)
tmp = SP/'seg'; tmp.mkdir(exist_ok=True)
CUT = {'J': 28.4}
prev = nA; segs = []
for n in 'EFGHIJ':
    end = round(SC[n]['t1']*FPS); nf = end - prev; prev = end
    out = tmp/f'{n}.mp4'; cut = CUT.get(n)
    if cut is None:
        vf = f"fps={FPS},trim=end_frame={nf},setpts=PTS-STARTPTS,format=yuv420p"
        run('ffmpeg','-y','-loglevel','error','-i',SP/'takes'/n/'clip.mp4','-vf',vf,'-r',FPS,'-c:v','libx264','-crf','12','-preset','fast','-pix_fmt','yuv420p',out)
    else:
        k = int(cut*FPS); still = tmp/f'{n}_still.png'
        run('ffmpeg','-y','-loglevel','error','-i',SP/'takes'/n/'clip.mp4','-vf',f"fps={FPS},select=eq(n\\,{k-1})",'-frames:v','1',still)
        run('ffmpeg','-y','-loglevel','error','-i',SP/'takes'/n/'clip.mp4','-vf',f"fps={FPS},trim=end_frame={k},setpts=PTS-STARTPTS,format=yuv420p",'-r',FPS,'-c:v','libx264','-crf','12','-preset','fast','-pix_fmt','yuv420p',tmp/f'{n}_a.mp4')
        run('ffmpeg','-y','-loglevel','error','-loop','1','-framerate',FPS,'-i',still,'-frames:v',nf-k,'-vf','format=yuv420p','-r',FPS,'-c:v','libx264','-crf','12','-preset','fast','-pix_fmt','yuv420p',tmp/f'{n}_b.mp4')
        (tmp/f'{n}_l.txt').write_text(f"file '{tmp}/{n}_a.mp4'\nfile '{tmp}/{n}_b.mp4'")
        run('ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',tmp/f'{n}_l.txt','-c','copy',out)
    segs.append(out); print(n, nf)
assert prev == iK, (prev, iK)
lst = tmp/'list.txt'; lst.write_text("\n".join(f"file '{p}'" for p in segs))
run('ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',lst,'-c','copy',tmp/'B_raw.mp4')
run('ffmpeg','-y','-loglevel','error','-i',tmp/'B_raw.mp4','-framerate',FPS,'-i',SP/'wipe'/'w%03d.png','-filter_complex','[0:v][1:v]overlay=eof_action=pass:shortest=0,format=yuv420p[v]','-map','[v]','-r',FPS,'-c:v','libx264','-crf','12','-preset','fast',tmp/'B.mp4')
conv = "scale=in_range=pc:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p"
out = HERE/'EduPi_演示视频_真实客户端版.mp4'
run('ffmpeg','-y','-loglevel','error',
    '-framerate',FPS,'-start_number',0,'-i',SP/'final'/'f%06d.jpg','-i',tmp/'B.mp4','-framerate',FPS,'-start_number',iK,'-i',SP/'final'/'f%06d.jpg','-i',HERE/'build'/'mix.wav',
    '-filter_complex',f"[0:v]{conv}[a];[1:v]format=yuv420p[b];[2:v]{conv}[c];[a][b][c]concat=n=3:v=1:a=0[v]",
    '-map','[v]','-map','3:a','-r',FPS,'-c:v','libx264','-crf','18','-preset','medium','-profile:v','high','-level','4.1','-pix_fmt','yuv420p',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv',
    '-c:a','aac','-b:a','192k','-ar','44100','-af',f"loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={N/FPS-2.2:.2f}:d=2.2",'-movflags','+faststart','-shortest',out)
print(out)
