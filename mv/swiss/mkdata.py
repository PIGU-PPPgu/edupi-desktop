import json, pathlib
HERE = pathlib.Path(__file__).parent; SP = pathlib.Path((HERE.parent/'build/sp.txt').read_text().strip())
vo = json.load(open(HERE/'build/vo.json')); warps = {}; marks = {}
for n in 'EFGHI':
    f = SP/'stakes'/n/'warps.json'
    if f.exists(): warps[n] = json.load(open(f))
    e = SP/'stakes'/n/'events.json'
    if e.exists(): marks[n] = [x for x in json.load(open(e)) if x['type'] == 'mark']
(HERE/'build/data.js').write_text('window.DATA=' + json.dumps({'vo': vo, 'sp': str(SP), 'warps': warps, 'marks': marks}, ensure_ascii=False))
print('data.js ok', len(vo), 'lines; warps', {k: len(v) for k, v in warps.items()})
