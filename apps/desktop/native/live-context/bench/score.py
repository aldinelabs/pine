"""Scores run_matrix.py results.

  python -I score.py --root <scratch>   -> <scratch>/results/scores.json + tables on stdout

Accuracy: one token per CJK character, one per Latin word (so zh clips report
CER and mixed clips a mixed error rate; en clips report WER). Both sides are
normalized the same way: Traditional -> Simplified (OpenCC t2s), lower case,
punctuation removed, digits spelled out (zh: 2 -> 二, 15% -> 百分之十五,
0.001 -> 零点零零一; en: num2words), 两 -> 二, and fillers dropped
(嗯 呃 额 唔 / um uh hmm mm).
Latency (realtime runs, ms, relative to the reference utterance):
  first  - utterance onset -> first text event after it (onsets after >= 1 s gap)
  final  - utterance end -> the first final segment that covers it
  tail   - utterance end -> first text event after it (any kind)
Diarization: DER with pyannote.metrics (collar 0.25 s, overlap scored) and
speaker-count error.
"""

import argparse
import json
import re
import statistics
from pathlib import Path

import jiwer
import opencc
from num2words import num2words

T2S = opencc.OpenCC("t2s")
DIG = "零一二三四五六七八九"
FILLERS_ZH = set("嗯呃额唔")
FILLERS_EN = {"um", "uh", "hmm", "mm", "mmm", "mm-hmm", "uh-huh", "hm", "er", "erm", "ah"}


def zh_int(n: int) -> str:
    if n == 0:
        return "零"
    if n >= 10**8:
        return "".join(DIG[int(c)] for c in str(n))
    units = [(10**4, "万"), (1000, "千"), (100, "百"), (10, "十")]
    out, zero = "", False
    for value, name in units:
        q, n = divmod(n, value)
        if q:
            if zero:
                out += "零"
            out += (zh_int(q) if value == 10**4 else DIG[q]) + name
            zero = False
        elif out:
            zero = True
    if n:
        out += ("零" if zero else "") + DIG[n]
    return out[1:] if out.startswith("一十") else out


def zh_number(m):
    s = m.group(0)
    pct = s.endswith("%")
    s = s.rstrip("%")
    if "." in s:
        a, b = s.split(".", 1)
        r = zh_int(int(a or 0)) + "点" + "".join(DIG[int(c)] for c in b)
    elif len(s) > 1 and s.startswith("0"):
        r = "".join(DIG[int(c)] for c in s)
    else:
        r = zh_int(int(s))
    return ("百分之" + r) if pct else r


def tokens(text: str, lang: str):
    t = T2S.convert(text or "").lower()
    t = t.replace("两", "二")
    if lang == "zh":
        t = re.sub(r"\d+(\.\d+)?%?", zh_number, t)
    else:
        t = re.sub(r"(\d+(\.\d+)?)%", r"\1 percent", t)
        t = re.sub(r"\d+(\.\d+)?", lambda m: " " + num2words(float(m.group(0)) if "." in m.group(0) else int(m.group(0))) + " ", t)
    t = re.sub(r"[-_/]", " ", t)
    t = re.sub(r"[^\w\s'一-鿿]", " ", t)
    toks = re.findall(r"[一-鿿]|[a-z0-9']+", t)
    toks = [x.strip("'") for x in toks if x.strip("'")]
    return [x for x in toks if x not in FILLERS_ZH and x not in FILLERS_EN]


def error_rate(ref, hyp, lang):
    r, h = tokens(ref, lang), tokens(hyp, lang)
    if not r:
        return {"ref_tokens": 0, "hyp_tokens": len(h)}
    o = jiwer.process_words(" ".join(r), " ".join(h) if h else "")
    return {
        "er": round(100 * (o.substitutions + o.deletions + o.insertions) / len(r), 2),
        "sub": o.substitutions, "del": o.deletions, "ins": o.insertions,
        "ref_tokens": len(r), "hyp_tokens": len(h),
    }


def events(path):
    out = []
    if not path.exists():
        return out
    for line in path.read_text(errors="replace").splitlines():
        try:
            e = json.loads(line)
            if isinstance(e, dict):
                out.append(e)
        except ValueError:
            pass
    return out


def latency(ev, ref):
    done = next((e for e in ev if e.get("type") == "bench" and e.get("phase") == "done"), {})
    base = done.get("feedStartedAt")  # Apple: "at" is Unix ms
    texts = []
    for e in ev:
        if e.get("type") != "segment" or not e.get("text"):
            continue
        at = e["at"] - base if base else e["at"]
        texts.append((at, e.get("final", False), e.get("t1")))
    finals = [(at, t1) for at, f, t1 in texts if f and t1 is not None]
    segs = ref["segments"]
    first, final, tail = [], [], []
    ends = sorted(s["t1"] for s in segs)
    for i, s in enumerate(sorted(segs, key=lambda s: s["t0"])):
        t0, t1 = s["t0"] * 1000, s["t1"] * 1000
        prev_end = max([x["t1"] for x in segs if x["t1"] <= s["t0"]], default=-10) * 1000
        if t0 - prev_end >= 1000:
            a = next((at for at, _, _ in texts if at >= t0), None)
            if a is not None:
                first.append(a - t0)
        # Only utterances that end before the next one starts (no overlap).
        nxt = min([x["t0"] for x in segs if x["t0"] > s["t0"]], default=1e9) * 1000
        if nxt - t1 < 300:
            continue
        a = next((at for at, f, _ in texts if at >= t1), None)
        if a is not None:
            tail.append(a - t1)
        a = next((at for at, et1 in finals if et1 >= t1 - 300), None)
        if a is not None:
            final.append(a - t1)

    def stat(v):
        if not v:
            return None
        v = sorted(v)
        return {"median": round(statistics.median(v)), "p90": round(v[int(0.9 * (len(v) - 1))]), "n": len(v)}

    return {"first": stat(first), "final": stat(final), "tail": stat(tail)}


def der(ref_rttm, hyp_rttm):
    from pyannote.core import Annotation, Segment
    from pyannote.metrics.diarization import DiarizationErrorRate

    def load(p):
        a = Annotation()
        for line in Path(p).read_text().splitlines():
            f = line.split()
            if len(f) >= 8 and f[0] == "SPEAKER" and float(f[4]) > 0:
                a[Segment(float(f[3]), float(f[3]) + float(f[4]))] = f[7]
        return a

    r, h = load(ref_rttm), load(hyp_rttm)
    m = DiarizationErrorRate(collar=0.25, skip_overlap=False)
    d = m(r, h, detailed=True)
    tot = d["total"] or 1
    return {
        "der": round(100 * d["diarization error rate"], 2),
        "miss": round(100 * d["missed detection"] / tot, 2),
        "fa": round(100 * d["false alarm"] / tot, 2),
        "conf": round(100 * d["confusion"] / tot, 2),
        "ref_spk": len(r.labels()),
        "hyp_spk": len(h.labels()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True)
    a = ap.parse_args()
    res = a.root / "results"
    audio = a.root / "audio"
    scores = []
    for mode_dir in sorted(p for p in res.iterdir() if p.is_dir()):
        for eng_dir in sorted(p for p in mode_dir.iterdir() if p.is_dir()):
            for run in sorted(eng_dir.glob("*.json")):
                if run.name.count(".") > 1:
                    continue
                clip = run.stem
                ref_p = audio / f"{clip}.ref.json"
                if not ref_p.exists():
                    continue
                ref = json.loads(ref_p.read_text())
                m = json.loads(run.read_text())
                row = {"mode": mode_dir.name, "engine": eng_dir.name, "clip": clip, "lang": ref["lang"], "measure": m}
                ev = events(Path(str(run) + ".stdout"))
                ready = next((e for e in ev if e.get("type") == "bench" and e.get("phase") == "ready"), None)
                done = next((e for e in ev if e.get("type") == "bench" and e.get("phase") == "done"), None)
                if ready:
                    row["prepare_ms"] = round(ready["prepareMs"])
                if done:
                    row["proc_ms"] = round(done["wallMs"])
                    if done.get("decodeMs") is not None:
                        row["decode_ms"] = round(done["decodeMs"])
                wk = next((eng_dir / f"{clip}.wk").glob("*.json"), None) if (eng_dir / f"{clip}.wk").is_dir() else None
                if wk:
                    t = json.loads(wk.read_text()).get("timings", {})
                    done = {"wallMs": t.get("fullPipeline", 0) * 1000}
                    row["proc_ms"] = round(done["wallMs"])
                    row["prepare_ms"] = round(t.get("modelLoading", 0) * 1000)
                row["rtf"] = round((done["wallMs"] / 1000 if done else m["wall_s"]) / ref["duration"], 4)
                row["rtf_process"] = round(m["wall_s"] / ref["duration"], 4)
                hyp = eng_dir / f"{clip}.hyp.txt"
                if hyp.exists() and mode_dir.name != "diar":
                    h = hyp.read_text()
                    row["acc"] = error_rate(ref["text"], h, ref["lang"])
                    if not ref["segments"]:
                        row["hallucination"] = h.strip()[:200]
                if mode_dir.name == "realtime":
                    row["latency"] = latency(ev, ref)
                hr = eng_dir / f"{clip}.hyp.rttm"
                if mode_dir.name == "diar" and hr.exists() and (audio / f"{clip}.rttm").exists():
                    row["diar"] = der(audio / f"{clip}.rttm", hr)
                scores.append(row)
    (res / "scores.json").write_text(json.dumps(scores, ensure_ascii=False, indent=1))
    for r in scores:
        bits = [r["mode"], r["engine"], r["clip"]]
        if "acc" in r and "er" in r["acc"]:
            bits.append(f"ER {r['acc']['er']}")
        if "hallucination" in r:
            bits.append(f"halluc {r['acc']['hyp_tokens']} tok")
        bits.append(f"RTF {r['rtf']}")
        if r.get("latency"):
            bits.append(json.dumps(r["latency"]))
        if r.get("diar"):
            bits.append(json.dumps(r["diar"]))
        print(" | ".join(bits))


if __name__ == "__main__":
    main()
