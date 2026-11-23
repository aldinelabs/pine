import Foundation
import NaturalLanguage

/// Notices when people speak another language than the capture listens
/// for, so Pine can offer to switch. Each language's transcriber writes
/// such speech with little confidence, mostly in the speaker's own words:
/// English heard as Chinese comes out as broken English (confidence
/// 0.55–0.7), Chinese heard as English as pinyin (0.1–0.2); speech in the
/// right language scores 0.88–0.99 (bench, 2026-11).
///
/// Only a long stretch of such speech counts, and speech in the capture's
/// own language starts the count over, so a quoted phrase or a mixed
/// sentence never suggests a switch.
struct LanguageCheck {
  /// The capture's language (BCP 47).
  let locale: String
  /// Seconds of speech in one other language before suggesting it.
  var threshold: Double = 15
  private var suspect: String?
  private var seconds: Double = 0
  private(set) var suggested: String?

  init(locale: String) {
    self.locale = locale
  }

  /// What one result says about the language spoken.
  enum Verdict: Equatable {
    case matches
    case other(String)
    case unsure
  }

  /// Takes one result (volatile or final) and returns the language to
  /// suggest, once, when enough speech points to it. A final result adds to
  /// the count; a volatile one only completes it, since it is reported again.
  mutating func judge(text: String, confidence: Double?, seconds duration: Double, final: Bool)
    -> String?
  {
    guard suggested == nil else { return nil }
    switch Self.verdict(text: text, confidence: confidence, locale: locale) {
    case .matches:
      if final {
        suspect = nil
        seconds = 0
      }
      return nil
    case .unsure:
      return nil
    case .other(let other):
      let counted = suspect == other ? seconds : 0
      if final {
        suspect = other
        seconds = counted + duration
      }
      guard counted + duration >= threshold else { return nil }
      suggested = other
      return other
    }
  }

  static func verdict(text: String, confidence: Double?, locale: String) -> Verdict {
    let letters = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }
    guard letters.count >= 12 else { return .unsure }
    let own = family(of: locale)
    // Chinese with English terms in it is still Chinese.
    let han = letters.filter { $0.properties.isIdeographic }.count
    if own == "zh", Double(han) / Double(letters.count) >= 0.3 { return .matches }
    // Chinese heard by another language's transcriber: pinyin, written
    // with very little confidence.
    if own != "zh", let confidence, confidence < 0.4, pinyinShare(of: text) >= 0.5 {
      return .other("zh-CN")
    }
    let recognizer = NLLanguageRecognizer()
    recognizer.languageConstraints = Array(languages.keys)
    recognizer.processString(text)
    guard let (language, probability) = recognizer.languageHypotheses(withMaximum: 1).first
    else { return .unsure }
    let heard = languages[language] ?? ""
    if family(of: heard) == own { return probability >= 0.6 ? .matches : .unsure }
    // Words the transcriber is sure of are its own language, whatever they
    // look like (names, loanwords).
    if let confidence, confidence >= 0.9 { return .unsure }
    // Text the transcriber doubts may be garbled, so the recognizer is less
    // sure of it too: English through the Chinese transcriber scores ≈ 0.7.
    let needed = confidence.map { $0 < 0.7 } == true ? 0.6 : 0.8
    return probability >= needed ? .other(heard) : .unsure
  }

  /// The languages Pine captures, as the recognizer names them.
  private static let languages: [NLLanguage: String] = [
    .simplifiedChinese: "zh-CN", .traditionalChinese: "zh-TW", .english: "en-US",
    .japanese: "ja-JP", .korean: "ko-KR", .french: "fr-FR", .german: "de-DE",
    .spanish: "es-ES",
  ]

  /// Mandarin and Cantonese share a script, so the recognizer cannot tell
  /// them apart: any Chinese counts as the same language.
  static func family(of locale: String) -> String {
    let language = locale.split(separator: "-").first.map(String.init) ?? locale
    return language == "yue" ? "zh" : language
  }

  /// The share of words (two letters or more) made up only of pinyin
  /// syllables, as in "Women jintian xian guo yixia".
  static func pinyinShare(of text: String) -> Double {
    let words = text.lowercased().split { !$0.isLetter }.map(String.init).filter {
      $0.count >= 2 && $0.allSatisfy { $0.isASCII }
    }
    guard !words.isEmpty else { return 0 }
    return Double(words.filter(isPinyin).count) / Double(words.count)
  }

  private static func isPinyin(_ word: String) -> Bool {
    let letters = Array(word)
    var reachable = [Bool](repeating: false, count: letters.count + 1)
    reachable[0] = true
    for start in 0..<letters.count where reachable[start] {
      for length in 1...min(6, letters.count - start)
      where syllables.contains(String(letters[start..<start + length])) {
        reachable[start + length] = true
      }
    }
    return reachable[letters.count]
  }

  private static let syllables: Set<String> = {
    let initials = [
      "", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch", "sh",
      "r", "z", "c", "s", "y", "w",
    ]
    let finals = [
      "a", "o", "e", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong", "er", "i", "ia",
      "ie", "iao", "iu", "ian", "in", "iang", "ing", "iong", "u", "ua", "uo", "uai", "ui", "uan",
      "un", "uang", "ueng", "v", "ve", "ue", "van",
    ]
    // Every initial with every final is more than Mandarin has, but close
    // enough: English words still rarely split into these.
    var all = Set<String>()
    for initial in initials {
      for final in finals { all.insert(initial + final) }
    }
    return all
  }()
}
