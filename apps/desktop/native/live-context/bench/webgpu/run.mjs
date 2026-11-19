// Renderer side of the WebGPU harness (see main.cjs). Plain browser code: no
// Node, no remote fetches; models come from pinebench://m/<repo>/.
import {
  AutoModel,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  env,
  pipeline,
} from "pinebench://n/@huggingface/transformers/dist/transformers.web.js";

const q = new URLSearchParams(location.search);
const emit = (ev) => console.log("BENCH " + JSON.stringify(ev));
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "pinebench://m/";
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = "pinebench://n/onnxruntime-web/dist/";

async function readWav(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const view = new DataView(buf);
  let off = 12;
  while (off < view.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buf, off, 4));
    const size = view.getUint32(off + 4, true);
    if (id === "data") {
      const n = size / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++)
        out[i] = view.getInt16(off + 8 + 2 * i, true) / 32768;
      return out;
    }
    off += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}

async function readSegments(url) {
  const text = await (await fetch(url)).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "segment" && e.final);
}

async function gpuInfo() {
  if (!navigator.gpu) return { webgpu: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { webgpu: false, reason: "no adapter" };
  return {
    webgpu: true,
    vendor: adapter.info?.vendor,
    architecture: adapter.info?.architecture,
    f16: adapter.features.has("shader-f16"),
  };
}

async function asr(audio) {
  const dtype = q.get("dtype") ? JSON.parse(q.get("dtype")) : undefined;
  const loadStart = performance.now();
  const transcriber = await pipeline(
    "automatic-speech-recognition",
    q.get("model"),
    {
      device: q.get("device"),
      dtype,
    },
  );
  const loadMs = performance.now() - loadStart;
  const lang = q.get("lang");
  const opts = q.get("model").includes("whisper")
    ? { language: lang, task: "transcribe" }
    : {};
  // First call compiles the WebGPU pipelines (shaders); time it on 1 s of silence.
  const warm = performance.now();
  await transcriber(new Float32Array(16000), opts);
  emit({
    type: "bench",
    phase: "ready",
    prepareMs: now(),
    loadMs,
    warmupMs: performance.now() - warm,
  });

  // Whisper sees at most 30 s; split the rare longer VAD segment (babble).
  const segments = [];
  for (const s of await readSegments(q.get("segments"))) {
    const parts = Math.ceil((s.t1 - s.t0) / 25000);
    const step = (s.t1 - s.t0) / parts;
    for (let k = 0; k < parts; k++)
      segments.push({
        t0: Math.round(s.t0 + k * step),
        t1: Math.round(s.t0 + (k + 1) * step),
      });
  }
  const start = performance.now();
  let decodeMs = 0;
  let i = 0;
  for (const s of segments) {
    const a = audio.subarray(
      Math.max(0, s.t0 * 16),
      Math.min(audio.length, s.t1 * 16),
    );
    if (a.length < 1600) continue;
    const d = performance.now();
    const out = await transcriber(a, opts);
    decodeMs += performance.now() - d;
    emit({
      type: "segment",
      id: `file-${i++}`,
      t0: s.t0,
      t1: s.t1,
      text: out.text,
      final: true,
      at: now(),
    });
  }
  emit({
    type: "bench",
    phase: "done",
    audioSeconds: audio.length / 16000,
    wallMs: performance.now() - start,
    decodeMs,
    segments: i,
  });
}

// pyannote segmentation (10 s windows) + WeSpeaker embeddings + online
// centroid clustering, the same scheme as sherpa_run.py --diar online.
async function diar(audio) {
  const device = q.get("device");
  const loadStart = performance.now();
  const segProc = await AutoProcessor.from_pretrained(
    "onnx-community/pyannote-segmentation-3.0",
  );
  const segModel = await AutoModelForAudioFrameClassification.from_pretrained(
    "onnx-community/pyannote-segmentation-3.0",
    { device, dtype: "fp32" },
  );
  const embProc = await AutoProcessor.from_pretrained(
    "onnx-community/wespeaker-voxceleb-resnet34-LM",
  );
  const embModel = await AutoModel.from_pretrained(
    "onnx-community/wespeaker-voxceleb-resnet34-LM",
    {
      device,
      dtype: "fp32",
    },
  );
  emit({
    type: "bench",
    phase: "ready",
    prepareMs: now(),
    loadMs: performance.now() - loadStart,
  });

  const start = performance.now();
  const win = 160000;
  const centroids = [];
  const threshold = 0.5;
  for (let w = 0; w < audio.length; w += win) {
    const chunk = audio.subarray(w, Math.min(audio.length, w + win));
    if (chunk.length < 8000) break;
    const inputs = await segProc(chunk);
    const { logits } = await segModel(inputs);
    const [found] = segProc.post_process_speaker_diarization(
      logits,
      chunk.length,
    );
    const bySpeaker = new Map();
    for (const s of found) {
      if (s.id === 0) continue; // class 0 is "no speech" in the powerset output
      if (!bySpeaker.has(s.id)) bySpeaker.set(s.id, []);
      bySpeaker.get(s.id).push(s);
    }
    for (const [, segs] of bySpeaker) {
      const parts = segs.map((s) =>
        chunk.subarray(Math.round(s.start * 16000), Math.round(s.end * 16000)),
      );
      const total = parts.reduce((n, p) => n + p.length, 0);
      let label = null;
      if (total >= 8000) {
        const joined = new Float32Array(total);
        let o = 0;
        for (const p of parts) {
          joined.set(p, o);
          o += p.length;
        }
        const out = await embModel(await embProc(joined));
        const e = Float32Array.from(
          (out.embeddings ?? Object.values(out)[0]).data,
        );
        const norm = Math.hypot(...e) || 1;
        for (let k = 0; k < e.length; k++) e[k] /= norm;
        let best = -1;
        let bestSim = -1;
        centroids.forEach((c, k) => {
          let dot = 0;
          let cn = 0;
          for (let j = 0; j < e.length; j++) {
            dot += c[j] * e[j];
            cn += c[j] * c[j];
          }
          const sim = dot / (Math.sqrt(cn) || 1);
          if (sim > bestSim) {
            bestSim = sim;
            best = k;
          }
        });
        if (best >= 0 && bestSim >= threshold) {
          for (let j = 0; j < e.length; j++) centroids[best][j] += e[j];
          label = best;
        } else {
          centroids.push(e);
          label = centroids.length - 1;
        }
      }
      if (label === null) continue;
      for (const s of segs) {
        emit({
          type: "speaker",
          t0: Math.round((w / 16000 + s.start) * 1000),
          t1: Math.round((w / 16000 + s.end) * 1000),
          spk: `S${label}`,
        });
      }
    }
  }
  emit({
    type: "bench",
    phase: "done",
    audioSeconds: audio.length / 16000,
    wallMs: performance.now() - start,
  });
}

try {
  emit({ type: "bench", phase: "gpu", ...(await gpuInfo()) });
  const audio = await readWav(`pinebench://a/${q.get("clip")}.wav`);
  await (q.get("task") === "diar" ? diar(audio) : asr(audio));
  emit({ type: "bench", phase: "exit", code: 0 });
} catch (error) {
  emit({
    type: "bench",
    phase: "error",
    message: String(error?.stack ?? error),
  });
  emit({ type: "bench", phase: "exit", code: 1 });
}
