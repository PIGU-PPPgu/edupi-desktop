import json, wave, pathlib, subprocess, numpy as np
HERE = pathlib.Path(__file__).parent; B = HERE/'build'; SR = 44100
ev = json.load(open(B/'events.json')); DUR = ev['dur'] + 1.0; N = int(DUR*SR); rng = np.random.default_rng(3)
def rd(p):
    w = wave.open(str(p)); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)/32768
    if w.getnchannels() == 2: a = a.reshape(-1, 2).mean(1)
    if w.getframerate() != SR:
        x = np.arange(int(len(a)*SR/w.getframerate()))*w.getframerate()/SR; a = np.interp(x, np.arange(len(a)), a).astype(np.float32)
    return a
mid = lambda m: 440*2**((m-69)/12)
def tone(f, d, dec=9):
    t = np.arange(int(d*SR))/SR; return (np.sin(2*np.pi*f*t)+.3*np.sin(4*np.pi*f*t)*np.exp(-t*12))*np.exp(-t*dec)*np.minimum(1, t*600)
def tick():
    n = int(.03*SR); x = rng.standard_normal(n); t = np.arange(n)/SR; return (x*np.exp(-t*160)).astype(np.float32)
vo = np.zeros(N, np.float32); music = np.zeros(N, np.float32); fx = np.zeros(N, np.float32)
def put(buf, x, t, g=1):
    i = int(t*SR)
    if 0 <= i < N: j = min(N, i+len(x)); buf[i:j] += x[:j-i]*g
for l in ev['vo']:
    a = rd(B/'vo'/f"{l['id']}.wav"); put(vo, a/(np.sqrt(np.mean(a**2))+1e-6)*.1, l['t'])
BEAT = .625; PENT = [57, 60, 62, 64, 67, 69]
for k in range(int(DUR/BEAT)):                       # minimal pulse on the beat grid
    t = k*BEAT; bar = k//4
    if k % 4 == 0: put(music, tone(mid(45 if bar % 2 == 0 else 43), BEAT*3.5, 2.2).astype(np.float32), t, .16)
    if k % 2 == 1: put(music, tone(mid(PENT[(k*3+bar) % 6]+12), .5, 7).astype(np.float32), t, .05)
    put(music, tick(), t+BEAT/2, .02)
music *= np.minimum(1, np.arange(N)/(SR*1.5))*np.minimum(1, (N-np.arange(N))/(SR*3))
# duck music under VO (~10 dB)
env = np.convolve(np.abs(vo), np.ones(int(.25*SR))/int(.25*SR), 'same'); duck = 1-.68*np.minimum(1, env/.04); music *= duck
for t in ev['snaps']:                                  # dry foley on every snap
    put(fx, tick(), t, .5)
x = vo + music + fx; x = np.tanh(x*1.1)
pcm = (np.clip(x, -1, 1)*32767).astype(np.int16)
w = wave.open(str(B/'mix_raw.wav'), 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes()); w.close()
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(B/'mix_raw.wav'), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=7,pan=stereo|c0=c0|c1=c0', '-ar', '48000', str(B/'mix.wav')], check=True)
print('audio ok', round(DUR, 1))
