# Live Context ASR benchmark harness

Reproduces `docs/live-context-asr-benchmark.md`. Nothing here is part of the
app: `scripts/build-native.mjs` only compiles `../Sources` (the helper's
SwiftPM target path), and `forge.config.ts` only packages the built
`build/pine-live-context` binary. All data, models and builds live in a
scratch directory outside the repo (`$S` below).

| File               | What it does                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `prep.py`          | Builds 16 kHz test clips + references (text, segments, RTTM) from the public datasets and `say(1)`.       |
| `apple/main.swift` | File-input runner around the helper's own `SourcePipeline` (`Sources/Transcription.swift`).               |
| `build-apple.sh`   | Compiles it together with `../Sources/Transcription.swift` and `Output.swift`.                            |
| `sherpa_run.py`    | sherpa-onnx: silero VAD → SenseVoice, optional streaming Paraformer partials, online/offline diarization. |
| `fluid/`           | Swift package around FluidAudio (CoreML): SenseVoice / Paraformer on the sherpa VAD segments; Nemotron.   |
| `energy/iorep.c`   | CPU/GPU/ANE/DRAM energy from IOReport, no sudo (measurement only, private API).                           |
| `measure.py`       | Runs one command: wall time, CPU of the process tree and of system daemons, peak RSS, energy.             |
| `run_matrix.py`    | Runs every engine × clip (`--mode fast / realtime / diar`).                                               |
| `score.py`         | CER / MER / WER, latency, DER, hallucination; writes `results/scores.json`.                               |
| `tables.py`        | Prints the report's Markdown tables from `results/scores.json`.                                           |
| `wk_stream.py`     | Times `whisperkit-cli --stream-simulated` (step wall times, confirmation lag).                            |
| `webgpu/`          | Electron harness: transformers.js / ONNX Runtime Web in a hidden, sandboxed, Node-free `BrowserWindow`.   |

## Reproduce

```sh
S=/path/to/scratch            # anything outside the repo
B=apps/desktop/native/live-context/bench
uv venv -p 3.11 $S/venv/py
uv pip install --python $S/venv/py sherpa-onnx==2.0.1 onnxruntime numpy soundfile jiwer \
  pyannote.metrics pandas pyarrow psutil opencc num2words

# Data (see the report for URLs, licenses and SHA-256): FLEURS cmn_hans_cn test,
# ASCEND test parquet, AMI ES2004a (Mix-Headset, Array1-01, manual annotations 1.6.2),
# AliMeeting Eval_Ali.tar.gz -> $S/dl/...
$S/venv/py/bin/python -I $B/prep.py --dl $S/dl --out $S/audio

# Engines
$B/build-apple.sh $S/bin
# If the Command Line Tools SDK fails to link (seen with SDK 27), pass the Xcode SDK:
# -isysroot /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk
xcrun clang -isysroot "$(xcrun --sdk macosx --show-sdk-path)" -O2 -o $S/bin/iorep \
  $B/energy/iorep.c -framework CoreFoundation -lIOReport
git clone -b v1.1.1 https://github.com/argmaxinc/WhisperKit $S/src/WhisperKit
git clone -b v0.18.3 https://github.com/FluidInference/FluidAudio $S/src/FluidAudio
(cd $S/src/WhisperKit && swift build -c release --product whisperkit-cli)
(cd $S/src/FluidAudio && swift build -c release)
(cd $B/fluid && FLUIDAUDIO_PATH=$S/src/FluidAudio swift build -c release --scratch-path $S/build/fluid-bench)
# sherpa-onnx models -> $S/models/sherpa (SenseVoice int8 2024-07-17 -- the
# 2025-09-09 release is a Cantonese fine-tune --, silero_vad.onnx,
# streaming-paraformer-bilingual-zh-en, pyannote-segmentation-3-0, CAM++ zh_en advanced).
# WhisperKit models download on first run via --download-model-path $S/models/whisperkit.
# FluidAudio always downloads to ~/Library/Application Support/FluidAudio; the
# benchmark pointed that path at $S/models/fluidaudio with a temporary symlink.

# WebGPU: transformers.js in $S/webgpu (bun add --exact @huggingface/transformers@4.3.2),
# onnx-community models -> $S/models/hf/onnx-community/<repo>/ (files listed in the report).
# Runs with the repo's own Electron (node_modules/electron); Chromium caches go to
# --user-data (default $S/webgpu/userdata), not to the shared Electron profile.

$S/venv/py/bin/python -I $B/run_matrix.py --root $S --mode fast
$S/venv/py/bin/python -I $B/run_matrix.py --root $S --mode realtime
$S/venv/py/bin/python -I $B/run_matrix.py --root $S --mode diar
$S/venv/py/bin/python -I $B/score.py --root $S
$S/venv/py/bin/python -I $B/tables.py --root $S
```

Note: `build-native.mjs` decides whether to rebuild the helper from the newest
mtime under `native/live-context/` (it skips only `build`/`.build`), so editing
files here triggers a no-op helper rebuild on the next `dev`/`build`; nothing
from `bench/` is compiled or packaged.

Run on an otherwise idle Mac: energy and CPU are system-wide counters with an
idle baseline subtracted, so other apps add noise.
