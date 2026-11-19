"""Runs the speaker-label eval end to end: helper -> replay -> score.

  python -I run.py --clips <clips> --out <runs dir> [--only a,b] [--speed 4]
                   [--jobs 3] [--rerun] [--options '{"tauHigh":0.6}'] [--replay-only]

The helper (native/live-context/build/pine-live-context, built by
scripts/build-native.mjs) plays each clip into the mic source with the bundled
speaker models, exactly as Pine starts it; its JSONL is kept in --out and
reused unless --rerun. replay.ts feeds it to Pine's SpeakerSession, score.py
prints the table. Needs bun on PATH and a Python with pyannote.metrics.
"""

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE.parent.parent / "build"


def helper_run(clip, out, speed, extra_env):
    meta = json.loads(clip.with_suffix(".json").read_text())
    jsonl = out / f"{clip.stem}.jsonl"
    models = BUILD / "live-context-models"
    args = [
        str(BUILD / "pine-live-context"),
        "--start",
        "--sources",
        "mic",
        "--locale",
        meta["lang"],
        "--file",
        str(clip),
        "--speed",
        str(speed),
        "--segmentation",
        str(models / "pyannote-segmentation-3.0.int8.onnx"),
        "--embedding",
        str(models / "3dspeaker-campplus-zh-en-16k-advanced.onnx"),
    ]
    with open(jsonl, "w") as stdout, open(out / f"{clip.stem}.err", "w") as stderr:
        subprocess.run(args, stdout=stdout, stderr=stderr, check=True, env=extra_env)
    states = [line for line in jsonl.read_text().splitlines() if '"speakers-state"' in line]
    if states:
        print(f"warning: {clip.stem} degraded during the run: {states}", file=sys.stderr)
    return jsonl


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--only", default="")
    parser.add_argument("--speed", type=float, default=4)
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--rerun", action="store_true")
    parser.add_argument("--replay-only", action="store_true")
    parser.add_argument("--options", default="")
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    clips = [c for c in sorted(args.clips.glob("*.wav")) if not only or c.stem in only]

    import os

    env = {**os.environ}

    def one(clip):
        jsonl = args.out / f"{clip.stem}.jsonl"
        if not args.replay_only and (args.rerun or not jsonl.exists()):
            helper_run(clip, args.out, args.speed, env)
        replay = [
            "bun",
            str(HERE / "replay.ts"),
            str(jsonl),
            str(args.out / f"{clip.stem}.replay.json"),
        ]
        if args.options:
            replay.append(args.options)
        subprocess.run(replay, check=True)

    with ThreadPoolExecutor(args.jobs) as pool:
        list(pool.map(one, clips))
    score = [
        sys.executable,
        "-I",
        str(HERE / "score.py"),
        "--clips",
        str(args.clips),
        "--runs",
        str(args.out),
    ]
    if only:
        score += ["--only", ",".join(sorted(only))]
    if args.json:
        score += ["--json", str(args.json)]
    subprocess.run(score, check=True)


if __name__ == "__main__":
    main()
