"""Builds the benchmark clips (16 kHz mono WAV) plus references.

Each clip gets <name>.wav, <name>.ref.json ({"lang", "text", "segments":
[{"spk", "t0", "t1", "text"}]}) and, when speakers are known, <name>.rttm.

Usage (run with `python -I`; no data is read from the working directory):
  python -I prep.py --dl <downloads dir> --out <clips dir> [--only name,...]

Downloads expected under --dl (see bench/README.md for URLs and SHA-256):
  fleurs/x/test/*.wav + fleurs/test.tsv      FLEURS cmn_hans_cn test (CC BY 4.0)
  ascend/test-00000-of-00001.parquet         ASCEND test (CC BY-SA 4.0)
  ami/ES2004a.{Mix-Headset,Array1-01}.wav    AMI (CC BY 4.0)
  ami/ann/{words,segments}/ES2004a.*         AMI manual annotations 1.6.2
  alimeeting/Eval_Ali/Eval_Ali_far/...       AliMeeting Eval (CC BY-SA 4.0)
"""

import argparse
import csv
import io
import json
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 16000
rng = np.random.default_rng(7)


def load(path, sr=SR, channel=None):
    """Any audio file -> float32 mono at `sr` (ffmpeg does the resampling)."""
    args = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path)]
    if channel is not None:
        args += ["-af", f"pan=mono|c0=c{channel}"]
    args += ["-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(args, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def write(out, name, audio, lang, segments, rttm=True):
    audio = np.clip(audio, -1, 1).astype(np.float32)
    sf.write(out / f"{name}.wav", audio, SR, subtype="PCM_16")
    segments = sorted(segments, key=lambda s: s["t0"])
    text = " ".join(s["text"] for s in segments if s["text"])
    ref = {"lang": lang, "duration": len(audio) / SR, "text": text, "segments": segments}
    (out / f"{name}.ref.json").write_text(json.dumps(ref, ensure_ascii=False, indent=1))
    if rttm:
        with open(out / f"{name}.rttm", "w") as f:
            for s in segments:
                if s["t1"] > s["t0"]:
                    f.write(
                        f"SPEAKER {name} 1 {s['t0']:.3f} {s['t1'] - s['t0']:.3f} <NA> <NA> {s['spk']} <NA> <NA>\n"
                    )
    print(f"{name}: {len(audio) / SR:.1f}s, {len(segments)} segments")


def trim(audio, thresh=0.005):
    idx = np.nonzero(np.abs(audio) > thresh)[0]
    return audio[idx[0] : idx[-1] + 1] if len(idx) else audio


def cut_window(audio, segs, t_from, t_to):
    """Keeps segments fully inside [t_from, t_to); mutes the part of any
    segment that crosses a boundary so the reference matches the audio."""
    keep = []
    for s in segs:
        if s["t0"] >= t_from and s["t1"] <= t_to:
            keep.append({**s, "t0": s["t0"] - t_from, "t1": s["t1"] - t_from})
        else:
            a, b = max(s["t0"], t_from) - t_from, min(s["t1"], t_to) - t_from
            audio[int(a * SR) : int(b * SR)] = 0
    return audio, keep


# ---------------------------------------------------------------- FLEURS


def fleurs_rows(dl):
    rows = []
    with open(dl / "fleurs/test.tsv", newline="") as f:
        for r in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            rows.append({"file": r[1], "text": r[2], "gender": r[6] if len(r) > 6 else ""})
    return rows


def zh_read(dl, out, seconds=180):
    """Formal read Mandarin (FLEURS), one sentence each, as a lecture proxy."""
    audio, segs, seen, t = [], [], set(), 0.0
    for r in fleurs_rows(dl):
        if r["text"] in seen:
            continue
        seen.add(r["text"])
        a = trim(load(dl / "fleurs/x/test" / r["file"]))
        audio += [a, np.zeros(int(0.7 * SR), np.float32)]
        segs.append({"spk": "S", "t0": t, "t1": t + len(a) / SR, "text": r["text"]})
        t += len(a) / SR + 0.7
        if t > seconds:
            break
    a = np.concatenate(audio)
    write(out, "zh_read", a, "zh", segs, rttm=False)
    return a, segs


def zh_noisy(dl, out, snr_db=10.0):
    """zh_read + dense babble (~8 other FLEURS talkers at once) + pink noise
    at `snr_db`, a noisy-classroom proxy."""
    clean, segs = zh_read(dl, out)
    used = {s["text"] for s in segs}
    babble = np.zeros_like(clean)
    for k, r in enumerate(x for x in fleurs_rows(dl)[::-1] if x["text"] not in used):
        if k >= 150:
            break
        a = load(dl / "fleurs/x/test" / r["file"])
        off = rng.integers(0, max(1, len(clean) - len(a)))
        babble[off : off + len(a)] += a[: len(babble) - off]
    white = rng.standard_normal(len(clean)).astype(np.float32)
    pink = np.fft.irfft(np.fft.rfft(white) / np.sqrt(np.arange(1, len(white) // 2 + 2)), len(white))
    noise = babble / (np.std(babble) + 1e-9) + 0.5 * pink / (np.std(pink) + 1e-9)
    p_s = np.mean(clean[np.abs(clean) > 0.01] ** 2)
    noise *= np.sqrt(p_s / (10 ** (snr_db / 10)) / np.mean(noise**2))
    write(out, "zh_noisy", clean + noise.astype(np.float32), "zh", segs, rttm=False)


# ---------------------------------------------------------------- ASCEND


def cs_conv(dl, out, session=None, seconds=240):
    """ASCEND code-switching conversation: both speakers mixed onto one timeline."""
    import pyarrow.parquet as pq

    t = pq.read_table(dl / "ascend/test-00000-of-00001.parquet").to_pylist()
    pat = re.compile(r"ses(\d+)_spk(\d+)_L\d+_([\d.]+)_([\d.]+)\.wav$")
    by_ses = {}
    for r in t:
        m = pat.search(r["path"])
        if not m:
            continue
        by_ses.setdefault(int(m.group(1)), []).append((float(m.group(3)), float(m.group(4)), m.group(2), r))
    # The session with the most mixed-language utterances in its first `seconds`.
    def score(items):
        return sum(1 for s, _, _, r in items if s < seconds and r["language"] == "mixed")

    session = session or max(by_ses, key=lambda k: (len({x[2] for x in by_ses[k]}) >= 2, score(by_ses[k])))
    items = sorted(x for x in by_ses[session] if x[0] + x[1] <= seconds)
    audio = np.zeros(int(seconds * SR) + SR, np.float32)
    segs = []
    for start, dur, spk, r in items:
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            f.write(r["audio"]["bytes"])
            f.flush()
            a = load(f.name)
        i = int(start * SR)
        audio[i : i + len(a)] += a[: len(audio) - i]
        segs.append({"spk": f"spk{spk}", "t0": start, "t1": start + len(a) / SR, "text": r["transcription"], "lang": r["language"]})
    end = int((max(s["t1"] for s in segs) + 1) * SR)
    write(out, "cs_conv", audio[:end], "zh", segs)
    print(f"  ASCEND session {session}, speakers {sorted({s['spk'] for s in segs})}")


# ---------------------------------------------------------------- say(1)


def say(text, voice, rate=None):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "s.aiff"
        args = ["say", "-v", voice, "-o", str(p)] + (["-r", str(rate)] if rate else []) + [text]
        subprocess.run(args, check=True)
        return trim(load(p))


TECH = [
    ("Tingting", "今天我们讲傅里叶变换，它把一个信号从时域变换到频域。"),
    ("Tingting", "大家提交作业的时候，请在 GitHub 上开一个 pull request，我会在周五之前 review。"),
    ("Samantha", "Make sure the Kubernetes cluster has enough GPU nodes before you deploy."),
    ("Tingting", "我们用 Docker 把模型服务打包，然后部署到 Kubernetes 上，用 Helm 管理配置。"),
    ("Tingting", "Transformer 的核心是自注意力机制，复杂度是序列长度的平方。"),
    ("Tingting", "如果梯度下降不收敛，可以先把学习率调小到零点零零一，再看 loss 曲线。"),
    ("Samantha", "The API returns a JSON payload, and the latency is about two hundred milliseconds."),
    ("Tingting", "期末考试范围是第三章到第七章，拉普拉斯变换和卷积定理是重点。"),
    ("Tingting", "下周三下午两点在 Zoom 上开会，记得先看一下 PR 的 diff。"),
]


def cs_tech(dl, out):
    audio, segs, t = [], [], 0.0
    for voice, text in TECH:
        a = say(text, voice)
        audio += [a, np.zeros(int(0.8 * SR), np.float32)]
        segs.append({"spk": voice, "t0": t, "t1": t + len(a) / SR, "text": text})
        t += len(a) / SR + 0.8
    write(out, "cs_tech", np.concatenate(audio), "zh", segs)


# Diarization stress: four voices (two similar male voices), overlaps, and
# one-word backchannels inside other people's turns.
DIAR = [
    ("Tingting", "好，我们开始今天的周会，先看一下上周的进度。", 0.4),
    ("Eddy (Chinese (China mainland))", "后端接口已经写完了，测试覆盖率大概百分之八十。", 0.3),
    ("Reed (Chinese (China mainland))", "前端这边还差两个页面，登录和设置。", -0.8),
    ("Tingting", "嗯。", "bc"),
    ("Eddy (Chinese (China mainland))", "设置页面需要的接口我今天下午可以补上。", 0.2),
    ("Flo (Chinese (China mainland))", "对。", "bc"),
    ("Flo (Chinese (China mainland))", "我补充一下，设计稿昨天更新过，大家以最新版为准。", 0.5),
    ("Reed (Chinese (China mainland))", "好的，那我按最新的设计稿改。", -0.6),
    ("Eddy (Chinese (China mainland))", "我也看一下。", -0.5),
    ("Tingting", "那发布时间定在下周四，有没有问题？", 0.6),
    ("Reed (Chinese (China mainland))", "没问题。", 0.2),
    ("Eddy (Chinese (China mainland))", "没问题，不过数据库迁移要提前一天做。", -0.4),
    ("Flo (Chinese (China mainland))", "嗯。", "bc"),
    ("Tingting", "好，那就这样，散会。", 0.7),
]


def diar_synth(dl, out):
    clips = [(v, text, gap, say(text, v)) for v, text, gap in DIAR]
    total = sum(len(c[3]) for c in clips) / SR + 15
    audio = np.zeros(int(total * SR), np.float32)
    segs, t, prev = [], 0.5, None
    for voice, text, gap, a in clips:
        spk = voice.split(" ")[0]
        if gap == "bc":  # backchannel in the middle of the previous turn
            t0 = (prev["t0"] + prev["t1"]) / 2
        else:
            t0 = t + gap
        i = int(t0 * SR)
        audio[i : i + len(a)] += 0.8 * a
        seg = {"spk": spk, "t0": t0, "t1": t0 + len(a) / SR, "text": text}
        segs.append(seg)
        if gap != "bc":
            t, prev = seg["t1"], seg
    end = int((max(s["t1"] for s in segs) + 1) * SR)
    write(out, "diar_synth", audio[:end], "zh", segs)


# ---------------------------------------------------------------- AMI


def ami(dl, out, t_from=300.0, t_to=600.0):
    """AMI ES2004a, 5 minutes, headset mix and far-field array mic 1."""
    segs = []
    for spk in "ABCD":
        words = ET.parse(dl / f"ami/ann/words/ES2004a.{spk}.words.xml").getroot()
        ws = [w for w in words if w.tag == "w" and w.get("starttime")]
        sg = ET.parse(dl / f"ami/ann/segments/ES2004a.{spk}.segments.xml").getroot()
        for s in sg:
            t0, t1 = float(s.get("transcriber_start")), float(s.get("transcriber_end"))
            if t1 <= t_from or t0 >= t_to:
                continue
            text = " ".join(
                (w.text or "") for w in ws
                if w.get("punc") != "true" and t0 <= float(w.get("starttime")) < t1
            )
            segs.append({"spk": spk, "t0": t0, "t1": t1, "text": text.strip()})
    for src, name in [("Mix-Headset", "en_meeting"), ("Array1-01", "en_meeting_far")]:
        a = load(dl / f"ami/ES2004a.{src}.wav")[int(t_from * SR) : int(t_to * SR)]
        a, keep = cut_window(a, segs, t_from, t_to)
        if name == "en_meeting_far":
            a *= 0.5 / (np.max(np.abs(a)) + 1e-9)  # array channel is very quiet
        write(out, name, a, "en", keep)


# ---------------------------------------------------------------- AliMeeting


def parse_textgrid(path):
    """Minimal Praat TextGrid reader: [(tier_name, xmin, xmax, text)]."""
    txt = path.read_text(encoding="utf-8", errors="replace")
    out, tier = [], None
    for line in txt.splitlines():
        line = line.strip()
        m = re.match(r'name = "(.*)"', line)
        if m:
            tier = m.group(1)
        m = re.match(r"xmin = ([\d.]+)", line)
        if m:
            xmin = float(m.group(1))
        m = re.match(r"xmax = ([\d.]+)", line)
        if m:
            xmax = float(m.group(1))
        m = re.match(r'text = "(.*)"', line)
        if m and tier is not None:
            out.append((tier, xmin, xmax, m.group(1)))
    return out


def zh_meeting(dl, out, t_from=120.0, t_to=420.0, session=None):
    """AliMeeting Eval far-field (8-mic array, channel 0), 5 minutes."""
    root = dl / "alimeeting/Eval_Ali/Eval_Ali_far"
    wavs = sorted((root / "audio_dir").glob("*.wav"))
    wav = next((w for w in wavs if session and session in w.name), wavs[0])
    sid = "_".join(wav.stem.split("_")[:2])
    tg = next((root / "textgrid_dir").glob(f"{sid}*.TextGrid"))
    segs = []
    for tier, x0, x1, text in parse_textgrid(tg):
        text = text.strip()
        if not text or x1 <= t_from or x0 >= t_to:
            continue
        segs.append({"spk": tier, "t0": x0, "t1": x1, "text": text})
    far = load(wav, channel=0)[int(t_from * SR) : int(t_to * SR)]
    far, keep = cut_window(far, segs, t_from, t_to)
    far *= 0.5 / (np.max(np.abs(far)) + 1e-9)
    write(out, "zh_meeting", far, "zh", keep)
    print(f"  AliMeeting {wav.name}, {len({s['spk'] for s in keep})} speakers")
    # Close-talk version: the speakers' headset channels summed, closer to
    # what a video call delivers through system audio.
    near_dir = dl / "alimeeting/Eval_Ali/Eval_Ali_near/audio_dir"
    heads = sorted(near_dir.glob(f"{sid}_N_*.wav"))
    if heads:
        near = sum(load(h)[int(t_from * SR) : int(t_to * SR)] for h in heads)
        near, _ = cut_window(near, segs, t_from, t_to)
        near *= 0.5 / (np.max(np.abs(near)) + 1e-9)
        write(out, "zh_meeting_near", near, "zh", keep)


# ---------------------------------------------------------------- non-speech


def nonspeech(dl, out):
    n = 60 * SR
    room = (rng.standard_normal(n) * 10 ** (-60 / 20)).astype(np.float32)
    write(out, "silence", room, "zh", [], rttm=False)
    # Synthetic instrumental music: chord pads + bass + noise hi-hats.
    t = np.arange(n) / SR
    chords = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]]
    music = np.zeros(n, np.float32)
    for k in range(0, 60, 2):
        sl = slice(k * SR, (k + 2) * SR)
        env = np.minimum(1, (t[sl] - k) * 8) * np.exp(-(t[sl] - k) * 0.8)
        for f in chords[(k // 2) % 4]:
            for h, g in [(1, 1), (2, 0.4), (3, 0.2)]:
                music[sl] += 0.08 * g * env * np.sin(2 * np.pi * f * h * t[sl])
        music[sl] += 0.15 * env * np.sin(2 * np.pi * chords[(k // 2) % 4][0] / 2 * t[sl])
    for b in np.arange(0, 60, 0.25):
        i = int(b * SR)
        music[i : i + 800] += 0.05 * rng.standard_normal(800) * np.exp(-np.arange(800) / 150)
    write(out, "music", music + room, "zh", [], rttm=False)


BUILDERS = {
    "zh_noisy": zh_noisy,  # also writes zh_read
    "zh_meeting": zh_meeting,
    "en_meeting": ami,  # also writes en_meeting_far
    "cs_conv": cs_conv,
    "cs_tech": cs_tech,
    "diar_synth": diar_synth,
    "nonspeech": nonspeech,  # silence + music
}

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dl", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--only", default="")
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    for name, fn in BUILDERS.items():
        if a.only and name not in a.only.split(","):
            continue
        fn(a.dl, a.out)
