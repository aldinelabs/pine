import AVFoundation
import CSherpaOnnx
import Foundation

/// What a capture needs for speaker labels. Off unless the start command
/// asks for it, so a capture without it never loads the library or models.
struct DiarizationOptions {
  var library: String
  var segmentationModel: String
  var embeddingModel: String
  /// Cosine similarity a voice needs to join a known speaker.
  var threshold: Float = 0.6
  /// New voices beyond this join the closest known speaker.
  var maxSpeakers = 8
  /// Speakers from earlier captures of the session, per source.
  var voices: [String: [Voice]] = [:]

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

  /// `{"segmentation": path, "embedding": path, "threshold"?, "maxSpeakers"?, "voices"?}`
  init?(command: [String: Any]) {
    guard
      let segmentation = command["segmentation"] as? String,
      let embedding = command["embedding"] as? String
    else { return nil }
    self.init(
      library: (command["library"] as? String) ?? Self.defaultLibrary,
      segmentationModel: segmentation, embeddingModel: embedding)
    if let threshold = command["threshold"] as? Double { self.threshold = Float(threshold) }
    if let maxSpeakers = command["maxSpeakers"] as? Int { self.maxSpeakers = max(1, maxSpeakers) }
    if let voices = command["voices"] as? [String: Any] {
      for (source, list) in voices {
        self.voices[source] = ((list as? [[String: Any]]) ?? []).compactMap(Voice.init(json:))
      }
    }
  }
}

/// A speaker's voice print: the sum of its normalized embeddings.
struct Voice {
  var speaker: Int
  var sum: [Float]
  var count: Int

  init(speaker: Int, sum: [Float], count: Int) {
    self.speaker = speaker
    self.sum = sum
    self.count = count
  }

  init?(json: [String: Any]) {
    guard
      let speaker = json["speaker"] as? Int,
      let centroid = json["centroid"] as? [Double], !centroid.isEmpty
    else { return nil }
    let count = max(1, (json["count"] as? Int) ?? 1)
    self.init(
      speaker: speaker, sum: normalized(centroid.map { Float($0) }).map { $0 * Float(count) },
      count: count)
  }

  var json: [String: Any] {
    [
      "speaker": speaker,
      "centroid": normalized(sum).map { (Double($0) * 1e5).rounded() / 1e5 },
      "count": count,
    ]
  }
}

/// The models, loaded once per capture and shared by both sources. All
/// inference runs on one serial, low-priority queue, so diarization never
/// competes with transcription for more than one core.
final class DiarizationEngine: @unchecked Sendable {
  let queue = DispatchQueue(label: "pine.live-context.diarization", qos: .utility)
  let options: DiarizationOptions
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
      let engine = pine_sherpa_create(options.segmentationModel, options.embeddingModel, 1)
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

/// Labels one source's segments "speaker 1, 2, …" as they arrive.
///
/// Every `hop` of new audio it runs the segmentation model once over the
/// last window (10 s), embeds only the speech that is new since the last
/// pass, and assigns it to a speaker by cosine similarity with the running
/// voice prints (online clustering), so the cost stays flat however long the
/// capture runs. Labels for a segment may change as more audio arrives; each
/// change is a `speaker` event. At the end, a short re-pass over the stored
/// embeddings (never audio) merges speakers that turned out to be one voice
/// and relabels.
final class SpeakerTracker: @unchecked Sendable {
  let source: String
  private let engine: DiarizationEngine
  private let hop: Int
  /// The end of each window is not yet settled; labels wait for this much.
  private let margin: Int
  /// Below this RMS, new audio counts as silence and is skipped.
  private let silenceRMS: Float = 0.003

  // Written on the capture thread, read on the engine queue.
  private let lock = NSLock()
  private var incoming: [Float] = []
  private var scheduled = false
  private var converter: AVAudioConverter?
  private let format: AVAudioFormat

  // Engine queue only.
  private var audio: [Float] = []
  /// Absolute sample index of `audio[0]`.
  private var audioStart = 0
  private var committed = 0
  private var voices: [Voice]
  private var nextSpeaker: Int
  private var regions: [Region] = []
  private var segments: [String: Span] = [:]
  private var segmentOrder: [String] = []
  /// Seconds of inference, for the performance log.
  private(set) var busySeconds: Double = 0
  private(set) var passes = 0

  private struct Region {
    var start: Int
    var end: Int
    var speaker: Int
    var similarity: Float
    var embedding: [Float]
  }

  private struct Span {
    var start: Double
    var end: Double
    var words: [TimedWord]
    /// UTF-16 length of the text.
    var length: Int
    /// What was last reported, to report only changes.
    var turns: [Turn] = []
    var confidence: Double = 0
  }

  private struct Turn: Equatable {
    var offset: Int
    var speaker: Int
  }

  init(source: String, engine: DiarizationEngine, hopSeconds: Double = 2, marginSeconds: Double = 0.5) {
    self.source = source
    self.engine = engine
    hop = Int(hopSeconds * Double(engine.sampleRate))
    margin = Int(marginSeconds * Double(engine.sampleRate))
    format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32, sampleRate: Double(engine.sampleRate), channels: 1,
      interleaved: false)!
    voices = engine.options.voices[source] ?? []
    nextSpeaker = (voices.map(\.speaker).max() ?? 0) + 1
  }

  /// Called on the capture thread with the audio the analyzer gets, so both
  /// share one timeline.
  func append(_ buffer: AVAudioPCMBuffer) {
    lock.lock()
    defer { lock.unlock() }
    if converter == nil || converter?.inputFormat != buffer.format {
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
    incoming.append(contentsOf: UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
    if !scheduled && incoming.count >= hop {
      scheduled = true
      engine.queue.async { [self] in pass(final: false) }
    }
  }

  /// A segment's span on the analyzer timeline, in seconds. Volatile
  /// updates widen it; the label follows.
  func noteSegment(id: String, start: Double, end: Double, words: [TimedWord], length: Int) {
    engine.queue.async { [self] in
      if segments[id] == nil { segmentOrder.append(id) }
      var span = segments[id] ?? Span(start: start, end: end, words: words, length: length)
      span.start = start
      span.end = end
      span.words = words
      span.length = length
      segments[id] = span
      relabel([id])
    }
  }

  /// Labels what is left, cleans up with the re-pass, and reports the voice
  /// prints so a later capture of the session keeps the same numbers.
  func finish() async {
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      engine.queue.async { [self] in
        pass(final: true)
        recluster()
        relabel(segmentOrder)
        Output.emit([
          "type": "voices", "source": source, "voices": voices.map(\.json),
        ])
        if ProcessInfo.processInfo.environment["PINE_LIVE_CONTEXT_DEBUG"] == "1" {
          let rate = Double(engine.sampleRate)
          for region in regions {
            Output.log(
              "region \(source) \(Double(region.start) / rate) \(Double(region.end) / rate) \(region.speaker) \(region.similarity)"
            )
          }
        }
        Output.log(
          "speakers(\(source)): \(passes) passes, \(String(format: "%.2f", busySeconds)) s inference, \(voices.count) speakers"
        )
        done.resume()
      }
    }
  }

  // MARK: - Engine queue

  private func pass(final: Bool) {
    lock.lock()
    audio.append(contentsOf: incoming)
    incoming.removeAll(keepingCapacity: true)
    scheduled = false
    lock.unlock()

    let end = audioStart + audio.count
    let commitEnd = final ? end : end - margin
    defer { trim(keeping: engine.windowSamples) }
    guard commitEnd > committed else { return }
    let windowStart = max(audioStart, end - engine.windowSamples)
    let window = audio[(windowStart - audioStart)..<audio.count]

    if rms(audio[(max(committed, windowStart) - audioStart)..<(commitEnd - audioStart)]) < silenceRMS {
      committed = commitEnd
      return
    }

    let started = Date()
    passes += 1
    let rate = Double(engine.sampleRate)
    let turns = engine.segment(window).map {
      (
        start: windowStart + Int(Double($0.start) * rate),
        end: min(end, windowStart + Int(Double($0.end) * rate)), speaker: Int($0.speaker)
      )
    }.filter { $0.end > $0.start }
    // One embedding per turn with new speech: that turn's own audio (where
    // no one else talks), up to its last 6 s, topped up from the same
    // voice's nearest other turns when shorter than 1.5 s. Pooling a whole
    // window mixes voices whenever the segmentation slips.
    let clean = turns.map { turn in
      subtract((turn.start, turn.end), turns.filter { $0.speaker != turn.speaker }.map { ($0.start, $0.end) })
    }
    var touched: [Region] = []
    for (index, turn) in turns.enumerated() {
      let start = max(turn.start, committed)
      let stop = min(turn.end, commitEnd)
      guard stop - start > Int(0.25 * rate) else { continue }
      var pieces = clean[index]
      let nearby = turns.indices.filter { $0 != index && turns[$0].speaker == turn.speaker }
        .sorted { abs(turns[$0].start - turn.start) < abs(turns[$1].start - turn.start) }
      for other in nearby where length(pieces) < Int(1.5 * rate) {
        pieces += clean[other]
      }
      var samples: [Float] = []
      for (from, to) in pieces.sorted(by: { $0.0 < $1.0 }) {
        samples.append(contentsOf: audio[(from - audioStart)..<(to - audioStart)])
      }
      if samples.count > Int(6 * rate) { samples = Array(samples.suffix(Int(6 * rate))) }
      guard samples.count >= Int(0.5 * rate), let embedding = engine.embed(samples),
        let (speaker, similarity) = assign(embedding, seconds: Double(samples.count) / rate)
      else { continue }
      let region = Region(
        start: start, end: stop, speaker: speaker, similarity: similarity, embedding: embedding)
      regions.append(region)
      touched.append(region)
    }
    committed = commitEnd
    busySeconds += Date().timeIntervalSince(started)
    if touched.isEmpty { return }
    let from = Double(touched.map(\.start).min()!) / rate
    let to = Double(touched.map(\.end).max()!) / rate
    relabel(segmentOrder.filter { id in
      guard let span = segments[id] else { return false }
      return span.end >= from - 2 && span.start <= to + 2
    })
  }

  /// The speaker for a new embedding: the closest known voice when similar
  /// enough, else a new speaker (while under the cap and long enough to
  /// trust), else the closest anyway.
  private func assign(_ embedding: [Float], seconds: Double) -> (Int, Float)? {
    var best: Int?
    var bestSimilarity: Float = -1
    for (index, voice) in voices.enumerated() {
      let similarity = dot(embedding, normalized(voice.sum))
      if similarity > bestSimilarity {
        best = index
        bestSimilarity = similarity
      }
    }
    let threshold = engine.options.threshold
    if let best, bestSimilarity >= threshold {
      if seconds >= 1 {
        voices[best].sum = zip(voices[best].sum, embedding).map(+)
        voices[best].count += 1
      }
      return (voices[best].speaker, bestSimilarity)
    }
    if seconds >= 1, voices.count < engine.options.maxSpeakers {
      let speaker = nextSpeaker
      nextSpeaker += 1
      voices.append(Voice(speaker: speaker, sum: embedding, count: 1))
      return (speaker, threshold)
    }
    if let best { return (voices[best].speaker, bestSimilarity) }
    return nil
  }

  /// Merges speakers whose voice prints (rebuilt from this capture's
  /// embeddings) are as close as one voice, then moves every region to its
  /// closest speaker. Earlier labels were made with less evidence.
  private func recluster() {
    guard !regions.isEmpty else { return }
    let threshold = engine.options.threshold
    var prints: [Int: [Float]] = [:]
    var counts: [Int: Int] = [:]
    for voice in voices {
      prints[voice.speaker] = voice.sum
      counts[voice.speaker] = voice.count
    }
    var merged = true
    while merged && prints.count > 1 {
      merged = false
      let ids = prints.keys.sorted()
      var best: (Int, Int, Float)?
      for (i, a) in ids.enumerated() {
        for b in ids[(i + 1)...] {
          let similarity = dot(normalized(prints[a]!), normalized(prints[b]!))
          if similarity >= threshold, similarity > (best?.2 ?? -1) { best = (a, b, similarity) }
        }
      }
      if let (keep, drop, _) = best {
        prints[keep] = zip(prints[keep]!, prints[drop]!).map(+)
        counts[keep, default: 0] += counts[drop] ?? 0
        prints[drop] = nil
        merged = true
      }
    }
    let centroids = prints.mapValues(normalized)
    for index in regions.indices {
      if let (speaker, similarity) = centroids.map({
        ($0.key, dot(regions[index].embedding, $0.value))
      }).max(by: { $0.1 < $1.1 }) {
        regions[index].speaker = speaker
        regions[index].similarity = similarity
      }
    }
    voices = prints.keys.sorted().map {
      Voice(speaker: $0, sum: prints[$0]!, count: counts[$0] ?? 1)
    }
  }

  /// Splits each segment into speaker turns: every timed word goes to the
  /// speaker whose speech covers it (or the nearest one, within 2 s), and
  /// turns shorter than half a second join their neighbor. Reports a
  /// segment whenever its turns change.
  private func relabel(_ ids: [String]) {
    let rate = Double(engine.sampleRate)
    func speaker(_ start: Double, _ end: Double) -> (Int, Float)? {
      var cover: [Int: Double] = [:]
      var similarity: [Int: Float] = [:]
      var nearest: (gap: Double, region: Region)?
      for region in nearby(start, end) {
        let from = Double(region.start) / rate
        let to = Double(region.end) / rate
        let overlap = min(end, to) - max(start, from)
        if overlap > 0 {
          cover[region.speaker, default: 0] += overlap
          similarity[region.speaker] = max(similarity[region.speaker] ?? -1, region.similarity)
        } else {
          let gap = max(from - end, start - to)
          if gap < (nearest?.gap ?? 2) { nearest = (gap, region) }
        }
      }
      if let (speaker, _) = cover.max(by: { $0.value < $1.value }) {
        return (speaker, similarity[speaker] ?? 0)
      }
      return nearest.map { ($0.region.speaker, $0.region.similarity) }
    }

    for id in ids {
      guard var span = segments[id] else { continue }
      let words =
        span.words.isEmpty
        ? [TimedWord(offset: 0, start: span.start, end: span.end)] : span.words
      var labels = words.map { speaker($0.start, $0.end) }
      guard labels.contains(where: { $0 != nil }) else { continue }
      // Words no voice covers take the speaker before them (or after).
      for index in labels.indices where labels[index] == nil {
        labels[index] = labels[..<index].last(where: { $0 != nil }) ?? labels[index...].first { $0 != nil }!
      }
      var runs: [(turn: Turn, seconds: Double)] = []
      var weighted = 0.0
      var total = 0.0
      for (word, label) in zip(words, labels) {
        guard let (speaker, similarity) = label else { continue }
        let seconds = max(0.05, word.end - word.start)
        weighted += Double(similarity) * seconds
        total += seconds
        if runs.last?.turn.speaker == speaker {
          runs[runs.count - 1].seconds += seconds
        } else {
          runs.append((Turn(offset: runs.isEmpty ? 0 : word.offset, speaker: speaker), seconds))
        }
      }
      // A blip shorter than half a second is more likely noise than a turn.
      var index = 0
      while runs.count > 1 && index < runs.count {
        if runs[index].seconds < 0.5 {
          let into = index == 0 ? 1 : index - 1
          runs[into].seconds += runs[index].seconds
          if index == 0 { runs[1].turn.offset = 0 }
          runs.remove(at: index)
          // Neighbors of the same speaker become one turn.
          var merged: [(turn: Turn, seconds: Double)] = []
          for run in runs {
            if merged.last?.turn.speaker == run.turn.speaker {
              merged[merged.count - 1].seconds += run.seconds
            } else {
              merged.append(run)
            }
          }
          runs = merged
          index = 0
        } else {
          index += 1
        }
      }
      let turns = runs.map(\.turn)
      let confidence = total > 0 ? min(1, max(0, weighted / total)) : 0
      if turns == span.turns && abs(confidence - span.confidence) < 0.1 { continue }
      span.turns = turns
      span.confidence = confidence
      segments[id] = span
      let dominant = runs.max { $0.seconds < $1.seconds }!.turn.speaker
      Output.emit([
        "type": "speaker", "id": id, "source": source, "speaker": dominant,
        "turns": turns.map { ["offset": $0.offset, "speaker": $0.speaker] },
        "confidence": (confidence * 100).rounded() / 100, "at": nowMs(),
      ])
    }
  }

  /// Regions that may touch [start - 2 s, end + 2 s]. Each pass adds
  /// regions only after the last pass's, so they are ordered by pass and at
  /// most one window apart within one; a binary search skips the rest, which
  /// keeps hour-long captures as cheap as short ones.
  private func nearby(_ start: Double, _ end: Double) -> ArraySlice<Region> {
    let rate = Double(engine.sampleRate)
    let from = Int((start - 2) * rate) - engine.windowSamples
    let to = Int((end + 2) * rate) + engine.windowSamples
    var low = 0
    var high = regions.count
    while low < high {
      let middle = (low + high) / 2
      if regions[middle].end < from { low = middle + 1 } else { high = middle }
    }
    var stop = low
    while stop < regions.count && regions[stop].start <= to { stop += 1 }
    return regions[low..<stop]
  }

  private func trim(keeping samples: Int) {
    let excess = audio.count - samples
    if excess > 0 {
      audio.removeFirst(excess)
      audioStart += excess
    }
  }
}

/// A run of transcribed text and when it was said (analyzer seconds).
struct TimedWord {
  var offset: Int
  var start: Double
  var end: Double
}

// MARK: - Vector helpers

func normalized(_ vector: [Float]) -> [Float] {
  let norm = sqrt(vector.reduce(0) { $0 + $1 * $1 })
  return norm > 0 ? vector.map { $0 / norm } : vector
}

func dot(_ a: [Float], _ b: [Float]) -> Float {
  zip(a, b).reduce(0) { $0 + $1.0 * $1.1 }
}

private func rms(_ samples: ArraySlice<Float>) -> Float {
  guard !samples.isEmpty else { return 0 }
  return sqrt(samples.reduce(0) { $0 + $1 * $1 } / Float(samples.count))
}

private func length(_ pieces: [(Int, Int)]) -> Int {
  pieces.reduce(0) { $0 + $1.1 - $1.0 }
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
