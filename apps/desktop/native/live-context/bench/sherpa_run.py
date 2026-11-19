"""sherpa-onnx engine runner: silero VAD -> SenseVoice (offline, per segment),
optional streaming Paraformer for partials, optional speaker labels.

  python -I sherpa_run.py <wav> --models <dir> [--provider cpu|coreml]
      [--threads 2] [--realtime] [--partials] [--diar online|offline]

Emits the same JSONL as the Swift helper ("segment" events with t0/t1 in ms
of audio time, "final", "at" = ms since feeding started) plus "bench" events.
--diar online labels each VAD segment by nearest speaker centroid as it is
finalized (what a live helper can do); --diar offline runs sherpa-onnx's
pyannote + clustering pipeline over the whole file after the fact.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf

T0 = time.time()


def emit(**event):
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--models", type=Path, required=True)
    ap.add_argument("--provider", default="cpu")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--realtime", action="store_true")
    ap.add_argument("--partials", action="store_true")
    ap.add_argument("--diar", choices=["online", "offline"])
    ap.add_argument("--diar-threshold", type=float, default=0.5)
    ap.add_argument("--min-silence", type=float, default=0.5)
    ap.add_argument("--sensevoice", default="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17")
    a = ap.parse_args()
    m = a.models

    sv = m / a.sensevoice
    asr = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(sv / "model.int8.onnx"),
        tokens=str(sv / "tokens.txt"),
        num_threads=a.threads,
        provider=a.provider,
        language="auto",
        use_itn=True,
    )
    vcfg = sherpa_onnx.VadModelConfig()
    vcfg.silero_vad.model = str(m / "silero_vad.onnx")
    vcfg.silero_vad.min_silence_duration = a.min_silence
    vcfg.silero_vad.min_speech_duration = 0.25
    vcfg.silero_vad.max_speech_duration = 20
    vcfg.silero_vad.threshold = 0.5
    vcfg.sample_rate = 16000
    vcfg.num_threads = 1
    vcfg.provider = "cpu"
    vad = sherpa_onnx.VoiceActivityDetector(vcfg, buffer_size_in_seconds=60)

    stream_asr = None
    if a.partials:
        pf = m / "sherpa-onnx-streaming-paraformer-bilingual-zh-en"
        stream_asr = sherpa_onnx.OnlineRecognizer.from_paraformer(
            tokens=str(pf / "tokens.txt"),
            encoder=str(pf / "encoder.int8.onnx"),
            decoder=str(pf / "decoder.int8.onnx"),
            num_threads=a.threads,
            provider=a.provider,
        )
    embedder = None
    if a.diar == "online":
        ecfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(m / "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"),
            num_threads=a.threads,
            provider=a.provider,
        )
        embedder = sherpa_onnx.SpeakerEmbeddingExtractor(ecfg)
    centroids, counts = [], []

    audio, sr = sf.read(a.wav, dtype="float32")
    assert sr == 16000
    emit(type="bench", phase="ready", prepareMs=(time.time() - T0) * 1000)

    start = time.time()
    window = 512  # silero frame
    chunk = 1600  # 100 ms feed, like the helper's capture buffers
    pstream, ptext, pid = None, "", 0
    decode_ms, n_seg = 0.0, 0

    def at():
        return round((time.time() - start) * 1000)

    def finalize_segments():
        nonlocal decode_ms, n_seg, pstream, ptext, pid
        while not vad.empty():
            seg = vad.front
            samples = np.asarray(seg.samples, dtype=np.float32)
            t0 = seg.start / 16000
            t1 = t0 + len(samples) / 16000
            d0 = time.time()
            s = asr.create_stream()
            s.accept_waveform(16000, samples)
            asr.decode_stream(s)
            text = s.result.text.strip()
            spk = None
            if embedder is not None and len(samples) > 8000:
                es = embedder.create_stream()
                es.accept_waveform(16000, samples)
                es.input_finished()
                e = np.array(embedder.compute(es))
                e /= np.linalg.norm(e) + 1e-9
                sims = [float(c @ e / (np.linalg.norm(c) + 1e-9)) for c in centroids]
                k = int(np.argmax(sims)) if sims else -1
                if k >= 0 and sims[k] >= a.diar_threshold:
                    centroids[k] = centroids[k] + e
                    counts[k] += 1
                else:
                    centroids.append(e.copy())
                    counts.append(1)
                    k = len(centroids) - 1
                spk = f"S{k}"
            decode_ms += (time.time() - d0) * 1000
            n_seg += 1
            ev = dict(type="segment", id=f"file-{n_seg}", t0=round(t0 * 1000), t1=round(t1 * 1000), text=text, final=True, at=at())
            if spk:
                ev["spk"] = spk
            emit(**ev)
            vad.pop()
            if stream_asr is not None:
                pstream, ptext = None, ""
                pid += 1

    fed = 0
    pending = np.zeros(0, np.float32)
    while fed < len(audio):
        piece = audio[fed : fed + chunk]
        fed += len(piece)
        pending = np.concatenate([pending, piece])
        while len(pending) >= window:
            vad.accept_waveform(pending[:window])
            pending = pending[window:]
        if stream_asr is not None:
            if vad.is_speech_detected():
                if pstream is None:
                    pstream = stream_asr.create_stream()
                pstream.accept_waveform(16000, piece)
                while stream_asr.is_ready(pstream):
                    stream_asr.decode_stream(pstream)
                txt = stream_asr.get_result(pstream).strip()
                if txt and txt != ptext:
                    ptext = txt
                    emit(type="segment", id=f"file-{n_seg + 1}", t0=None, t1=round(fed / 16), text=txt, final=False, at=at())
        finalize_segments()
        if a.realtime:
            ahead = fed / 16000 - (time.time() - start)
            if ahead > 0:
                time.sleep(ahead)
    vad.flush()
    finalize_segments()
    wall = time.time() - start
    emit(type="bench", phase="done", audioSeconds=len(audio) / 16000, wallMs=wall * 1000, decodeMs=decode_ms, segments=n_seg)

    if a.diar == "offline":
        cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                    model=str(m / "sherpa-onnx-pyannote-segmentation-3-0/model.onnx")
                ),
                num_threads=a.threads,
                provider=a.provider,
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(m / "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"),
                num_threads=a.threads,
                provider=a.provider,
            ),
            clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=a.diar_threshold),
            min_duration_on=0.3,
            min_duration_off=0.5,
        )
        sd = sherpa_onnx.OfflineSpeakerDiarization(cfg)
        d0 = time.time()
        res = sd.process(audio).sort_by_start_time()
        for r in res:
            emit(type="speaker", t0=round(r.start * 1000), t1=round(r.end * 1000), spk=f"S{r.speaker}")
        emit(type="bench", phase="diar", wallMs=(time.time() - d0) * 1000)


if __name__ == "__main__":
    main()
