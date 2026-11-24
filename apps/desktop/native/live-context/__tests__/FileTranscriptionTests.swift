import Testing

@testable import pine_live_context

@Suite struct FileTranscriptionTests {
  @Test func joinsFinalResultsAndWeighsConfidenceByLength() {
    let transcript = FileTranscript(
      parts: [("帮我看一下", 0.9, 5), ("今天的测试结果。 ", 0.6, 9), ("", nil, 0)], locale: "zh-CN")
    #expect(transcript.text == "帮我看一下今天的测试结果。")
    #expect(abs((transcript.confidence ?? 0) - (0.9 * 5 + 0.6 * 9) / 14) < 0.0001)
    #expect(FileTranscript(parts: [], locale: "en-US").confidence == nil)
  }

  @Test func prefersTheSurerRetryWithText() {
    let first = FileTranscript(text: "Bang wo kan yixia", locale: "en-US", confidence: 0.2)
    let retry = FileTranscript(text: "帮我看一下", locale: "zh-CN", confidence: 0.95)
    #expect(FileTranscript.prefers(retry, over: first))
    #expect(!FileTranscript.prefers(first, over: retry))
    let empty = FileTranscript(text: "", locale: "en-US", confidence: nil)
    #expect(FileTranscript.prefers(retry, over: empty))
    #expect(!FileTranscript.prefers(empty, over: first))
  }

  @Test func retriesAnotherLanguageOnlyWhenTheTextPointsThere() {
    let pinyin = FileTranscript(
      text: "Tsushi Huan Jing Shangzhou Wui Jing bushu haala, tan Shi dung lu ye", locale: "en-US",
      confidence: 0.12)
    #expect(FileTranscription.otherLanguage(of: pinyin) == "zh-CN")
    let chinese = FileTranscript(
      text: "我们今天先过一下上周的进度，然后讨论下一个版本的发布计划。", locale: "zh-CN", confidence: 0.95)
    #expect(FileTranscription.otherLanguage(of: chinese) == nil)
  }

  @Test func fallsBackBetweenChineseAndEnglishAfterSilence() {
    #expect(FileTranscription.fallbackLanguage(after: "en-US") == "zh-CN")
    #expect(FileTranscription.fallbackLanguage(after: "ja-JP") == "zh-CN")
    #expect(FileTranscription.fallbackLanguage(after: "zh-CN") == "en-US")
    #expect(FileTranscription.fallbackLanguage(after: "yue-CN") == "en-US")
  }
}
