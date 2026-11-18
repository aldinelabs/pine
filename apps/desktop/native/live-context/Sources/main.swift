// pine-live-context: captures the microphone and/or system audio, transcribes
// them on device with SpeechAnalyzer, and writes JSON Lines to stdout.
//
// Commands arrive as JSON Lines on stdin:
//   {"type":"start","sources":["mic","system"],"locale":"zh-CN",
//    "speakers":{"segmentation":"…/x.onnx","embedding":"…/y.onnx"}}
//   {"type":"pause"} {"type":"resume"} {"type":"stop"} {"type":"check"}
// Closing stdin stops the capture and exits, so the helper never outlives Pine.
// `speakers` is optional; without it nothing about diarization is loaded.
//
// For a terminal test, `--start --sources mic,system --locale zh-CN` starts
// at once, and `--check` prints what this Mac supports. `--file x.wav`
// (with `--speed 4`) plays a file into the first source instead of a device,
// `--mic-file`/`--system-file` into that source (both at once to test echo);
// `--segmentation a.onnx --embedding b.onnx` turns speaker labels on.
// Speaker events (window, embedding, echo, device, speakers-state) are
// measurements only; Pine clusters them (docs/live-context.md §3.4).
import AVFoundation
import Foundation
import Speech

let protocolVersion = 1

final class Controller: @unchecked Sendable {
  private var pipelines: [String: SourcePipeline] = [:]
  private var captures: [String: AudioCapture] = [:]
  private var state = "idle"
  private var startedAt = Date()
  private var silenceTask: Task<Void, Never>?
  private var diarization: DiarizationEngine?
  /// Testing: feed these files instead of devices.
  var fileInputs: [String: URL] = [:]
  var fileSpeed = 1.0
  var onFileEnd: (@Sendable () -> Void)?

  func handle(_ command: [String: Any]) async {
    switch command["type"] as? String {
    case "check": await check()
    case "start":
      let sources = (command["sources"] as? [String]) ?? ["mic"]
      let locale = (command["locale"] as? String) ?? Locale.current.identifier
      let speakers = (command["speakers"] as? [String: Any]).flatMap(DiarizationOptions.init)
      await start(sources: sources, localeIdentifier: locale, speakers: speakers)
    case "pause": await pause()
    case "resume": resume()
    case "stop": await stop()
    default: Output.error("unknown_command", "Unknown command.")
    }
  }

  func check() async {
    let supported = await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }
    let installed = await SpeechTranscriber.installedLocales.map { $0.identifier(.bcp47) }
    Output.emit([
      "type": "capabilities",
      "available": SpeechTranscriber.isAvailable,
      "supportedLocales": supported.sorted(),
      "installedLocales": installed.sorted(),
      "microphone": MicrophoneCapture.authorization(),
      // macOS cannot report it; silence on the system source means "not granted".
      "systemAudio": "unknown",
    ])
  }

  func start(sources: [String], localeIdentifier: String, speakers: DiarizationOptions? = nil)
    async
  {
    guard state == "idle" else {
      Output.error("already_started", "A capture is already running.")
      return
    }
    guard SpeechTranscriber.isAvailable else {
      Output.error("unavailable", "On-device transcription is not available on this Mac.")
      return
    }
    state = "preparing"
    Output.status("preparing")
    guard
      let locale = await SpeechTranscriber.supportedLocale(
        equivalentTo: Locale(identifier: localeIdentifier))
    else {
      state = "idle"
      Output.error("unsupported_locale", "Transcription does not support \(localeIdentifier).")
      return
    }
    do {
      try await installAssets(for: locale)
    } catch {
      state = "idle"
      Output.error("assets_failed", error.localizedDescription)
      return
    }

    var wanted = Array(Set(sources.filter { $0 == "mic" || $0 == "system" })).sorted()
    // A file standing in for the mic (testing) needs no permission.
    let micAllowed =
      wanted.contains("mic") && fileInputs["mic"] == nil ? await microphoneAllowed() : true
    if !micAllowed {
      Output.error("permission_denied", "Microphone access is off for Pine.", source: "mic")
      wanted.removeAll { $0 == "mic" }
    }
    // Speakers are a bonus: without them the capture goes on as before.
    if let speakers {
      do {
        diarization = try DiarizationEngine.load(speakers)
      } catch let error as HelperError {
        Output.error(error.code, error.message)
      } catch {
        Output.error("speakers_unavailable", error.localizedDescription)
      }
    }
    startedAt = Date()
    for source in wanted {
      do {
        let pipeline = try await SourcePipeline.start(
          source: source, locale: locale, startedAt: startedAt)
        pipelines[source] = pipeline
        if let diarization {
          pipeline.tracker = SpeakerTracker(source: source, engine: diarization)
        }
        let capture = try makeCapture(source)
        try capture.start { pipeline.append($0) }
        captures[source] = capture
      } catch let error as HelperError {
        Output.error(error.code, error.message, source: source)
      } catch {
        Output.error("capture_failed", error.localizedDescription, source: source)
      }
    }
    guard !captures.isEmpty else {
      await finishPipelines()
      state = "idle"
      Output.status("stopped")
      return
    }
    state = "listening"
    Output.status(
      "listening",
      [
        "startedAt": (startedAt.timeIntervalSince1970 * 1000).rounded(),
        "sources": captures.keys.sorted(),
        "locale": locale.identifier(.bcp47),
        "speakers": diarization != nil,
      ])
    watchSilence()
  }

  private var filesPlaying = 0

  private func makeCapture(_ source: String) throws -> AudioCapture {
    if let url = fileInputs[source] {
      let capture = try FileCapture(url: url, speed: fileSpeed)
      filesPlaying += 1
      capture.onEnd = { [weak self] in
        guard let self else { return }
        Task { @MainActor in
          self.filesPlaying -= 1
          if self.filesPlaying == 0 { self.onFileEnd?() }
        }
      }
      return capture
    }
    return source == "mic" ? MicrophoneCapture() : SystemAudioCapture()
  }

  private func installAssets(for locale: Locale) async throws {
    let probe = SourcePipeline.makeTranscriber(locale: locale)
    guard let request = try await AssetInventory.assetInstallationRequest(supporting: [probe])
    else { return }
    Output.status("downloading", ["progress": 0])
    let progress = request.progress
    let reporter = Task {
      while !Task.isCancelled {
        Output.status("downloading", ["progress": (progress.fractionCompleted * 100).rounded() / 100])
        try? await Task.sleep(for: .seconds(1))
      }
    }
    defer { reporter.cancel() }
    try await request.downloadAndInstall()
  }

  private func microphoneAllowed() async -> Bool {
    var status = MicrophoneCapture.authorization()
    if status == "undetermined" {
      Output.emit(["type": "permission", "kind": "microphone", "status": "prompting"])
      status = await MicrophoneCapture.requestAccess() ? "granted" : "denied"
    }
    Output.emit(["type": "permission", "kind": "microphone", "status": status])
    return status == "granted"
  }

  /// A system source that stays silent usually means the permission is off
  /// (or nothing plays); the app decides how to tell the user.
  private func watchSilence() {
    silenceTask?.cancel()
    silenceTask = Task { [weak self] in
      var silentFor = 0
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        guard let self, self.state == "listening", let system = self.pipelines["system"]
        else { continue }
        silentFor = system.takePeak() > 0 ? 0 : silentFor + 1
        if silentFor == 10 {
          Output.status("silent", ["source": "system", "seconds": silentFor])
        }
      }
    }
  }

  func pause() async {
    guard state == "listening" else { return }
    for capture in captures.values { capture.stop() }
    // Volatile text stays pending until resume or stop: finalizing the
    // analyzer mid-stream (`finalize(through:)`) either garbles what follows
    // a resume or never returns (macOS 27.0.1).
    state = "paused"
    Output.status("paused")
  }

  func resume() {
    guard state == "paused" else { return }
    for (source, capture) in captures {
      guard let pipeline = pipelines[source] else { continue }
      pipeline.resetConverter()
      do {
        try capture.start { pipeline.append($0) }
      } catch {
        Output.error("capture_failed", error.localizedDescription, source: source)
      }
    }
    state = "listening"
    Output.status("listening", ["startedAt": (startedAt.timeIntervalSince1970 * 1000).rounded()])
  }

  func stop() async {
    guard state == "listening" || state == "paused" else { return }
    silenceTask?.cancel()
    for capture in captures.values { capture.stop() }
    captures.removeAll()
    await finishPipelines()
    state = "idle"
    Output.status("stopped")
  }

  private func finishPipelines() async {
    for pipeline in pipelines.values { await pipeline.finish() }
    pipelines.removeAll()
    diarization = nil
  }
}

func argument(_ name: String) -> String? {
  let arguments = CommandLine.arguments
  guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
  return arguments[index + 1]
}

signal(SIGPIPE, SIG_IGN)
let controller = Controller()
Output.emit(["type": "ready", "protocol": protocolVersion, "pid": ProcessInfo.processInfo.processIdentifier])

if CommandLine.arguments.contains("--check") {
  await controller.check()
  exit(0)
}

// Testing: files stand in for devices, whether the capture starts from the
// command line or from Pine. `--file` is the first source's.
let firstSource = (argument("--sources") ?? "mic").split(separator: ",").map(String.init).sorted()
  .first ?? "mic"
for (flag, source) in [("--file", firstSource), ("--mic-file", "mic"), ("--system-file", "system")] {
  if let file = argument(flag) { controller.fileInputs[source] = URL(fileURLWithPath: file) }
}
if !controller.fileInputs.isEmpty {
  EchoGuard.audioFiles = true
  controller.fileSpeed = argument("--speed").flatMap(Double.init) ?? 1
  controller.onFileEnd = {
    Task {
      // Let the last words settle before stopping.
      try? await Task.sleep(for: .seconds(2))
      await controller.stop()
      exit(0)
    }
  }
}

let stopSignal = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
signal(SIGINT, SIG_IGN)
stopSignal.setEventHandler {
  Task {
    await controller.stop()
    exit(0)
  }
}
stopSignal.resume()

if CommandLine.arguments.contains("--start") {
  var speakers: DiarizationOptions?
  if let segmentation = argument("--segmentation"), let embedding = argument("--embedding") {
    speakers = DiarizationOptions(
      library: argument("--speaker-library") ?? DiarizationOptions.defaultLibrary,
      segmentationModel: segmentation, embeddingModel: embedding)
    if let continuity = argument("--continuity").flatMap(Float.init) {
      speakers?.continuity = continuity
    }
  }
  await controller.start(
    sources: (argument("--sources") ?? "mic").split(separator: ",").map(String.init),
    localeIdentifier: argument("--locale") ?? Locale.current.identifier, speakers: speakers)
  if let seconds = argument("--seconds").flatMap(Double.init) {
    Task {
      try? await Task.sleep(for: .seconds(seconds))
      await controller.stop()
      exit(0)
    }
  }
}

Task.detached {
  do {
    for try await line in FileHandle.standardInput.bytes.lines {
      guard
        let data = line.data(using: .utf8),
        let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        Output.error("bad_command", "Commands are JSON objects, one per line.")
        continue
      }
      await controller.handle(command)
    }
  } catch {}
  // Pine went away (or closed stdin): never keep listening on our own.
  if !CommandLine.arguments.contains("--start") {
    await controller.stop()
    exit(0)
  }
}

// Top-level code runs on the main actor; keep it alive without blocking the
// main queue (dispatchMain() is not allowed from async top-level code).
while true { try? await Task.sleep(for: .seconds(3600)) }
