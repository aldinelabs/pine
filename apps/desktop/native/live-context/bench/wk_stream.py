"""Times WhisperKit's own streaming loop (`whisperkit-cli transcribe
--stream-simulated --verbose`): every 1 s of new audio it re-decodes from the
last agreed word and confirms words once two hypotheses agree.

  python -I wk_stream.py --out <file.json> -- <whisperkit-cli args...>

Records, per step, the audio end time and the wall time the step took, and
the confirmed-text timeline ("Current: a -> b <words>"). A step slower than
1 s means the loop cannot keep up with live audio.
"""

import argparse
import json
import re
import subprocess
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    t0 = time.time()
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    steps, confirmed, ready = [], [], None
    last = None
    for line in p.stdout:
        now = time.time() - t0
        if line.startswith("Models initialized"):
            ready = now
        m = re.match(r"\[argmax-cli\] ([\d.]+)-([\d.]+) seconds", line)
        if m:
            if last is not None:
                steps[-1]["wall_s"] = round(now - last, 3)
            steps.append({"audio_end": float(m.group(2))})
            last = now
        m = re.match(r"\[argmax-cli\] Current: ([\d.]+) -> ([\d.]+) (.*)", line)
        if m:
            confirmed.append({"agreed": float(m.group(1)), "audio_end": float(m.group(2)), "at": round(now, 3), "text": m.group(3)})
    p.wait()
    walls = [s["wall_s"] for s in steps if "wall_s" in s]
    json.dump(
        {
            "ready_s": ready,
            "total_s": round(time.time() - t0, 2),
            "steps": len(steps),
            "step_wall_median": sorted(walls)[len(walls) // 2] if walls else None,
            "step_wall_p90": sorted(walls)[int(0.9 * (len(walls) - 1))] if walls else None,
            "step_wall_max": max(walls, default=None),
            # Audio still unconfirmed when a step finishes: end - last agreed word.
            "confirm_lag_median": sorted(c["audio_end"] - c["agreed"] for c in confirmed)[len(confirmed) // 2] if confirmed else None,
            "confirmed": confirmed,
        },
        open(a.out, "w"),
        ensure_ascii=False,
        indent=1,
    )


if __name__ == "__main__":
    main()
