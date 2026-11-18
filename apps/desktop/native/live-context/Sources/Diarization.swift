import AVFoundation
import CSherpaOnnx
import Foundation

/// What a capture needs for speaker labels. Off unless the start command
/// asks for it, so a capture without it never loads the library or models.
struct DiarizationOptions {
  var library: String
  var segmentationModel: String
  var embeddingModel: String
  /// ONNX Runtime's execution provider ("cpu", or "coreml" to try).
  var provider = ProcessInfo.processInfo.environment["PINE_LIVE_CONTEXT_PROVIDER"] ?? "cpu"
  var threads = 1
  /// A chunk this similar to the voice just heard continues it (fast path).
  var continuity: Float = 0.65

  /// The library ships beside the helper: build/live-context-lib in
  /// development, Contents/Resources/live-context-lib in Pine.app.
  static var defaultLibrary: String {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    return executable.deletingLastPathComponent()
      .appendingPathComponent("live-context-lib/libsherpa-onnx-c-api.dylib").path
  }

  init(library: String, segmentationModel: String, embeddingModel: String) {
    self.library = library
    self.segmentationModel = segmentationModel
    self.embeddingModel = embeddingModel
  }

  /// `{"segmentation": path, "embedding": path, "library"?, "continuity"?}`
  init?(command: [String: Any]) {
    guard
      let segmentation = command["segmentation"] as? String,
      let embedding = command["embedding"] as? String
    else { return nil }
    self.init(
      library: (command["library"] as? String) ?? Self.defaultLibrary,
      segmentationModel: segmentation, embeddingModel: embedding)
    if let continuity = command["continuity"] as? Double { self.continuity = Float(continuity) }
  }
}

/// The models, loaded when a capture with speakers starts and released when
/// it stops, shared by both sources. All inference runs on one serial,
/// utility-QoS queue on one thread, so it never takes more than one core
/// from transcription.
final class DiarizationEngine: @unchecked Sendable {
  let queue = DispatchQueue(label: "pine.live-context.diarization", qos: .utility)
  let options: DiarizationOptions
  let budget = DiarizationBudget()
  let echo = EchoGuard()
  private let engine: OpaquePointer
  let sampleRate: Int
  let dimension: Int
  let windowSamples: Int

  private init(options: DiarizationOptions, engine: OpaquePointer) {
    self.options = options
    self.engine = engine
    sampleRate = Int(pine_sherpa_sample_rate(engine))
    dimension = Int(pine_sherpa_embedding_dim(engine))
    windowSamples = Int(pine_sherpa_window_samples(engine))
  }

  static func load(_ options: DiarizationOptions) throws -> DiarizationEngine {
    for file in [options.library, options.segmentationModel, options.embeddingModel]
    where !FileManager.default.fileExists(atPath: file) {
      throw HelperError("speakers_unavailable", "Missing \(URL(fileURLWithPath: file).lastPathComponent).")
    }
    if let error = pine_sherpa_load(options.library) {
      throw HelperError("speakers_unavailable", String(cString: error))
    }
    guard
      let engine = pine_sherpa_create(
        options.segmentationModel, options.embeddingModel, Int32(options.threads), options.provider)
    else {
      throw HelperError("speakers_unavailable", "The speaker models could not be loaded.")
    }
    return DiarizationEngine(options: options, engine: engine)
  }

  deinit { pine_sherpa_destroy(engine) }

  func segment(_ samples: ArraySlice<Float>) -> [PineSpeakerTurn] {
    var turns = [PineSpeakerTurn](repeating: PineSpeakerTurn(), count: 64)
    let count = samples.withUnsafeBufferPointer { buffer in
      turns.withUnsafeMutableBufferPointer { output in
        pine_sherpa_segment(
          engine, buffer.baseAddress, Int32(buffer.count), output.baseAddress,
          Int32(output.count))
      }
    }
    return count > 0 ? Array(turns.prefix(Int(count))) : []
  }

  /// A normalized embedding, or nil when the audio is too short.
  func embed(_ samples: [Float]) -> [Float]? {
    var embedding = [Float](repeating: 0, count: dimension)
    let ok = samples.withUnsafeBufferPointer { buffer in
      embedding.withUnsafeMutableBufferPointer { output in
        pine_sherpa_embed(engine, buffer.baseAddress, Int32(buffer.count), output.baseAddress)
      }
    }
    return ok == 1 ? normalized(embedding) : nil
  }
}

/// Scales speaker labels back, never transcription: when inference falls
/// behind or takes too much CPU, when the Mac runs hot, or in Low Power
/// Mode. Level 1 analyzes every 3 s instead of 1.5 s, 2 also segments at
/// most every 5 s, 3 only embeds (labels wait for the final pass), 4 stops.
/// It degrades at once and recovers one level per 30 s of calm.
final class DiarizationBudget: @unchecked Sendable {
  // Engine queue only.
  private(set) var level = 0
  private var reason: String?
  private var busy: [(at: Double, seconds: Double)] = []
  private var lastChange = -Double.infinity
  private var lastLoadStep = -Double.infinity
  private let started = ProcessInfo.processInfo.systemUptime

  var hopSeconds: Double { level >= 1 ? 3 : 1.5 }
  var slowInterval: Double { level >= 2 ? 5 : 2.5 }
  var segments: Bool { level < 3 }
  var paused: Bool { level >= 4 }

  /// Share of one core used for inference over the last 30 s.
  private(set) var share: Double = 0

  func record(busy seconds: Double, backlog: Double) {
    let now = ProcessInfo.processInfo.systemUptime
    busy.append((now, seconds))
    busy.removeAll { $0.at < now - 30 }
    share = busy.reduce(0) { $0 + $1.seconds } / max(5, min(30, now - started))

    let environment = ProcessInfo.processInfo.environment
    let thermal: ProcessInfo.ThermalState =
      switch environment["PINE_LIVE_CONTEXT_THERMAL"] {
      case "serious": .serious
      case "critical": .critical
      default: ProcessInfo.processInfo.thermalState
      }
    let lowPower =
      environment["PINE_LIVE_CONTEXT_LOW_POWER"] == "1"
      || ProcessInfo.processInfo.isLowPowerModeEnabled
    var target = 0
    var why: String?
    if thermal == .critical {
      target = 4
      why = "thermal"
    } else if thermal == .serious {
      target = 2
      why = "thermal"
    }
    if lowPower && target < 2 {
      target = 2
      why = "power"
    }
    // Load: one step at a time, and back only once well under the limit.
    let overloaded = share > 0.25 || backlog > 6
    if overloaded {
      let next = now - lastLoadStep >= 10 ? min(4, level + 1) : level
      if next > target {
        target = next
        why = "load"
        lastLoadStep = now
      }
    } else if share > 0.12 && level > target {
      target = level
      why = reason
    }
    var next = level
    if target > level {
      next = target
    } else if target < level && now - lastChange >= 30 {
      next = level - 1
    }
    guard next != level else { return }
    level = next
    reason = next == 0 ? nil : why ?? reason
    lastChange = now
    Output.emit([
      "type": "speakers-state", "level": level, "reason": reason ?? NSNull(),
    ])
  }
}

/// Keeps the other side's voice from turning up twice. When the Mac plays a
/// call through its speakers, the mic hears it again a little later; mic
/// audio whose loudness follows the system audio's (normalized
/// cross-correlation of 10 ms envelopes, 0–300 ms behind, at least 0.8) is
/// echo and left out of the mic's speakers.
final class EchoGuard: @unchecked Sendable {
  private let lock = NSLock()
  private struct Envelope {
    /// Frame index (10 ms of uptime) of `values[0]`.
    var start = 0
    var values: [Float] = []
    var remainder: [Float] = []
    /// The source's sample index at frame `origin`; frames count samples
    /// from there, so timing follows the audio, not callback jitter.
    var originSample = 0
    var origin = 0
  }
  private var envelopes: [String: Envelope] = [:]
  private static let keep = 2000
  /// Testing with `--file`: the sources play together, at any speed.
  nonisolated(unsafe) static var audioFiles = false

  /// Called on the capture thread with 16 kHz audio, its first sample's
  /// index and when it began.
  func push(_ source: String, samples: UnsafeBufferPointer<Float>, sample: Int, at wall: Double) {
    lock.lock()
    defer { lock.unlock() }
    var envelope = envelopes[source] ?? Envelope()
    let frame = Int((wall * 100).rounded())
    let counted = envelope.origin + (sample - envelope.originSample) / 160
    // Device clocks drift a little; resync when they are half a second
    // apart (never for test files, which may play faster than real time).
    let drifted = !Self.audioFiles && abs(frame - counted) > 50
    if envelope.values.isEmpty || drifted
      || sample != envelope.originSample + (envelope.start - envelope.origin + envelope.values.count) * 160
        + envelope.remainder.count
    {
      // A gap (pause, device change) or drift: start over from here.
      envelope = Envelope(start: frame, originSample: sample, origin: frame)
    }
    envelope.remainder.append(contentsOf: samples)
    var index = 0
    while envelope.remainder.count - index >= 160 {
      var sum: Float = 0
      for i in index..<(index + 160) { sum += envelope.remainder[i] * envelope.remainder[i] }
      envelope.values.append(sqrt(sum / 160))
      index += 160
    }
    envelope.remainder.removeFirst(index)
    if envelope.values.count > Self.keep {
      let excess = envelope.values.count - Self.keep
      envelope.values.removeFirst(excess)
      envelope.start += excess
    }
    envelopes[source] = envelope
  }

  /// The mic frame of one of its samples.
  private func micFrame(_ sample: Int) -> Int? {
    guard let mic = envelopes["mic"] else { return nil }
    return mic.origin + (sample - mic.originSample) / 160
  }

  /// The best correlation of mic samples [from, to) with the system audio
  /// shortly before, or nil when the system was quiet.
  func echo(from: Int, to: Int) -> Float? {
    lock.lock()
    defer { lock.unlock() }
    guard let mic = envelopes["mic"], let system = envelopes["system"],
      let a = micFrame(from), let b = micFrame(to)
    else { return nil }
    guard b - a >= 50, a >= mic.start, b <= mic.start + mic.values.count else { return nil }
    let micValues = mic.values[(a - mic.start)..<(b - mic.start)].map { log(1e-4 + $0) }
    var best: Float = -1
    var active = 0
    // The system tap hears audio before the speakers play it; allow a
    // little jitter the other way.
    for lag in -5...30 {
      let s0 = a - lag - system.start
      let s1 = b - lag - system.start
      guard s0 >= 0, s1 <= system.values.count else { continue }
      let slice = system.values[s0..<s1]
      active = max(active, slice.filter { $0 > 0.005 }.count)
      best = max(best, correlation(micValues, slice.map { log(1e-4 + $0) }))
    }
    guard active * 10 >= (b - a) * 4 else { return nil }
    return best
  }

  private func correlation(_ x: [Float], _ y: [Float]) -> Float {
    let n = Float(x.count)
    let mx = x.reduce(0, +) / n
    let my = y.reduce(0, +) / n
    var sxy: Float = 0
    var sxx: Float = 0
    var syy: Float = 0
    for i in x.indices {
      let dx = x[i] - mx
      let dy = y[i] - my
      sxy += dx * dy
      sxx += dx * dx
      syy += dy * dy
    }
    return sxx > 0 && syy > 0 ? sxy / sqrt(sxx * syy) : 0
  }
}

typealias LevelFrame = (sample: Int, speech: Bool, level: Float)

/// Measures who speaks when in one source and reports it to Pine, which
/// does the clustering (see src/main/liveContextDiarizer.ts).
///
/// Every hop (1.5 s) of new audio: silence is skipped; mic audio that is
/// loudspeaker echo is reported and skipped. While one voice keeps talking
/// (no pause, no jump in loudness, and its 3 s chunk sounds like the voice
/// just heard) only an embedding is computed: the fast path. Otherwise the
/// segmentation model looks at the last 10 s for local speakers, turn
/// changes and overlap, and each local speaker with new clean speech (at
/// least 1 s, overlaps removed) gets an embedding: the slow path. No audio
/// is kept beyond the last 15 s.
final class SpeakerTracker: @unchecked Sendable {
  let source: String
  private let engine: DiarizationEngine
  private let rate: Int
  private let frame = 160
  private let margin: Int

  // Written on the capture thread, read on the engine queue.
  private let lock = NSLock()
  private var incoming: [Float] = []
  /// Absolute sample index of `incoming[0]`.
  private var incomingStart = 0
  private var scheduled = false
  private var hopSamples: Int
  private var converter: AVAudioConverter?
  private let format: AVAudioFormat
  private var deviceChanged = false
  private var restarted = false

  // Engine queue only.
  private var ring: [Float] = []
  private var ringStart = 0
  /// Per 10 ms frame of `ring`.
  private var levels: [Float] = []
  private var noiseFloor: Float = 0.002
  private var processed = 0
  private var lastSlow = -Double.infinity
  /// The slow path has embedded speech up to here.
  private var embeddedUntil = 0
  private var run: [Float]?
  private var lastWindow: Int?
  /// Mic audio found to be loudspeaker echo, as sample ranges.
  private var echoes: [(Int, Int)] = []
  private var wasSilent = true
  private var windowId = 0
  private var stats = (fast: 0, slow: 0, embeddings: 0, echo: 0, skipped: 0, busy: 0.0)

  init(source: String, engine: DiarizationEngine) {
    self.source = source
    self.engine = engine
    rate = engine.sampleRate
    margin = Int(0.3 * Double(engine.sampleRate))
    hopSamples = Int(1.5 * Double(engine.sampleRate))
    format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32, sampleRate: Double(engine.sampleRate), channels: 1,
      interleaved: false)!
  }

  /// Called on the capture thread with the audio the analyzer gets, so both
  /// share one timeline.
  func append(_ buffer: AVAudioPCMBuffer) {
    let wall = ProcessInfo.processInfo.systemUptime
      - Double(buffer.frameLength) / buffer.format.sampleRate
    lock.lock()
    defer { lock.unlock() }
    if converter == nil || converter?.inputFormat != buffer.format {
      if converter != nil && !restarted { deviceChanged = true }
      restarted = false
      converter = AVAudioConverter(from: buffer.format, to: format)
    }
    guard let converter, buffer.frameLength > 0 else { return }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
    var supplied = false
    let status = converter.convert(to: output, error: nil) { _, outStatus in
      if supplied {
        outStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      outStatus.pointee = .haveData
      return buffer
    }
    guard status != .error, output.frameLength > 0, let channel = output.floatChannelData?[0]
    else { return }
    let samples = UnsafeBufferPointer(start: channel, count: Int(output.frameLength))
    engine.echo.push(source, samples: samples, sample: incomingStart + incoming.count, at: wall)
    incoming.append(contentsOf: samples)
    if !scheduled && incoming.count >= hopSamples {
      scheduled = true
      engine.queue.async { [self] in step(final: false) }
    }
  }

  /// A capture restarts after a pause: what came before is not continuous
  /// with what follows.
  func restart() {
    lock.withLock {
      restarted = true
      converter = nil
    }
    engine.queue.async { [self] in
      let start = lock.withLock { () -> Int in
        incomingStart += incoming.count
        incoming.removeAll()
        return incomingStart
      }
      reset(at: start)
    }
  }

  func finish() async {
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      engine.queue.async { [self] in
        step(final: true)
        Output.log(
          "speakers(\(source)): \(stats.fast) fast, \(stats.slow) slow, \(stats.embeddings) embeddings, \(stats.echo) echo, \(stats.skipped) skipped, \(String(format: "%.2f", stats.busy)) s inference"
        )
        done.resume()
      }
    }
  }

  // MARK: - Engine queue

  private func seconds(_ sample: Int) -> Double { Double(sample) / Double(rate) }

  private func reset(at start: Int) {
    ring.removeAll()
    levels.removeAll()
    ringStart = start
    processed = start
    embeddedUntil = start
    run = nil
    lastWindow = nil
    wasSilent = true
  }

  private func step(final: Bool) {
    let (samples, start, changed) = lock.withLock { () -> ([Float], Int, Bool) in
      let taken = (incoming, incomingStart, deviceChanged)
      incomingStart += incoming.count
      incoming.removeAll(keepingCapacity: true)
      scheduled = false
      deviceChanged = false
      return taken
    }
    if changed {
      Output.emit(["type": "device", "source": source])
      run = nil
      lastWindow = nil
    }
    // Audio arrives whole; anything else (a restart) starts over.
    if ring.isEmpty || start != ringStart + ring.count { reset(at: start) }
    let first = levels.count * frame
    ring.append(contentsOf: samples)
    for index in stride(from: first, through: ring.count - frame, by: frame) {
      var sum: Float = 0
      for i in index..<(index + frame) { sum += ring[i] * ring[i] }
      let level = sqrt(sum / Float(frame))
      levels.append(level)
      // The noise floor falls at once and rises slowly.
      noiseFloor = level < noiseFloor ? max(0.0003, level) : min(0.05, noiseFloor * 1.0005)
    }

    let end = ringStart + levels.count * frame
    let commit = final ? end : end - margin
    let started = Date()
    while commit - processed >= hopSamples || (final && commit - processed > rate / 2) {
      let cut = min(processed + hopSamples, commit)
      process(until: cut)
      processed = cut
    }
    let busy = Date().timeIntervalSince(started)
    stats.busy += busy
    let keep = 15 * rate
    if ring.count > keep {
      let excess = ((ring.count - keep) / frame) * frame
      ring.removeFirst(excess)
      levels.removeFirst(excess / frame)
      ringStart += excess
    }
    engine.budget.record(busy: busy, backlog: seconds(lock.withLock { incoming.count }))
    let hop = Int(engine.budget.hopSeconds * Double(rate))
    lock.withLock { hopSamples = hop }
  }

  private func isSpeech(_ level: Float) -> Bool {
    level > max(0.003, noiseFloor * 2.5)
  }

  /// The 10 ms frames of [from, to).
  private func frames(_ from: Int, _ to: Int) -> [LevelFrame] {
    let a = max(0, (from - ringStart) / frame)
    let b = min(levels.count, (to - ringStart) / frame)
    guard a < b else { return [] }
    return (a..<b).map { (ringStart + $0 * frame, isSpeech(levels[$0]), levels[$0]) }
  }

  private func process(until cut: Int) {
    if engine.budget.paused {
      run = nil
      wasSilent = true
      return
    }
    let fresh = frames(processed, cut)
    // Gating: silence costs nothing.
    guard !fresh.isEmpty, fresh.filter(\.speech).count * 5 >= fresh.count else {
      wasSilent = true
      run = nil
      stats.skipped += 1
      return
    }
    let chunkStart = max(ringStart, cut - 3 * rate)
    let echoCorrelation = source == "mic" ? engine.echo.echo(from: chunkStart, to: cut) : nil
    if debug, source == "mic" {
      Output.log("echo? \(round2(seconds(cut))) \(echoCorrelation.map { String($0) } ?? "quiet")")
    }
    if let correlation = echoCorrelation, correlation >= 0.8 {
      Output.emit([
        "type": "echo", "source": source, "t0": round2(seconds(processed)),
        "t1": round2(seconds(cut)), "correlation": round2(Double(correlation)),
      ])
      stats.echo += 1
      echoes.append((processed, cut))
      echoes.removeAll { $0.1 < ringStart }
      run = nil
      lastWindow = nil
      return
    }
    let chunk = frames(chunkStart, cut)
    let onset = wasSilent
    wasSilent = false

    // Fast path: the same voice keeps talking.
    if let run, let lastWindow, !onset, !hasPause(chunk), !loudnessJump(chunk),
      let (vector, speech, quality) = embedSpeech(chunk), dot(vector, run) >= engine.options.continuity
    {
      let id = emitWindow(
        from: chunkStart, to: cut, slow: false, turns: speechRuns(chunk), after: lastWindow)
      emitEmbedding(
        window: id, local: 0, from: chunkStart, to: cut, seconds: speech, quality: quality,
        vector: vector)
      self.run = normalized(zip(run, vector).map { 0.7 * $0 + 0.3 * $1 })
      self.lastWindow = id
      stats.fast += 1
      return
    }
    guard engine.budget.segments else {
      // Embeddings only; the final pass sorts out the turns.
      if let (vector, speech, quality) = embedSpeech(chunk) {
        let id = emitWindow(from: chunkStart, to: cut, slow: false, turns: speechRuns(chunk))
        emitEmbedding(
          window: id, local: 0, from: chunkStart, to: cut, seconds: speech, quality: quality,
          vector: vector)
        run = vector
        lastWindow = id
        stats.fast += 1
      }
      return
    }
    // Slow path, at most every `slowInterval`; until then the next hop
    // retries (its window still covers this audio).
    guard seconds(cut) - lastSlow >= engine.budget.slowInterval else {
      run = nil
      return
    }
    slowPath(until: cut)
  }

  private func slowPath(until cut: Int) {
    lastSlow = seconds(cut)
    let from = max(ringStart, cut - engine.windowSamples)
    let turns = engine.segment(ring[(from - ringStart)..<(cut - ringStart)]).map {
      (
        start: from + Int(Double($0.start) * Double(rate)),
        end: min(cut, from + Int(Double($0.end) * Double(rate))), local: Int($0.speaker)
      )
    }.flatMap { turn in
      // Echo is nobody's speech here.
      subtract((turn.start, turn.end), echoes).map { (start: $0.0, end: $0.1, local: turn.local) }
    }.filter { $0.end > $0.start }
    stats.slow += 1
    let id = emitWindow(
      from: from, to: cut, slow: true, turns: turns.map { ($0.start, $0.end, $0.local) })
    run = nil
    lastWindow = id
    var lastEnd = -1
    for local in Set(turns.map(\.local)).sorted() {
      let mine = turns.filter { $0.local == local }
      let others = turns.filter { $0.local != local }.map { ($0.start, $0.end) }
      // Only speech no one else talks over.
      let clean = mine.flatMap { subtract(($0.start, $0.end), others) }.sorted { $0.0 < $1.0 }
      // Speech since the last slow pass (hops in between may have waited).
      let since = min(processed, embeddedUntil) - rate / 2
      let recent = clean.reduce(0) { $0 + max(0, $1.1 - max($1.0, since)) }
      guard recent >= Int(0.3 * Double(rate)) else { continue }
      // Its last 3 s of clean speech, from one stretch of talking: within
      // a window the model sometimes gives two similar voices one number,
      // so pieces far apart are not trusted to be one voice.
      var pieces: [(Int, Int)] = []
      var total = 0
      for piece in clean.reversed() where total < 3 * rate {
        if let next = pieces.first, next.0 - piece.1 > 3 * rate / 2 { break }
        let start = max(piece.0, piece.1 - (3 * rate - total))
        pieces.insert((start, piece.1), at: 0)
        total += piece.1 - start
      }
      guard total >= rate, let firstPiece = pieces.first, let lastPiece = pieces.last else {
        continue
      }
      var samples: [Float] = []
      for (a, b) in pieces { samples.append(contentsOf: ring[(a - ringStart)..<(b - ringStart)]) }
      guard let vector = engine.embed(samples) else { continue }
      let spoken = mine.reduce(0) { $0 + $1.end - $1.start }
      let alone = clean.reduce(0) { $0 + $1.1 - $1.0 }
      let quality =
        min(1, Double(total) / Double(3 * rate))
        * snrFactor(frames(firstPiece.0, lastPiece.1))
        * max(0.3, Double(alone) / Double(max(1, spoken)))
      emitEmbedding(
        window: id, local: local, from: firstPiece.0, to: lastPiece.1,
        seconds: seconds(total), quality: quality, vector: vector)
      // The voice talking at the end carries on into the fast path.
      if let end = mine.map(\.end).max(), end > lastEnd, cut - end < rate / 2 {
        lastEnd = end
        run = vector
      }
    }
    embeddedUntil = cut
  }

  /// The speech frames' audio, embedded, when there is at least 1 s.
  private func embedSpeech(_ chunk: [LevelFrame]) -> ([Float], Double, Double)? {
    var samples: [Float] = []
    for item in chunk where item.speech {
      let offset = item.sample - ringStart
      samples.append(contentsOf: ring[offset..<(offset + frame)])
    }
    guard samples.count >= rate, let vector = engine.embed(samples) else { return nil }
    let speech = seconds(samples.count)
    return (vector, speech, min(1, speech / 3) * snrFactor(chunk))
  }

  private func snrFactor(_ chunk: [LevelFrame]) -> Double {
    let speech = chunk.filter(\.speech).map(\.level)
    guard !speech.isEmpty else { return 0.2 }
    let level = speech.reduce(0, +) / Float(speech.count)
    let snr = 20 * log10(Double(level / max(noiseFloor, 1e-4)))
    return min(1, max(0.2, (snr - 3) / 15))
  }

  /// Where the chunk has speech, as one speaker's turns (short gaps bridged).
  private func speechRuns(_ chunk: [LevelFrame]) -> [(Int, Int, Int)] {
    var runs: [(Int, Int, Int)] = []
    for item in chunk where item.speech {
      if let last = runs.last, item.sample - last.1 <= 30 * frame {
        runs[runs.count - 1].1 = item.sample + frame
      } else {
        runs.append((item.sample, item.sample + frame, 0))
      }
    }
    return runs
  }

  /// A third of a second without speech: someone may have taken over.
  private func hasPause(_ chunk: [LevelFrame]) -> Bool {
    var silent = 0
    for item in chunk {
      silent = item.speech ? 0 : silent + 1
      if silent >= 35 { return true }
    }
    return false
  }

  /// The second half 8 dB louder or quieter than the first.
  private func loudnessJump(_ chunk: [LevelFrame]) -> Bool {
    let half = chunk.count / 2
    func decibels(_ part: ArraySlice<LevelFrame>) -> Double? {
      let speech = part.filter(\.speech).map(\.level)
      guard speech.count >= 10 else { return nil }
      return 20 * log10(Double(speech.reduce(0, +) / Float(speech.count)))
    }
    guard let a = decibels(chunk[..<half]), let b = decibels(chunk[half...]) else { return false }
    return abs(a - b) > 8
  }

  private func emitWindow(
    from: Int, to: Int, slow: Bool, turns: [(Int, Int, Int)], after: Int? = nil
  ) -> Int {
    let id = windowId
    windowId += 1
    var event: [String: Any] = [
      "type": "window", "source": source, "id": id, "t0": round2(seconds(from)),
      "t1": round2(seconds(to)), "slow": slow,
      "turns": turns.map { [round2(seconds($0.0)), round2(seconds($0.1)), $0.2] },
      "at": nowMs(),
    ]
    if let after { event["after"] = after }
    Output.emit(event)
    return id
  }

  private func emitEmbedding(
    window: Int, local: Int, from: Int, to: Int, seconds speech: Double, quality: Double,
    vector: [Float]
  ) {
    stats.embeddings += 1
    Output.emit([
      "type": "embedding", "source": source, "window": window, "local": local,
      "t0": round2(seconds(from)), "t1": round2(seconds(to)), "seconds": round2(speech),
      "quality": round2(quality), "vector": float16Base64(vector),
    ])
  }
}

private let debug = ProcessInfo.processInfo.environment["PINE_LIVE_CONTEXT_DEBUG"] == "1"

private func round2(_ value: Double) -> Double { (value * 100).rounded() / 100 }

/// Little-endian IEEE half floats, base64: 384 bytes for 192 numbers.
func float16Base64(_ vector: [Float]) -> String {
  var bytes = [UInt8]()
  bytes.reserveCapacity(vector.count * 2)
  for value in vector {
    let bits = value.bitPattern
    let sign = UInt16((bits >> 16) & 0x8000)
    let exponent = Int((bits >> 23) & 0xff) - 127 + 15
    let fraction = bits & 0x7f_ffff
    var half: UInt16
    if exponent <= 0 {
      half = sign
    } else if exponent >= 31 {
      half = sign | 0x7bff
    } else {
      let rounded = (UInt32(exponent) << 10) + ((fraction + 0x1000) >> 13)
      half = sign | UInt16(min(rounded, 0x7bff))
    }
    bytes.append(UInt8(half & 0xff))
    bytes.append(UInt8(half >> 8))
  }
  return Data(bytes).base64EncodedString()
}

// MARK: - Vector helpers

func normalized(_ vector: [Float]) -> [Float] {
  let norm = sqrt(vector.reduce(0) { $0 + $1 * $1 })
  return norm > 0 ? vector.map { $0 / norm } : vector
}

func dot(_ a: [Float], _ b: [Float]) -> Float {
  zip(a, b).reduce(0) { $0 + $1.0 * $1.1 }
}

/// `range` minus `holes`, as sorted half-open pieces.
private func subtract(_ range: (Int, Int), _ holes: [(Int, Int)]) -> [(Int, Int)] {
  var pieces = [range]
  for hole in holes {
    pieces = pieces.flatMap { piece -> [(Int, Int)] in
      if hole.1 <= piece.0 || hole.0 >= piece.1 { return [piece] }
      return [(piece.0, hole.0), (hole.1, piece.1)].filter { $0.1 > $0.0 }
    }
  }
  return pieces
}
