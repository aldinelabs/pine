"""Runs every engine x clip under measure.py and normalizes the outputs.

  python -I run_matrix.py --root <scratch> [--only engine,...] [--clips a,b]
      [--mode fast|realtime|diar] [--force]

<scratch> layout (see bench/README.md): audio/ (prep.py output), bin/
(apple-file-bench, iorep), models/, src/ (WhisperKit, FluidAudio builds),
build/fluid-bench, venv/py. Results go to <scratch>/results/<mode>/<engine>/<clip>.*:
  .json (measure.py summary), .stdout, .stderr, .hyp.txt, .hyp.rttm, .events.jsonl
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

ASR_CLIPS = ["zh_read", "zh_noisy", "zh_meeting", "zh_meeting_near", "cs_conv", "cs_tech", "en_meeting", "en_meeting_far", "silence", "music"]
DIAR_CLIPS = ["diar_synth", "zh_meeting", "zh_meeting_near", "cs_conv", "en_meeting", "en_meeting_far"]
RT_CLIPS = ["cs_tech", "zh_meeting_near", "en_meeting"]


def lang(root, clip):
    return json.loads((root / "audio" / f"{clip}.ref.json").read_text())["lang"]


def engines(root):
    py = str(root / "venv/py/bin/python")
    sherpa = [py, "-I", str(HERE / "sherpa_run.py")]
    models = str(root / "models/sherpa")
    wk = str(root / "src/WhisperKit/.build/release/whisperkit-cli")
    fa = str(root / "src/FluidAudio/.build/release/fluidaudiocli")
    fb = str(root / "build/fluid-bench/release/fluid-bench")
    wkm = root / "models/whisperkit/models/argmaxinc/whisperkit-coreml"
    tok = str(root / "models/whisperkit/tok")

    def segs(clip):  # the sherpa VAD segments every batch engine reuses
        return str(root / "results/fast/sherpa-sv-cpu" / f"{clip}.json.stdout")

    def whisper(model):
        def build(w, c, o):
            (o.parent / f"{c}.wk").mkdir(parents=True, exist_ok=True)
            return cmd(w, c, o)

        cmd = lambda w, c, o: [
            wk, "transcribe", "--model-path", str(wkm / model), "--download-tokenizer-path", tok,
            "--audio-path", w, "--language", lang(root, c)[:2], "--report", "--report-path", str(o.parent / f"{c}.wk"),
        ]
        return build

    electron = str(HERE.parents[4] / "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")

    def web(model, device="webgpu", dtype='{"encoder_model":"fp16","decoder_model_merged":"q4"}', task="asr"):
        return lambda w, c, o: [
            electron, str(HERE / "webgpu/main.cjs"), "--root", str(root), "--clip", c, "--model", model,
            "--device", device, "--dtype", dtype, "--lang", lang(root, c)[:2], "--task", task,
            "--segments", segs(c),
        ]

    loc = lambda c: "zh-CN" if lang(root, c) == "zh" else "en-US"
    return {
        "fast": {
            "apple": (lambda w, c, o: [str(root / "bin/apple-file-bench"), w, "--locale", loc(c)], None),
            "sherpa-sv-cpu": (lambda w, c, o: sherpa + [w, "--models", models, "--threads", "2"], None),
            "sherpa-sv-coreml": (lambda w, c, o: sherpa + [w, "--models", models, "--provider", "coreml"], ["cs_tech", "zh_meeting"]),
            "fluid-sv-fp16": (lambda w, c, o: [fb, "sensevoice", w, segs(c)], None),
            "fluid-sv-int8": (lambda w, c, o: [fb, "sensevoice-int8", w, segs(c)], None),
            "fluid-paraformer": (lambda w, c, o: [fb, "paraformer", w, segs(c)], [x for x in ASR_CLIPS if not x.startswith("en")]),
            "fluid-nemotron": (lambda w, c, o: [fb, "nemotron", w, loc(c)], None),
            "wk-turbo": (whisper("openai_whisper-large-v3-v20240930_turbo_632MB"), None),
            "wk-small": (whisper("openai_whisper-small_216MB"), None),
            "webgpu-whisper-turbo": (web("onnx-community/whisper-large-v3-turbo"), None),
            "webgpu-whisper-small": (web("onnx-community/whisper-small"), None),
            "webgpu-moonshine": (web("onnx-community/moonshine-base-ONNX"), ["en_meeting", "en_meeting_far", "silence", "music"]),
            "wasm-whisper-small": (web("onnx-community/whisper-small", device="wasm"), ["cs_tech"]),
            "wasm-moonshine": (web("onnx-community/moonshine-base-ONNX", device="wasm"), ["en_meeting"]),
            "fluid-parakeet-v3": (
                lambda w, c, o: [fa, "transcribe", w, "--output-json", str(o.parent / f"{c}.pk.json")],
                ["en_meeting", "en_meeting_far", "silence", "music"],
            ),
        },
        "realtime": {
            "apple": (lambda w, c, o: [str(root / "bin/apple-file-bench"), w, "--locale", loc(c), "--realtime"], None),
            "sherpa-sv-cpu": (lambda w, c, o: sherpa + [w, "--models", models, "--threads", "2", "--realtime"], None),
            "sherpa-sv-partials": (lambda w, c, o: sherpa + [w, "--models", models, "--threads", "2", "--realtime", "--partials"], None),
            "fluid-nemotron": (lambda w, c, o: [fb, "nemotron", w, loc(c), "--realtime"], None),
        },
        "diar": {
            "sherpa-online": (lambda w, c, o: sherpa + [w, "--models", models, "--diar", "online"], None),
            "sherpa-offline": (lambda w, c, o: sherpa + [w, "--models", models, "--diar", "offline"], None),
            **{
                f"sherpa-{kind}@{t}": (
                    (lambda kind, t: lambda w, c, o: sherpa + [w, "--models", models, "--diar", kind, "--diar-threshold", t])(kind, t),
                    None,
                )
                for kind, ts in (("online", ("0.6", "0.7")), ("offline", ("0.7", "0.9", "1.1")))
                for t in ts
            },
            "fluid-streaming": (lambda w, c, o: [fa, "process", w, "--mode", "streaming", "--output", str(o.parent / f"{c}.fa.json")], None),
            "fluid-offline": (lambda w, c, o: [fa, "process", w, "--mode", "offline", "--output", str(o.parent / f"{c}.fa.json")], None),
            "fluid-sortformer": (lambda w, c, o: [fa, "sortformer", w, "--output", str(o.parent / f"{c}.fa.json")], None),
            "webgpu-diar": (web("", task="diar"), None),
            "wk-speakerkit": (
                lambda w, c, o: [wk, "diarize", "--audio-path", w, "--rttm-path", str(o.parent / f"{c}.hyp.rttm"),
                                 "--download-model-path", str(root / "models/speakerkit")],
                None,
            ),
        },
    }


def events(path):
    out = []
    for line in Path(path).read_text(errors="replace").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            out.append(e)
    return out


def rttm_line(clip, t0, t1, spk):
    return f"SPEAKER {clip} 1 {t0:.3f} {max(0.0, t1 - t0):.3f} <NA> <NA> {spk} <NA> <NA>\n"


def normalize(engine, clip, o):
    """Writes <clip>.hyp.txt (final text) and, for diarization, <clip>.hyp.rttm."""
    base = o.parent / clip
    ev = events(str(o) + ".stdout")
    text, rttm = None, None
    if engine.startswith("wk-") and engine != "wk-speakerkit":
        rep = next((o.parent / f"{clip}.wk").glob("*.json"), None)
        if rep:
            d = json.loads(rep.read_text())
            text = d.get("text") or " ".join(s["text"] for s in d.get("segments", []))
            import re

            text = re.sub(r"<\|[^|]*\|>", "", text)
        else:  # no report: the CLI prints the transcript on stdout
            text = Path(str(o) + ".stdout").read_text(errors="replace")
    elif engine == "fluid-parakeet-v3":
        p = o.parent / f"{clip}.pk.json"
        if p.exists():
            d = json.loads(p.read_text())
            text = d.get("text") or d.get("transcription") or ""
    elif engine.startswith("fluid-") and o.parent.parent.name == "diar":
        p = o.parent / f"{clip}.fa.json"
        if p.exists():
            d = json.loads(p.read_text())
            rttm = [
                rttm_line(clip, s["startTimeSeconds"], s["endTimeSeconds"], str(s.get("speakerId", s.get("speakerIndex", s.get("speaker")))))
                for s in d.get("segments", [])
            ]
    elif engine.startswith("sherpa-offline") or engine == "webgpu-diar":
        rttm = [rttm_line(clip, e["t0"] / 1000, e["t1"] / 1000, e["spk"]) for e in ev if e.get("type") == "speaker"]
    elif engine.startswith("sherpa-online"):
        rttm = [rttm_line(clip, e["t0"] / 1000, e["t1"] / 1000, e["spk"]) for e in ev if e.get("type") == "segment" and e.get("spk")]
    if text is None and engine != "wk-speakerkit":
        text = " ".join(e.get("text", "") for e in ev if e.get("type") == "segment" and e.get("final"))
    if text is not None:
        Path(f"{base}.hyp.txt").write_text(text.strip() + "\n")
    if rttm is not None:
        Path(f"{base}.hyp.rttm").write_text("".join(rttm))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True)
    ap.add_argument("--mode", default="fast", choices=["fast", "realtime", "diar"])
    ap.add_argument("--only", default="")
    ap.add_argument("--clips", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-energy", action="store_true")
    a = ap.parse_args()
    root = a.root.resolve()
    table = engines(root)[a.mode]
    default_clips = {"fast": ASR_CLIPS, "realtime": RT_CLIPS, "diar": DIAR_CLIPS}[a.mode]
    clips = a.clips.split(",") if a.clips else default_clips
    for engine, (build, allowed) in table.items():
        if a.only and engine not in a.only.split(","):
            continue
        for clip in clips:
            if allowed and clip not in allowed:
                continue
            out = root / "results" / a.mode / engine / f"{clip}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            if out.exists() and not a.force:
                normalize(engine, clip, out)
                continue
            wav = str(root / "audio" / f"{clip}.wav")
            cmd = build(wav, clip, out)
            measure = [str(root / "venv/py/bin/python"), "-I", str(HERE / "measure.py"), "--out", str(out)]
            if not a.no_energy:
                measure += ["--iorep", str(root / "bin/iorep"), "--baseline", "4"]
            print(f"[{a.mode}] {engine} {clip}", flush=True)
            subprocess.run(measure + ["--"] + cmd, stderr=subprocess.DEVNULL)
            normalize(engine, clip, out)


if __name__ == "__main__":
    sys.exit(main())
