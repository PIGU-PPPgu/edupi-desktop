import json, subprocess, pathlib
b = pathlib.Path(__file__).parent / "build"
vo = {}
for l in (b/"vo.txt").read_text().splitlines():
    if not l.strip(): continue
    k, txt = l.split("|", 1)
    d = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",str(b/"vo"/f"{k}.wav")]))
    vo[k] = {"d": d, "text": txt}
(b/"data.js").write_text("window.DATA="+json.dumps({"commits":json.load(open(b/"commits.json")),"vo":vo},ensure_ascii=False))
(b/"vo.json").write_text(json.dumps(vo,ensure_ascii=False))
print(round(sum(v["d"] for v in vo.values()),1), "s total speech;", len(vo), "lines")
