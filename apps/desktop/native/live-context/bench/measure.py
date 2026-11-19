"""Runs one engine command and measures it.

  python -I measure.py --out run.json [--iorep <path>] [--baseline 5] -- <cmd...>

Writes the command's stdout to <out>.stdout and a JSON summary to <out>:
wall time, CPU time and % (avg / peak over 0.5 s samples) of the process
tree, peak RSS of the tree, CPU time and RSS growth of *other* processes
(system daemons such as the one that runs SpeechAnalyzer), and per-component
energy from IOReport (CPU/GPU/ANE/DRAM, idle baseline subtracted).
"""

import argparse
import json
import subprocess
import sys
import threading
import time

import psutil


def snapshot():
    out = {}
    for p in psutil.process_iter(["pid", "name"]):
        try:
            t = p.cpu_times()
            out[p.pid] = (p.info["name"], t.user + t.system, p.memory_info().rss)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return out


class Energy:
    def __init__(self, path):
        self.samples, self.proc = [], None
        if path:
            self.proc = subprocess.Popen([path, "1000"], stdout=subprocess.PIPE, text=True)
            threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            try:
                self.samples.append(json.loads(line))
            except ValueError:
                pass

    def window(self, t0, t1):
        rows = [s for s in self.samples if t0 < s["t"] <= t1 + 0.5]
        secs = max(1e-9, len(rows) * 1.0)
        return {k: sum(r[k] for r in rows) / 1000 for k in ("cpu_mj", "gpu_mj", "ane_mj", "dram_mj")}, secs

    def stop(self):
        if self.proc:
            self.proc.terminate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--iorep")
    ap.add_argument("--baseline", type=float, default=5.0)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd

    energy = Energy(a.iorep)
    b0 = time.time()
    if a.iorep:
        time.sleep(a.baseline + 1.2)
    b1 = time.time()

    before = snapshot()
    t0 = time.time()
    stdout = open(a.out + ".stdout", "w")
    proc = subprocess.Popen(cmd, stdout=stdout, stderr=open(a.out + ".stderr", "w"))
    root = psutil.Process(proc.pid)
    cpu_samples, rss_peak, last = [], 0, None
    while proc.poll() is None:
        try:
            tree = [root] + root.children(recursive=True)
            cpu = sum(p.cpu_times().user + p.cpu_times().system for p in tree)
            rss = sum(p.memory_info().rss for p in tree)
        except psutil.Error:
            break
        now = time.time()
        if last:
            cpu_samples.append((cpu - last[1]) / (now - last[0]) * 100)
        last = (now, cpu)
        rss_peak = max(rss_peak, rss)
        time.sleep(0.5)
    proc.wait()
    t1 = time.time()
    after = snapshot()
    ru = __import__("resource").getrusage(__import__("resource").RUSAGE_CHILDREN)
    tree_cpu = ru.ru_utime + ru.ru_stime
    # macOS reports ru_maxrss in bytes.
    rss_peak = max(rss_peak, ru.ru_maxrss)

    others = []
    for pid, (name, cpu, rss) in after.items():
        if pid == proc.pid:
            continue
        b = before.get(pid)
        d_cpu = cpu - (b[1] if b else 0.0)
        if d_cpu > 0.3:
            others.append({"name": name, "pid": pid, "cpu_s": round(d_cpu, 2), "rss_mb": round(rss / 2**20, 1), "new": b is None})
    others.sort(key=lambda x: -x["cpu_s"])

    summary = {
        "cmd": cmd,
        "exit": proc.returncode,
        "wall_s": round(t1 - t0, 3),
        "tree_cpu_s": round(tree_cpu, 2),
        "tree_cpu_avg_pct": round(tree_cpu / (t1 - t0) * 100, 1),
        "tree_cpu_peak_pct": round(max(cpu_samples, default=0), 1),
        "tree_rss_peak_mb": round(rss_peak / 2**20, 1),
        "other_procs": others[:8],
    }
    if a.iorep:
        time.sleep(1.5)
        (base, bsecs) = energy.window(b0 + 1.0, b1)
        (run, rsecs) = energy.window(t0, t1)
        summary["energy_j"] = {
            k.replace("_mj", ""): round(run[k] - base[k] / bsecs * rsecs, 2) for k in run
        }
        summary["energy_baseline_w"] = {k.replace("_mj", ""): round(base[k] / bsecs, 3) for k in base}
    energy.stop()
    json.dump(summary, open(a.out, "w"), indent=1)
    print(json.dumps(summary), file=sys.stderr)


if __name__ == "__main__":
    main()
