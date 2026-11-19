// File-input benchmark for the Live Context helper's SpeechTranscriber path.
// Compiled together with ../../Sources/Transcription.swift and Output.swift
// (see bench/build-apple.sh), so it exercises the helper's own SourcePipeline:
// same transcriber options, same format conversion, same JSONL events.
//
//   apple-file-bench <wav> --locale zh-CN [--realtime] [--chunk-ms 100]
//
// --realtime feeds the file at 1x speed (latency); otherwise as fast as the
// analyzer accepts it (real-time factor). Extra events on stdout:
//   {"type":"bench","phase":"ready","startedAt":…,"prepareMs":…}
//   {"type":"bench","phase":"done","audioSeconds":…,"wallMs":…}
import AVFoundation
import Foundation
import Speech

func benchArgument(_ name: String) -> String? {
  let arguments = CommandLine.arguments
  guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
  return arguments[index + 1]
}

let processStart = Date()
let path = CommandLine.arguments[1]
let realtime = CommandLine.arguments.contains("--realtime")
let chunkMs = Double(benchArgument("--chunk-ms") ?? "100") ?? 100
let localeId = benchArgument("--locale") ?? "zh-CN"

guard
  let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId))
else {
  Output.error("unsupported_locale", localeId)
  exit(1)
}
let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
let format = file.processingFormat
let chunkFrames = AVAudioFrameCount(format.sampleRate * chunkMs / 1000)

let startedAt = Date()
let pipeline = try await SourcePipeline.start(source: "file", locale: locale, startedAt: startedAt)
Output.emit([
  "type": "bench", "phase": "ready", "startedAt": startedAt.timeIntervalSince1970 * 1000,
  "prepareMs": Date().timeIntervalSince(processStart) * 1000,
])

// The pipeline's timeline starts at `startedAt`; feed from now on.
let feedStart = Date()
var fed: Double = 0
while file.framePosition < file.length {
  guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunkFrames) else { break }
  try file.read(into: buffer, frameCount: chunkFrames)
  if buffer.frameLength == 0 { break }
  pipeline.append(buffer)
  fed += Double(buffer.frameLength) / format.sampleRate
  if realtime {
    let ahead = fed - Date().timeIntervalSince(feedStart)
    if ahead > 0 { try? await Task.sleep(for: .milliseconds(Int(ahead * 1000))) }
  }
}
let feedEnd = Date()
await pipeline.finish()
Output.emit([
  "type": "bench", "phase": "done", "audioSeconds": fed,
  "feedMs": feedEnd.timeIntervalSince(feedStart) * 1000,
  "wallMs": Date().timeIntervalSince(feedStart) * 1000,
  "feedStartedAt": feedStart.timeIntervalSince1970 * 1000,
])
exit(0)
