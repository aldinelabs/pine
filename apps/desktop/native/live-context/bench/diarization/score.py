"""Scores replay.ts output against the clips' RTTM references.

  python -I score.py --clips <clips> --runs <dir with <clip>.replay.json> [--json out.json]

Per clip:
  DER        timeline DER after the final pass (pyannote.metrics, ±0.25 s collar,
             overlap scored), on the helper's voiced frames.
  DER live   the same timeline just before the final pass.
  spk        speakers found after the final pass / live (reference count in brackets).
  word err   share of transcript word time labeled with the wrong speaker as the
             user first saw it ("first"), at the end of the capture ("live") and
             after the final pass ("final"); unlabeled words count as wrong.
             Words where the reference has nobody or several people are skipped.
  splits/10m label changes between consecutive words of one reference speaker
             (the transcript cutting one person's speech into two names), first view.
  flips      share of word time whose settled (not provisional) speaker changed after
             it was first shown, after Pine's own merges (which the transcript applies
             without rewriting anything).
  unlabeled  share of final segments with no label when they became final
             (the transcript shows the source name, "Me", until labels arrive).
"""

import argparse
import json
from pathlib import Path

from pyannote.core import Annotation, Segment
from pyannote.metrics.diarization import DiarizationErrorRate


def read_rttm(path):
    turns = []
    for line in Path(path).read_text().splitlines():
        parts = line.split()
        if len(parts) >= 8 and parts[0] == "SPEAKER":
            t0, d = float(parts[3]), float(parts[4])
            turns.append((t0, t0 + d, parts[7]))
    return turns


def annotation(turns):
    a = Annotation()
    for i, (t0, t1, spk) in enumerate(turns):
        if t1 > t0:
            a[Segment(t0, t1), i] = spk
    return a


def der(ref, hyp):
    metric = DiarizationErrorRate(collar=0.5, skip_overlap=False)
    value = metric(annotation(ref), annotation(hyp), detailed=True)
    total = value["total"] or 1
    return {
        "der": value["diarization error rate"],
        "miss": value["missed detection"] / total,
        "fa": value["false alarm"] / total,
        "conf": value["confusion"] / total,
    }


def resolver(aliases):
    table = dict(aliases)

    def resolve(key):
        seen = set()
        while key in table and key not in seen:
            seen.add(key)
            key = table[key]
        return key

    return resolve


def word_speakers(segment, key, settled=False):
    """(start, end, speaker or None) per word for one snapshot of labels;
    `settled` leaves out provisional labels (None)."""
    turns = segment.get(key) or []
    turns = sorted(turns, key=lambda t: t["offset"])
    out = []
    for offset, start, end in segment["words"]:
        speaker = None
        if turns:
            current = turns[0]
            for turn in turns:
                if turn["offset"] <= offset:
                    current = turn
            speaker = current.get("speaker")
            if settled and current.get("provisional"):
                speaker = None
        out.append((start, end, speaker))
    return out


def ref_at(ref, t):
    who = {spk for t0, t1, spk in ref if t0 <= t < t1}
    return next(iter(who)) if len(who) == 1 else (None if not who else "*")


def best_mapping(pairs):
    """Greedy one-to-one hyp -> ref mapping by shared time."""
    totals = {}
    for (h, r), w in pairs.items():
        totals[(h, r)] = totals.get((h, r), 0) + w
    mapping, used = {}, set()
    for (h, r), _ in sorted(totals.items(), key=lambda x: -x[1]):
        if h in mapping or r in used:
            continue
        mapping[h] = r
        used.add(r)
    return mapping


def word_metrics(ref, segments, key):
    words = []
    for segment in segments:
        for start, end, speaker in word_speakers(segment, key):
            r = ref_at(ref, (start + end) / 2)
            if r is None or r == "*":
                continue
            words.append((start, max(0.05, end - start), speaker, r))
    words.sort()
    pairs = {}
    for _, d, h, r in words:
        if h is not None:
            pairs[(h, r)] = pairs.get((h, r), 0) + d
    mapping = best_mapping(pairs)
    total = sum(d for _, d, _, _ in words) or 1
    wrong = sum(d for _, d, h, r in words if h is None or mapping.get(h) != r)
    splits = sum(
        1
        for a, b in zip(words, words[1:])
        if a[3] == b[3] and a[2] != b[2] and a[2] is not None and b[2] is not None
    )
    return wrong / total, splits, len({h for _, _, h, _ in words if h is not None})


def score_clip(clips, runs, name):
    ref = read_rttm(clips / f"{name}.rttm")
    run = json.loads((runs / f"{name}.replay.json").read_text())
    duration = json.loads((clips / f"{name}.json").read_text())["duration"]
    final = der(ref, run["timeline"])
    live = der(ref, run["timelineLive"])
    segments = run["segments"]
    resolve = resolver(run.get("aliases", []))
    # A flip: words whose settled (not provisional) speaker changed later,
    # after Pine's own merges.
    flipped = total_words = 0.0
    for s in segments:
        first = word_speakers(s, "first", settled=True)
        last = word_speakers(s, "live")
        for (a0, a1, f), (_, _, l) in zip(first, last):
            d = max(0.05, a1 - a0)
            total_words += d
            if f is not None and l is not None and resolve(f) != resolve(l):
                flipped += d
    result = {
        "clip": name,
        "refSpeakers": len({t[2] for t in ref}),
        "speakers": len({t[2] for t in run["timeline"]}),
        "speakersLive": len({t[2] for t in run["timelineLive"]}),
        "der": final,
        "derLive": live,
        "segments": len(segments),
        "flips": flipped / max(1e-9, total_words),
        "unlabeled": sum(1 for s in segments if not s["first"]) / max(1, len(segments)),
        "busyMs": run.get("busyMs"),
        "finishMs": run.get("finishMs"),
    }
    for key in ("first", "live", "final"):
        err, splits, shown = word_metrics(ref, segments, key)
        result[f"word_{key}"] = err
        result[f"splits_{key}"] = splits * 600 / duration
        result[f"shown_{key}"] = shown
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", type=Path, required=True)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--only", default="")
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    names = sorted(p.name[: -len(".replay.json")] for p in args.runs.glob("*.replay.json"))
    if args.only:
        names = [n for n in names if n in args.only.split(",")]
    rows = [score_clip(args.clips, args.runs, n) for n in names]
    pct = lambda x: f"{100 * x:.1f}"
    print(
        "| clip | DER | conf | DER live | spk (ref) | spk live | word err first/live/final | splits/10m | flips | unlabeled |"
    )
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in rows:
        print(
            f"| {r['clip']} | {pct(r['der']['der'])} | {pct(r['der']['conf'])} | {pct(r['derLive']['der'])} "
            f"| {r['speakers']} ({r['refSpeakers']}) | {r['speakersLive']} "
            f"| {pct(r['word_first'])} / {pct(r['word_live'])} / {pct(r['word_final'])} "
            f"| {r['splits_first']:.1f} | {pct(r['flips'])} | {pct(r['unlabeled'])} |"
        )
    meetings = [r for r in rows if r["refSpeakers"] > 1]
    single = [r for r in rows if r["refSpeakers"] == 1]
    if meetings and single:
        mean = lambda xs: sum(xs) / len(xs)
        print(
            f"\nmeetings: DER {pct(mean([r['der']['der'] for r in meetings]))}, conf {pct(mean([r['der']['conf'] for r in meetings]))}, "
            f"|count err| {sum(abs(r['speakers'] - r['refSpeakers']) for r in meetings)} final / {sum(abs(r['speakersLive'] - r['refSpeakers']) for r in meetings)} live, "
            f"word err live {pct(mean([r['word_live'] for r in meetings]))}; "
            f"monologues: extra speakers {sum(r['speakers'] - 1 for r in single)} final / {sum(r['speakersLive'] - 1 for r in single)} live, "
            f"splits/10m {mean([r['splits_first'] for r in single]):.1f}, word err first {pct(mean([r['word_first'] for r in single]))}; "
            f"flips {pct(mean([r['flips'] for r in rows]))}"
        )
    if args.json:
        args.json.write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
