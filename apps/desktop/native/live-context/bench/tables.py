"""Markdown tables for the report from results/scores.json.

  python -I tables.py --root <scratch>
"""

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

ASR = ["zh_read", "zh_noisy", "zh_meeting", "zh_meeting_near", "cs_conv", "cs_tech", "en_meeting", "en_meeting_far"]
DIAR = ["diar_synth", "zh_meeting", "zh_meeting_near", "cs_conv", "en_meeting", "en_meeting_far"]


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True)
    a = ap.parse_args()
    scores = json.loads((a.root / "results/scores.json").read_text())
    by = defaultdict(dict)
    for r in scores:
        by[(r["mode"], r["engine"])][r["clip"]] = r

    # Accuracy
    rows = []
    for (mode, eng), clips in sorted(by.items()):
        if mode != "fast":
            continue
        row = [eng]
        for c in ASR:
            acc = clips.get(c, {}).get("acc", {})
            row.append(acc.get("er", "—"))
        for c in ("silence", "music"):
            acc = clips.get(c, {}).get("acc")
            row.append(acc["hyp_tokens"] if acc else "—")
        rows.append(row)
    print("### Accuracy (CER/MER/WER %, lower is better; silence/music = hallucinated tokens)\n")
    print(table(["engine"] + ASR + ["silence", "music"], rows))

    # Performance, aggregated over the speech clips of the fast run
    rows = []
    for (mode, eng), clips in sorted(by.items()):
        if mode != "fast":
            continue
        runs = [clips[c] for c in ASR if c in clips]
        if not runs:
            continue
        audio_min = sum(json.loads((a.root / "audio" / f"{r['clip']}.ref.json").read_text())["duration"] for r in runs) / 60
        rtf = statistics.median(r["rtf"] for r in runs)
        wall = sum(r["measure"]["wall_s"] for r in runs)
        tree = sum(r["measure"]["tree_cpu_s"] for r in runs)
        daemon = sum(
            o["cpu_s"] for r in runs for o in r["measure"]["other_procs"]
            if o["name"] in ("localspeechrecognition", "speechanalysisd", "ANECompilerService", "aned")
        )
        rss = max(r["measure"]["tree_rss_peak_mb"] for r in runs)
        e = defaultdict(float)
        for r in runs:
            for k, v in r["measure"].get("energy_j", {}).items():
                e[k] += v
        total = sum(max(0, v) for v in e.values())
        prep = [r.get("prepare_ms") for r in runs if r.get("prepare_ms")]
        rows.append([
            eng, f"{rtf:.3f}", f"{tree / wall * 100:.0f}", f"{daemon / audio_min:.1f}", f"{tree / audio_min:.1f}", f"{rss:.0f}",
            f"{total / audio_min:.1f}", f"{e['cpu'] / audio_min:.1f}", f"{e['gpu'] / audio_min:.1f}", f"{e['ane'] / audio_min:.1f}",
            f"{statistics.median(prep) / 1000:.1f}" if prep else "—",
        ])
    print("\n### Performance (fast mode, speech clips)\n")
    print(table(["engine", "RTF median", "CPU % (tree, while running)", "daemon CPU s / audio min", "tree CPU s / audio min",
                 "peak RSS MB", "J / audio min", "CPU J", "GPU J", "ANE J", "warm load s"], rows))

    # Realtime
    rows = []
    for (mode, eng), clips in sorted(by.items()):
        if mode != "realtime":
            continue
        for c, r in sorted(clips.items()):
            lat = r.get("latency") or {}
            f = lambda k: f"{lat[k]['median']} / {lat[k]['p90']}" if lat.get(k) else "—"
            m = r["measure"]
            daemon = sum(o["cpu_s"] for o in m["other_procs"] if o["name"] == "localspeechrecognition")
            e = m.get("energy_j", {})
            rows.append([eng, c, f("first"), f("final"), f("tail"), f"{(m['tree_cpu_s'] + daemon) / m['wall_s'] * 100:.0f}",
                         f"{m['tree_cpu_peak_pct']:.0f}", f"{m['tree_rss_peak_mb']:.0f}",
                         f"{sum(max(0, v) for v in e.values()) / m['wall_s']:.2f}" if e else "—",
                         r.get("acc", {}).get("er", "—")])
    print("\n### Realtime (1x feed): latency ms median / p90\n")
    print(table(["engine", "clip", "first", "final", "tail", "CPU % avg (incl. daemon)", "CPU % peak (tree)", "RSS MB", "W above idle", "ER %"], rows))

    # Diarization
    rows = []
    for (mode, eng), clips in sorted(by.items()):
        if mode != "diar":
            continue
        row = [eng]
        ders = []
        for c in DIAR:
            d = clips.get(c, {}).get("diar")
            if d:
                ders.append(d["der"])
                row.append(f"{d['der']} ({d['hyp_spk']}/{d['ref_spk']})")
            else:
                row.append("—")
        row.append(f"{statistics.mean(ders):.1f}" if ders else "—")
        rtf = [clips[c]["rtf_process"] for c in DIAR if c in clips]
        row.append(f"{statistics.median(rtf):.3f}" if rtf else "—")
        rows.append(row)
    print("\n### Diarization: DER % (hyp speakers / ref speakers)\n")
    print(table(["engine"] + DIAR + ["mean DER", "RTF (process)"], rows))


if __name__ == "__main__":
    main()
