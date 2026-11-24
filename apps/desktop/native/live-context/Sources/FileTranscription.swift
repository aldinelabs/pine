import AVFoundation
import Foundation
import Speech

/// One recording transcribed whole, then the process exits: Pine runs
/// `--transcribe x.wav --locale zh-CN` for a WeChat voice message that came
/// without the server's transcript. It prints one
/// `{"type":"transcript","text":…,"locale":…}` or one error, apart from the
/// `ready` line and any `downloading` status while assets install.
///
/// The language is the one Pine asks for; when the text reads as another of
/// Pine's capture languages, that language gets one more try and the surer
/// text wins. A transcriber that hears another language may also write
/// nothing (English hearing Chinese through WeChat's narrow-band codec):
/// then Chinese, or English for a Chinese first try, gets that one try.
enum FileTranscription {
  static func run(path: String, localeIdentifier: String) async -> Int32 {
    guard SpeechTranscriber.isAvailable else {
      Output.error("unavailable", "On-device transcription is not available on this Mac.")
      return 1
    }
    guard
      let locale = await SpeechTranscriber.supportedLocale(
        equivalentTo: Locale(identifier: localeIdentifier))
    else {
      Output.error("unsupported_locale", "Transcription does not support \(localeIdentifier).")
      return 1
    }
    let url = URL(fileURLWithPath: path)
    do {
      var best = try await transcribe(url: url, locale: locale)
      if let other = best.text.isEmpty
        ? fallbackLanguage(after: best.locale) : otherLanguage(of: best),
        let alternate = await SpeechTranscriber.supportedLocale(
          equivalentTo: Locale(identifier: other)),
        let retry = try? await transcribe(url: url, locale: alternate),
        FileTranscript.prefers(retry, over: best)
      {
        best = retry
      }
      var event: [String: Any] = ["type": "transcript", "text": best.text, "locale": best.locale]
      if let confidence = best.confidence {
        event["confidence"] = NSDecimalNumber(string: String(format: "%.2f", confidence))
      }
      Output.emit(event)
      return 0
    } catch let error as HelperError {
      Output.error(error.code, error.message)
    } catch {
      Output.error("transcription_failed", error.localizedDescription)
    }
    return 1
  }

  /// The capture language the text points to, if not its own.
  static func otherLanguage(of transcript: FileTranscript) -> String? {
    guard
      case .other(let other) = LanguageCheck.verdict(
        text: transcript.text, confidence: transcript.confidence, locale: transcript.locale),
      LanguageCheck.family(of: other) != LanguageCheck.family(of: transcript.locale)
    else { return nil }
    return other
  }

  /// The second try after a first one that heard nothing.
  static func fallbackLanguage(after locale: String) -> String {
    LanguageCheck.family(of: locale) == "zh" ? "en-US" : "zh-CN"
  }

  private static func transcribe(url: URL, locale: Locale) async throws -> FileTranscript {
    let transcriber = SpeechTranscriber(
      locale: locale, transcriptionOptions: [], reportingOptions: [],
      attributeOptions: [.transcriptionConfidence])
    try await installTranscriptionAssets(for: transcriber)
    let file: AVAudioFile
    do {
      file = try AVAudioFile(forReading: url)
    } catch {
      throw HelperError("unreadable_audio", "The recording could not be read.")
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let collected = Task { () throws -> [(String, Double?, Int)] in
      var parts: [(String, Double?, Int)] = []
      for try await result in transcriber.results where result.isFinal {
        let text = String(result.text.characters)
        parts.append((text, transcriptConfidence(of: result.text), text.count))
      }
      return parts
    }
    if let end = try await analyzer.analyzeSequence(from: file) {
      try await analyzer.finalizeAndFinish(through: end)
    } else {
      await analyzer.cancelAndFinishNow()
    }
    return FileTranscript(parts: try await collected.value, locale: locale.identifier(.bcp47))
  }
}

/// A whole recording's text and how sure the transcriber was of it.
struct FileTranscript: Equatable {
  var text: String
  var locale: String
  var confidence: Double?

  init(text: String, locale: String, confidence: Double?) {
    self.text = text
    self.locale = locale
    self.confidence = confidence
  }

  /// Final results in order: text joined, confidence weighted by length.
  init(parts: [(text: String, confidence: Double?, length: Int)], locale: String) {
    var text = ""
    var weighted = 0.0
    var counted = 0
    for part in parts {
      text += part.text
      if let confidence = part.confidence, part.length > 0 {
        weighted += confidence * Double(part.length)
        counted += part.length
      }
    }
    self.init(
      text: text.trimmingCharacters(in: .whitespacesAndNewlines), locale: locale,
      confidence: counted > 0 ? weighted / Double(counted) : nil)
  }

  /// Whether a retry in another language is the better reading: it has
  /// text, and the transcriber was surer of it.
  static func prefers(_ retry: FileTranscript, over first: FileTranscript) -> Bool {
    guard !retry.text.isEmpty else { return false }
    if first.text.isEmpty { return true }
    return (retry.confidence ?? 0) > (first.confidence ?? 0)
  }
}

/// How sure the transcriber is of the text: its runs' confidence, by length.
func transcriptConfidence(of text: AttributedString) -> Double? {
  var weighted = 0.0
  var total = 0
  for run in text.runs {
    guard let value = run.transcriptionConfidence else { continue }
    let length = text[run.range].characters.count
    weighted += value * Double(length)
    total += length
  }
  return total > 0 ? weighted / Double(total) : nil
}

/// Installs the transcriber's language assets when missing, reporting
/// `downloading` progress once a second.
func installTranscriptionAssets(for transcriber: SpeechTranscriber) async throws {
  guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
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
