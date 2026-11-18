import AVFoundation
import Foundation
import Speech

/// One source's transcription: audio buffers in, segments out. Each source
/// has its own analyzer, so the channel says which side spoke (mic = me,
/// system = others); an optional tracker tells the speakers within it apart.
final class SourcePipeline: @unchecked Sendable {
  let source: String
  /// Set before audio flows; nil unless the capture asked for speakers.
  var tracker: SpeakerTracker?
  private let transcriber: SpeechTranscriber
  private let analyzer: SpeechAnalyzer
  private let format: AVAudioFormat
  private let input: AsyncStream<AnalyzerInput>.Continuation
  private var resultsTask: Task<Void, Never>?
  private let lock = NSLock()
  private var converter: AVAudioConverter?
  /// Where the next buffer starts on the capture timeline, in seconds.
  private var nextTime: Double = 0
  private var nextFrame: Int64 = 0
  /// Wall-clock offsets from pauses: from audio time `at` on, wall time is
  /// audio time + `offset`. The analyzer sees one gapless stream, since a
  /// jump in buffer times garbles what follows.
  private var offsets: [(at: Double, offset: Double)] = [(0, 0)]
  private var segmentIndex = 0
  private let startedAt: Date
  private var peak: Float = 0

  private init(
    source: String, transcriber: SpeechTranscriber, analyzer: SpeechAnalyzer,
    format: AVAudioFormat, input: AsyncStream<AnalyzerInput>.Continuation, startedAt: Date
  ) {
    self.source = source
    self.transcriber = transcriber
    self.analyzer = analyzer
    self.format = format
    self.input = input
    self.startedAt = startedAt
  }

  static func makeTranscriber(locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: [.volatileResults, .fastResults],
      attributeOptions: [.audioTimeRange])
  }

  static func start(source: String, locale: Locale, startedAt: Date) async throws
    -> SourcePipeline
  {
    let transcriber = makeTranscriber(locale: locale)
    let analyzer = SpeechAnalyzer(
      modules: [transcriber],
      options: .init(priority: .userInitiated, modelRetention: .processLifetime))
    guard
      let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
    else {
      throw HelperError("no_audio_format", "The transcriber offers no audio format.")
    }
    try await analyzer.prepareToAnalyze(in: format)
    let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
    let pipeline = SourcePipeline(
      source: source, transcriber: transcriber, analyzer: analyzer, format: format,
      input: continuation, startedAt: startedAt)
    pipeline.resultsTask = Task { await pipeline.readResults() }
    try await analyzer.start(inputSequence: stream)
    return pipeline
  }

  private func readResults() async {
    do {
      for try await result in transcriber.results {
        let raw = String(result.text.characters)
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let final = result.isFinal
        let id = lock.withLock { () -> String in
          let id = "\(source)-\(segmentIndex)"
          if final { segmentIndex += 1 }
          return id
        }
        if text.isEmpty && !final { continue }
        Output.emit([
          "type": "segment",
          "id": id,
          "source": source,
          "t0": milliseconds(wallTime(result.range.start.seconds)),
          "t1": milliseconds(wallTime(result.range.end.seconds)),
          "text": text,
          "final": final,
          "at": nowMs(),
        ])
        // After the segment, so its label never arrives first.
        if let tracker, !text.isEmpty {
          tracker.noteSegment(
            id: id, start: result.range.start.seconds, end: result.range.end.seconds,
            words: words(of: result.text, trimmedFrom: raw), length: text.utf16.count)
        }
      }
    } catch {
      Output.error("transcription_failed", error.localizedDescription, source: source)
    }
  }

  /// Where each timed run of the text starts (UTF-16 offset into the
  /// trimmed text, as JavaScript counts) and when it was said, so speaker
  /// changes inside one segment can split it.
  private func words(of text: AttributedString, trimmedFrom raw: String) -> [TimedWord] {
    let leading = raw.utf16.count
      - raw.drop(while: { $0.isWhitespace || $0.isNewline }).utf16.count
    var offset = 0
    var words: [TimedWord] = []
    for run in text.runs {
      let length = String(text[run.range].characters).utf16.count
      if let range = run.audioTimeRange {
        words.append(
          TimedWord(
            offset: max(0, offset - leading), start: range.start.seconds,
            end: range.end.seconds))
      }
      offset += length
    }
    return words
  }

  /// Called on the capture thread. The buffer may not outlive this call.
  func append(_ buffer: AVAudioPCMBuffer) {
    lock.lock()
    defer { lock.unlock() }
    if converter == nil || converter?.inputFormat != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: format)
    }
    guard let converter, buffer.frameLength > 0 else { return }
    trackPeak(buffer)
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
    var supplied = false
    var conversionError: NSError?
    let status = converter.convert(to: output, error: &conversionError) { _, outStatus in
      if supplied {
        outStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      outStatus.pointee = .haveData
      return buffer
    }
    if status == .error || output.frameLength == 0 { return }
    // After a pause, segments still carry the wall-clock time, so both
    // sources share one timeline that matches when things were said.
    let elapsed = Date().timeIntervalSince(startedAt) - Double(output.frameLength) / format.sampleRate
    if let last = offsets.last, elapsed - (nextTime + last.offset) > 1 {
      offsets.append((nextTime, elapsed - nextTime))
    }
    // Whole frames, so rounding never makes a buffer overlap the last one.
    let start = CMTime(value: nextFrame, timescale: CMTimeScale(format.sampleRate))
    nextFrame += Int64(output.frameLength)
    nextTime = Double(nextFrame) / format.sampleRate
    tracker?.append(output)
    input.yield(AnalyzerInput(buffer: output, bufferStartTime: start))
  }

  private func wallTime(_ audioTime: Double) -> Double {
    lock.withLock {
      audioTime + (offsets.last { $0.at <= audioTime }?.offset ?? 0)
    }
  }

  private func trackPeak(_ buffer: AVAudioPCMBuffer) {
    guard let channels = buffer.floatChannelData else { return }
    let frames = Int(buffer.frameLength)
    for channel in 0..<Int(buffer.format.channelCount) {
      for frame in stride(from: 0, to: frames, by: 16) {
        peak = max(peak, abs(channels[channel][frame]))
      }
    }
  }

  /// The loudest sample since the last call; 0 means silence (or no access).
  func takePeak() -> Float {
    lock.withLock {
      let value = peak
      peak = 0
      return value
    }
  }

  /// A restarted capture starts a new stream of buffers.
  func resetConverter() {
    lock.withLock { converter = nil }
  }

  func finish() async {
    input.finish()
    try? await analyzer.finalizeAndFinishThroughEndOfInput()
    await resultsTask?.value
    await tracker?.finish()
  }
}

struct HelperError: Error {
  let code: String
  let message: String
  init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }
}

/// Capture-timeline seconds as whole milliseconds.
private func milliseconds(_ seconds: Double) -> Int {
  guard seconds.isFinite else { return 0 }
  return Int((seconds * 1000).rounded())
}
