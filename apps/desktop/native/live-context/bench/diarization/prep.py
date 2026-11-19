"""Builds the speaker-label eval clips (16 kHz mono WAV) and RTTM references.

Usage (run with `python -I`; nothing is read from the working directory):
  python -I prep.py --dl <downloads> --asr <ASR bench clips> --vad <silero_vad.onnx> --out <clips>

Single-speaker monologues (the over-splitting case), from --dl:
  jfk/jfk.flac        JFK, Rice University address, 1962 (public domain, archive.org
                      item jfks19620912): a lecture hall, applause and laughter.
  libri/holly03.mp3   LibriVox "China and the Chinese" ch. 3, read by Holly (public domain).
  lunyu/lunyu14.mp3   LibriVox 論語 ch. 14 (public domain), Mandarin.
Each is cut to its first 600 s; en_reading_room adds a synthetic room (RT60 0.6 s)
and fan noise at 15 dB SNR to en_reading; en/zh_reading_far a larger room (RT60
0.9 s, weak direct path), 8 dB SNR, a laptop-speaker band and a level that wanders
±6 dB: a talk played or given across a room, heard by a laptop mic. Their
references are silero VAD speech regions, all one speaker: miss and false alarm
there measure VAD disagreement; confusion and the speaker count are what count.
say_en / say_zh are `say(1)` monologues (Samantha / Tingting) with exact timing.

Meetings, copied from the ASR benchmark's clips (bench/prep.py, --asr):
  en_meeting, en_meeting_far (AMI ES2004a headset mix / far field, 300 s),
  zh_meeting, zh_meeting_near (AliMeeting far / near, 300 s), diar_synth.
"""

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 16000
SECONDS = 600
rng = np.random.default_rng(11)


def load(path):
    args = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR)]
    raw = subprocess.run([*args, "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def write(out, name, audio, lang, turns):
    audio = np.clip(audio, -1, 1).astype(np.float32)
    sf.write(out / f"{name}.wav", audio, SR, subtype="PCM_16")
    with open(out / f"{name}.rttm", "w") as f:
        for t0, t1, spk in turns:
            if t1 > t0:
                f.write(f"SPEAKER {name} 1 {t0:.3f} {t1 - t0:.3f} <NA> <NA> {spk} <NA> <NA>\n")
    (out / f"{name}.json").write_text(json.dumps({"lang": lang, "duration": len(audio) / SR}))
    print(f"{name}: {len(audio) / SR:.0f} s, {len(turns)} turns, {len({t[2] for t in turns})} speakers")


def vad_turns(audio, model):
    import sherpa_onnx

    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = model
    config.silero_vad.min_silence_duration = 0.3
    config.silero_vad.min_speech_duration = 0.25
    config.sample_rate = SR
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=SECONDS + 60)
    step = 512
    for i in range(0, len(audio), step):
        vad.accept_waveform(audio[i : i + step])
    vad.flush()
    turns = []
    while not vad.empty():
        seg = vad.front
        turns.append((seg.start / SR, (seg.start + len(seg.samples)) / SR, "A"))
        vad.pop()
    return turns


def room(audio, rt60=0.6, snr=15, direct=4.0, far=False):
    """A synthetic room: exponentially decaying noise as the impulse response
    (direct path first), then low-passed fan noise at `snr` dB. `far` also
    band-limits it like a laptop speaker heard across a room and lets the
    level wander by ±6 dB as the talker turns and walks."""
    if far:
        from numpy.fft import irfft, rfft, rfftfreq

        spectrum = rfft(audio)
        f = rfftfreq(len(audio), 1 / SR)
        spectrum *= (f > 180) / (1 + (f / 5000) ** 4)
        audio = irfft(spectrum, len(audio)).astype(np.float32)
        t = np.arange(len(audio)) / SR
        drift = 6 * np.sin(2 * np.pi * t / 37) * np.sin(2 * np.pi * t / 11.3)
        audio = audio * 10 ** (drift / 20)
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    rir = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    rir[: int(0.01 * SR)] = 0
    rir[0] = direct
    rir /= np.sqrt(np.sum(rir**2))
    wet = np.convolve(audio, rir)[: len(audio)].astype(np.float32)
    noise = np.convolve(rng.standard_normal(len(audio)), np.ones(8) / 8, mode="same")
    speech = wet[np.abs(wet) > 0.01]
    power = np.mean(speech**2) if len(speech) else np.mean(wet**2)
    noise *= np.sqrt(power / 10 ** (snr / 10) / np.mean(noise**2))
    out = wet + noise.astype(np.float32)
    return out / max(1, np.max(np.abs(out)) / 0.9)


EN = [
    "Good morning everyone, and thank you for coming back after the break.",
    "Today I want to talk about how we design systems that people actually trust.",
    "When you build a tool, the first question is not what it can do, but who it is for.",
    "Some of the questions I got last week were about process, so let me start there.",
    "We started with a fixed budget and a very simple allocation, nothing fancy.",
    "Then we added another relationship, and another, until the model was hard to read.",
    "The lesson is that every new rule has a cost that someone else ends up paying.",
    "So I am asking you to think about those consequences at the very beginning.",
    "You will always have a boss, but you can still speak up when something is wrong.",
    "Let me give you an example from a project that went badly, and why it did.",
    "The team was talented, the schedule was reasonable, and the scope looked small.",
    "But nobody wrote down what done meant, so everybody had a different answer.",
    "By the third month we had three versions of the same feature and no users.",
    "What fixed it was not a new tool. It was a one page document and a weekly review.",
    "I know that sounds boring. Good process usually does, and that is the point.",
    "Now, a few of you asked how this applies to research rather than product work.",
]
ZH = [
    "大家好，欢迎回到今天的课程，我们接着上次的内容继续讲。",
    "上节课我们讨论了系统设计的基本原则，今天重点讲如何验证这些原则。",
    "很多同学问，为什么一个看起来很简单的问题，做起来却这么复杂。",
    "原因在于，每增加一个规则，系统里就多了一种需要考虑的情况。",
    "我们先从一个具体的例子开始，这个例子来自去年的一个真实项目。",
    "项目开始的时候，预算是固定的，分配方式也非常直接。",
    "后来需求不断增加，模型越来越复杂，最后几乎没有人能看懂。",
    "所以我希望大家在一开始就想清楚，这个决定会带来什么后果。",
    "你总会有上级，但是当你觉得有问题的时候，你应该说出来。",
    "下面我们看第二个例子，这次是一个研究项目，而不是产品开发。",
    "研究的难点在于，你往往不知道终点在哪里，也不知道需要多长时间。",
    "这时候，每周一次的简短回顾，比任何复杂的工具都更有用。",
]


def say_clip(voice, lines, seconds, rates):
    """Paragraphs of `say` speech with natural pauses; exact turns."""
    audio = [np.zeros(int(0.8 * SR), np.float32)]
    turns = []
    t = 0.8
    i = 0
    with tempfile.TemporaryDirectory() as tmp:
        while t < seconds:
            line = lines[i % len(lines)]
            rate = rates[i % len(rates)]
            path = Path(tmp) / f"{i}.aiff"
            subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(path), line], check=True)
            piece = load(path)
            active = np.nonzero(np.abs(piece) > 0.003)[0]
            if len(active):
                piece = piece[active[0] : active[-1] + 1]
            turns.append((t, t + len(piece) / SR, voice))
            audio.append(piece)
            t += len(piece) / SR
            # Sentence pauses 0.2–0.7 s, paragraph pauses 1.2–2 s.
            gap = rng.uniform(1.2, 2.0) if i % 4 == 3 else rng.uniform(0.2, 0.7)
            audio.append(np.zeros(int(gap * SR), np.float32))
            t += gap
            i += 1
    return np.concatenate(audio), turns


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dl", type=Path, required=True)
    parser.add_argument("--asr", type=Path, required=True)
    parser.add_argument("--vad", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))

    def wanted(name):
        return not only or name in only

    real = [
        ("jfk_lecture", args.dl / "jfk/jfk.flac", "en-US"),
        ("en_reading", args.dl / "libri/holly03.mp3", "en-US"),
        ("zh_reading", args.dl / "lunyu/lunyu14.mp3", "zh-CN"),
    ]
    for name, path, lang in real:
        variants = {f"{name}_room", f"{name}_far"}
        if not (wanted(name) or any(wanted(v) for v in variants)):
            continue
        audio = load(path)[: SECONDS * SR]
        audio = audio / max(1e-6, np.max(np.abs(audio)) / 0.9)
        turns = vad_turns(audio, args.vad)
        if wanted(name):
            write(args.out, name, audio, lang, turns)
        if name == "en_reading" and wanted("en_reading_room"):
            write(args.out, "en_reading_room", room(audio), lang, turns)
        if name != "jfk_lecture" and wanted(f"{name}_far"):
            far = room(audio, rt60=0.9, snr=8, direct=1.5, far=True)
            write(args.out, f"{name}_far", far, lang, turns)

    if wanted("say_en"):
        audio, turns = say_clip("Samantha", EN, 300, [175, 200, 160, 190, 185])
        write(args.out, "say_en", audio, "en-US", turns)
    if wanted("say_zh"):
        audio, turns = say_clip("Tingting", ZH, 300, [190, 210, 175, 200])
        write(args.out, "say_zh", audio, "zh-CN", turns)

    for name, lang in [
        ("en_meeting", "en-US"),
        ("en_meeting_far", "en-US"),
        ("zh_meeting", "zh-CN"),
        ("zh_meeting_near", "zh-CN"),
        ("diar_synth", "en-US"),
    ]:
        if not wanted(name):
            continue
        shutil.copyfile(args.asr / f"{name}.wav", args.out / f"{name}.wav")
        shutil.copyfile(args.asr / f"{name}.rttm", args.out / f"{name}.rttm")
        ref = json.loads((args.asr / f"{name}.ref.json").read_text())
        code = {"en": "en-US", "zh": "zh-CN"}.get(ref.get("lang", ""), lang)
        (args.out / f"{name}.json").write_text(json.dumps({"lang": code, "duration": ref["duration"]}))
        print(f"{name}: copied")


if __name__ == "__main__":
    main()
