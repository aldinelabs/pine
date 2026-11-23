import Testing

@testable import pine_live_context

/// Text as the transcribers wrote it in the benchmark (2026-11).
private let englishThroughChinese =
  "Today were going talk aboutordin detlnergenerngerochnercemember thath the law surface"
private let chineseThroughEnglish =
  "Tsushi Huan Jing Shangzhou Wui Jing bushu haala, tan Shi dung lu ye"
private let englishThroughFrench =
  "we can fix those by onedday, we can ship the release on sal. Users also told us"
private let chinese = "我们今天先过一下上周的进度，然后讨论下一个版本的发布计划。"
private let mixed = "这个功能我们用 React 写的前端，后端是 Python。昨天的 pull request 还没有人 review。"
private let english =
  "Remember that the loss surface for a neural network is not convex, so there is no guarantee."

@Suite struct LanguageCheckTests {
  @Test func hearsTheOtherLanguageInDoubtfulText() {
    #expect(
      LanguageCheck.verdict(text: englishThroughChinese, confidence: 0.57, locale: "zh-CN")
        == .other("en-US"))
    #expect(
      LanguageCheck.verdict(text: englishThroughFrench, confidence: 0.81, locale: "fr-FR")
        == .other("en-US"))
    #expect(
      LanguageCheck.verdict(text: chineseThroughEnglish, confidence: 0.12, locale: "en-US")
        == .other("zh-CN"))
  }

  @Test func acceptsItsOwnLanguage() {
    #expect(LanguageCheck.verdict(text: chinese, confidence: 0.98, locale: "zh-CN") == .matches)
    #expect(LanguageCheck.verdict(text: mixed, confidence: 0.9, locale: "zh-CN") == .matches)
    #expect(LanguageCheck.verdict(text: english, confidence: 0.6, locale: "en-US") == .matches)
    // Any Chinese is Cantonese's or Taiwan Mandarin's own language too.
    #expect(LanguageCheck.verdict(text: chinese, confidence: 0.7, locale: "yue-CN") == .matches)
    #expect(LanguageCheck.verdict(text: chinese, confidence: 0.7, locale: "zh-TW") == .matches)
  }

  @Test func staysUnsureOfShortOrConfidentText() {
    #expect(LanguageCheck.verdict(text: "OK, thanks", confidence: 0.2, locale: "zh-CN") == .unsure)
    // Confident text in another script: a name or a loanword.
    #expect(LanguageCheck.verdict(text: english, confidence: 0.95, locale: "fr-FR") == .unsure)
  }

  @Test func pinyinNeedsVeryLowConfidence() {
    #expect(
      LanguageCheck.verdict(text: chineseThroughEnglish, confidence: 0.6, locale: "en-US")
        != .other("zh-CN"))
    #expect(LanguageCheck.pinyinShare(of: "Women jintian xian guo yixia") == 1)
    #expect(LanguageCheck.pinyinShare(of: english) < 0.5)
  }

  @Test func suggestsOnceAfterEnoughSpeech() {
    var check = LanguageCheck(locale: "zh-CN")
    for _ in 0..<2 {
      #expect(
        check.judge(text: englishThroughChinese, confidence: 0.6, seconds: 6, final: true) == nil)
    }
    #expect(
      check.judge(text: englishThroughChinese, confidence: 0.6, seconds: 6, final: true)
        == "en-US")
    #expect(
      check.judge(text: englishThroughChinese, confidence: 0.6, seconds: 30, final: true) == nil)
  }

  @Test func ownLanguageStartsTheCountOver() {
    var check = LanguageCheck(locale: "zh-CN")
    _ = check.judge(text: englishThroughChinese, confidence: 0.6, seconds: 10, final: true)
    _ = check.judge(text: chinese, confidence: 0.98, seconds: 3, final: true)
    #expect(
      check.judge(text: englishThroughChinese, confidence: 0.6, seconds: 10, final: true) == nil)
  }

  @Test func volatileTextCompletesButNeverAddsToTheCount() {
    var check = LanguageCheck(locale: "zh-CN")
    _ = check.judge(text: englishThroughChinese, confidence: 0.6, seconds: 10, final: true)
    // The same forming text, reported again and again, adds nothing.
    for _ in 0..<5 {
      #expect(
        check.judge(text: englishThroughChinese, confidence: nil, seconds: 3, final: false) == nil)
    }
    #expect(
      check.judge(text: englishThroughChinese, confidence: nil, seconds: 6, final: false)
        == "en-US")
  }
}
