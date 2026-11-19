// Runs FluidAudio's CoreML SenseVoice or Paraformer on fixed speech segments
// (the VAD segments of a sherpa_run.py output), so every batch engine sees the
// same chunks. Emits the helper's JSONL "segment" events plus "bench" events.
//
//   fluid-bench <sensevoice|sensevoice-int8|paraformer> <wav> <segments.jsonl>
//   fluid-bench nemotron <wav> <zh-CN|en-US> [--realtime]
//     Streaming Nemotron multilingual (2240 ms chunks), fed 100 ms at a time;
//     emits a volatile segment whenever the partial transcript grows.
import FluidAudio
import Foundation

func emit(_ event: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: event, options: [.withoutEscapingSlashes])
  FileHandle.standardOutput.write(data + Data([0x0A]))
}

let args = CommandLine.arguments
let engine = args[1]
let processStart = Date()
let samples = try AudioConverter(sampleRate: 16000).resampleAudioFile(URL(fileURLWithPath: args[2]))
if engine == "nemotron" {
  let language = args[3]
  let realtime = args.contains("--realtime")
  let dir = try await StreamingNemotronMultilingualAsrManager.downloadVariant(
    languageCode: language, chunkMs: 2240)
  let m = StreamingNemotronMultilingualAsrManager()
  try await m.loadModels(from: dir)
  await m.setLanguage(language)
  emit(["type": "bench", "phase": "ready", "prepareMs": Date().timeIntervalSince(processStart) * 1000])
  let start = Date()
  var last = "", fed = 0
  let chunk = 1600
  while fed < samples.count {
    let end = min(samples.count, fed + chunk)
    _ = try await m.process(samples: Array(samples[fed..<end]))
    // process() returns only what one call decoded; the running partial is here.
    let partial = await m.getPartialTranscript()
    fed = end
    let at = Int(Date().timeIntervalSince(start) * 1000)
    if partial.count > last.count || (partial != last && !partial.isEmpty) {
      last = partial
      emit(["type": "segment", "id": "file-0", "t1": fed / 16, "text": partial, "final": false, "at": at])
    }
    if realtime {
      let ahead = Double(fed) / 16000 - Date().timeIntervalSince(start)
      if ahead > 0 { try? await Task.sleep(for: .milliseconds(Int(ahead * 1000))) }
    }
  }
  let text = try await m.finish()
  emit([
    "type": "segment", "id": "file-0", "t0": 0, "t1": samples.count / 16, "text": text, "final": true,
    "at": Int(Date().timeIntervalSince(start) * 1000),
  ])
  emit([
    "type": "bench", "phase": "done", "audioSeconds": Double(samples.count) / 16000,
    "wallMs": Date().timeIntervalSince(start) * 1000, "language": await m.detectedLanguage() ?? "",
  ])
  exit(0)
}

var spans: [(Int, Int)] = []
for line in try String(contentsOfFile: args[3], encoding: .utf8).split(separator: "\n") {
  guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
    obj["type"] as? String == "segment", obj["final"] as? Bool == true,
    let t0 = obj["t0"] as? Int, let t1 = obj["t1"] as? Int
  else { continue }
  // SenseVoice's largest bucket is 30 s: split the rare longer VAD segment.
  let parts = Int(ceil(Double(t1 - t0) / 25000))
  let step = Double(t1 - t0) / Double(max(1, parts))
  for k in 0..<max(1, parts) {
    spans.append((t0 + Int(Double(k) * step), t0 + Int(Double(k + 1) * step)))
  }
}

var transcribe: ([Float]) async throws -> String
switch engine {
case "sensevoice", "sensevoice-int8":
  let m = try await SenseVoiceManager.load(precision: engine == "sensevoice" ? .fp16 : .int8)
  transcribe = { try await m.transcribe(audio: $0) }
case "paraformer":
  let m = try await ParaformerManager.load(precision: .fp16)
  transcribe = { try await m.transcribe(audio: $0) }
default:
  fatalError("unknown engine \(engine)")
}
emit(["type": "bench", "phase": "ready", "prepareMs": Date().timeIntervalSince(processStart) * 1000])

let start = Date()
var decodeMs: [Double] = []
var emptyRetries = 0
// FluidAudio 0.18.3's SenseVoice returns "" for some inputs (content
// dependent, also through its own CLI); retry such a span as two halves.
func run(_ audio: ArraySlice<Float>, depth: Int = 0) async throws -> String {
  let text = try await transcribe(Array(audio))
  guard text.isEmpty, depth < 2, audio.count >= 32000, engine != "paraformer" else { return text }
  emptyRetries += 1
  let mid = audio.startIndex + audio.count / 2
  let a = try await run(audio[audio.startIndex..<mid], depth: depth + 1)
  let b = try await run(audio[mid..<audio.endIndex], depth: depth + 1)
  return a + b
}
for (i, (t0, t1)) in spans.enumerated() {
  // 30 s is SenseVoice's largest bucket; VAD caps segments at 20 s.
  let a = max(0, t0 * 16), b = min(samples.count, t1 * 16)
  guard b > a + 1600 else { continue }
  let d0 = Date()
  let text = try await run(samples[a..<b])
  decodeMs.append(Date().timeIntervalSince(d0) * 1000)
  emit([
    "type": "segment", "id": "file-\(i)", "t0": t0, "t1": t1, "text": text, "final": true,
    "decodeMs": decodeMs.last!,
  ])
}
emit([
  "type": "bench", "phase": "done", "audioSeconds": Double(samples.count) / 16000,
  "wallMs": Date().timeIntervalSince(start) * 1000, "decodeMs": decodeMs.reduce(0, +),
  "segments": decodeMs.count, "emptyRetries": emptyRetries,
])
