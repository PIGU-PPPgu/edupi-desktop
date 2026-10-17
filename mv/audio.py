import json, wave, pathlib, numpy as np
HERE = pathlib.Path(__file__).parent; B = HERE/"build"; SR = 44100
ev = json.load(open(B/"events.json")); DUR = ev["dur"] + 1.5
N = int(DUR*SR); rng = np.random.default_rng(7)
def rd(p):
    w = wave.open(str(p)); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)/32768; return a
def add(buf, x, t, g=1.0, pan=0.0):
    i = int(t*SR)
    if i >= N or i < 0: return
    j = min(N, i+len(x)); x = x[:j-i]*g
    buf[0, i:j] += x*(1-max(0, pan)); buf[1, i:j] += x*(1+min(0, pan))
def fnoise(n, lo, hi):
    x = rng.standard_normal(n); X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1/SR); X[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(X, n); return (y/np.max(np.abs(y))).astype(np.float32)
def pluck(freq, dur, bright=1.0):
    t = np.arange(int(dur*SR))/SR; e = np.exp(-t*7)*(1-np.exp(-t*900))
    return (np.sin(2*np.pi*freq*t)+.35*bright*np.sin(2*np.pi*2*freq*t)*np.exp(-t*9)+.12*np.sin(2*np.pi*3.01*freq*t)*np.exp(-t*14))*e*.6
def sq(freq, dur, duty=.5):
    t = np.arange(int(dur*SR))/SR; w = np.where((t*freq) % 1 < duty, 1., -1.); e = np.exp(-t*(6/dur)*.5)*np.minimum(1, t*400); return w*e*.5
mid = lambda m: 440*2**((m-69)/12)
PENT = [60, 62, 64, 67, 69]  # C D E G A
def pent(i): return PENT[i % 5] + 12*(i//5)
bus = np.zeros((2, N), np.float32); music = np.zeros((2, N), np.float32); vo = np.zeros(N, np.float32); sfx = np.zeros((2, N), np.float32)

# --- voiceover
for l in ev["vo"]:
    a = rd(B/"vo"/f"{l['id']}.wav"); a = a/ (np.sqrt(np.mean(a**2))+1e-6) * 0.105
    i = int(l["t"]*SR); vo[i:i+len(a)] += a[:N-i]

# --- music bed: pad + pluck arpeggio, 84 BPM
bpm = 84; beat = 60/bpm; bar = 4*beat
chords = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]]
def sect_density(t):
    for s in ev["scenes"]:
        if s["t0"] <= t < s["t1"]: return 2 if s["kind"] == "desk" else 1
    return 1
nb = int(DUR/bar)+1
for b in range(nb):
    t0 = b*bar; ch = chords[b % 4]; n = int((bar+.6)*SR); t = np.arange(n)/SR
    env = np.minimum(1, t/.5)*np.minimum(1, (bar+.6-t)/.6)
    for k, m in enumerate(ch):
        f = mid(m); pad = (np.sin(2*np.pi*f*t)+.5*np.sin(2*np.pi*(f*1.003)*t)+.25*np.sin(2*np.pi*2*f*t))*env*.05
        add(music, pad.astype(np.float32), t0, 1, (-.3 if k % 2 else .3))
    d = sect_density(t0)
    steps = 8 if d == 2 else 4
    for s in range(steps):
        if d == 1 and (b+s) % 2: continue
        idx = [0, 2, 4, 3, 5, 4, 2, 1][s % 8] + (5 if b % 4 in (1, 3) else 0)
        add(music, pluck(mid(pent(idx)+12), .6).astype(np.float32), t0+s*(bar/steps), .13 if d == 2 else .10, (-.4 if s % 2 else .4))
# soft chiptune shimmer in desk scenes
for s in ev["scenes"]:
    if s["kind"] != "desk": continue
    t = s["t0"]+.5
    while t < s["t1"]-.5:
        for k, m in enumerate([72, 76, 79, 76]):
            add(music, sq(mid(m), .09).astype(np.float32), t+k*beat/2, .018, .5)
        t += bar
mfade = np.minimum(1, np.arange(N)/(SR*2.0))*np.minimum(1, (N-np.arange(N))/(SR*3.5))
music *= mfade

# --- real-footage events (clicks, typing) from recorded takes
SPD = pathlib.Path(open(B/'sp.txt').read().strip())
for sc in ev['scenes']:
    pth = SPD/'takes'/sc['id']/'events.json'
    if sc.get('real') and pth.exists():
        for e in json.load(open(pth)):
            if e['type'] == 'click': ev['ev'].append({'type': 'click', 't': sc['t0'] + e['t'] + .1})
            elif e['type'] == 'keys': ev['ev'].append({'type': 'keys', 't0': sc['t0'] + e['t'], 't1': sc['t0'] + e.get('t1', e['t'] + 2)})
# --- sfx
for e in ev["ev"]:
    ty = e["type"]
    if ty == "blip":
        add(sfx, pluck(mid(pent(int(e["val"]*9))+12), .3, .6).astype(np.float32), e["t"], .06+.10*e["val"], .3)
    elif ty == "pop":
        add(sfx, pluck(mid(pent(e["val"] % 10)+24), .22, .5).astype(np.float32), e["t"], .05, -.3)
    elif ty == "scratch":
        d = e["t1"]-e["t0"]
        if d <= 0: continue
        n = int(d*SR); nz = fnoise(n, 1500, 6500); t = np.arange(n)/SR
        am = (.55+.45*np.sin(2*np.pi*(7+3*rng.random())*t+rng.random()*6))**2*np.minimum(1, t*30)*np.minimum(1, (d-t)*30)
        add(sfx, (nz*am).astype(np.float32), e["t0"], .045)
    elif ty == "click":
        n = int(.04*SR); t = np.arange(n)/SR; x = (fnoise(n, 1000, 7000)*np.exp(-t*220)+np.sin(2*np.pi*1100*t)*np.exp(-t*160)*.6).astype(np.float32)
        add(sfx, x, e["t"], .22)
    elif ty == "keys":
        t = e["t0"]
        while t < e["t1"]:
            n = int(.025*SR); tt = np.arange(n)/SR; x = (fnoise(n, 1800, 6500)*np.exp(-tt*140)+np.sin(2*np.pi*(120+rng.random()*40)*tt)*np.exp(-tt*120)*.8).astype(np.float32)
            add(sfx, x, t, .10+.05*rng.random()); t += .06+.09*rng.random()
    elif ty == "land":
        add(sfx, sq(mid(76), .06).astype(np.float32), e["t"], .08, .4); add(sfx, sq(mid(83), .08).astype(np.float32), e["t"]+.06, .07, .4)
        n = int(.12*SR); tt = np.arange(n)/SR; add(sfx, (fnoise(n, 300, 2200)*np.exp(-tt*40)).astype(np.float32), e["t"], .06)
    elif ty == "wipe":
        n = int(1.2*SR); nz = fnoise(n, 400, 9000); tt = np.arange(n)/SR; am = np.sin(np.pi*np.clip(tt/1.2, 0, 1))**1.5
        add(sfx, (nz*am).astype(np.float32), e["t"]-.6, .10)
        for k in range(10): add(sfx, sq(mid(60+pent(k)-60+12), .07).astype(np.float32), e["t"]-.55+k*.06, .05, (-.5 if k % 2 else .5))

# --- duck music/sfx under VO
win = int(.05*SR); e = np.sqrt(np.convolve(vo**2, np.ones(win)/win, mode="same"))
env = np.zeros(N, np.float32); a = 0.0
att, rel = np.exp(-1/(SR*.04)), np.exp(-1/(SR*.5))
for i in range(0, N, 64):
    v = e[i:i+64].max(); a = v + (a-v)*(att if v > a else rel); env[i:i+64] = a
duck = 1 - .6*np.clip(env/0.09, 0, 1)
mix = np.stack([vo, vo]) + music*duck*.9 + sfx*(.55+.45*duck)
pk = np.max(np.abs(mix)); mix = np.tanh(mix*1.1)/np.tanh(1.1*max(1, pk*1.0))*0.9 if pk > 1 else mix
mix = mix/np.max(np.abs(mix))*0.89
out = (mix.T*32767).astype(np.int16)
w = wave.open(str(B/"mix.wav"), "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes()); w.close()
print("mix", round(DUR, 1), "s; vo rms", float(np.sqrt(np.mean(vo[vo != 0]**2))))
