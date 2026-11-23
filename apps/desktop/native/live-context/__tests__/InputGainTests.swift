import Foundation
import Testing

@testable import pine_live_context

/// One 100 ms mono buffer at 16 kHz: a 440 Hz tone at `amplitude`.
private func tone(_ amplitude: Float, frames: Int = 1600) -> [Float] {
  let step = 2 * Float.pi * 440 / 16000
  return (0..<frames).map { amplitude * sin(Float($0) * step) }
}

private func rms(_ samples: [Float]) -> Float {
  (samples.reduce(0) { $0 + $1 * $1 } / Float(samples.count)).squareRoot()
}

private func feed(_ gain: inout InputGain, _ samples: [Float], sampleRate: Double = 16000)
  -> [Float]
{
  var copy = samples
  copy.withUnsafeMutableBufferPointer { gain.apply(to: $0, sampleRate: sampleRate) }
  return copy
}

@Suite struct InputGainTests {
  @Test func raisesQuietSpeechTowardTheTarget() {
    var gain = InputGain()
    var out: [Float] = []
    // A far-off speaker, ≈ −32 dBFS RMS, for three seconds.
    for _ in 0..<30 { out = feed(&gain, tone(0.035)) }
    #expect(rms(out) > 0.08)
    #expect(rms(out) < 0.12)
  }

  @Test func neverBoostsMoreThanTwentyDecibels() {
    var gain = InputGain()
    for _ in 0..<100 { _ = feed(&gain, tone(0.001)) }
    #expect(gain.gain <= 10.0001)
  }

  @Test func leavesLoudSpeechAlone() {
    var gain = InputGain()
    let input = tone(0.3)
    var out: [Float] = []
    for _ in 0..<20 { out = feed(&gain, input) }
    #expect(gain.gain == 1)
    #expect(out == input)
  }

  @Test func doesNotPumpUpShortPauses() {
    var gain = InputGain()
    for _ in 0..<30 { _ = feed(&gain, tone(0.05)) }
    let speaking = gain.gain
    // Half a second between sentences barely moves the gain.
    for _ in 0..<5 { _ = feed(&gain, tone(0.0005)) }
    #expect(gain.gain < speaking * 1.1)
  }

  @Test func buffersOfDifferentLengthsAgree() {
    var short = InputGain()
    var long = InputGain()
    for _ in 0..<300 { _ = feed(&short, tone(0.03, frames: 160)) }
    for _ in 0..<30 { _ = feed(&long, tone(0.03)) }
    #expect(abs(short.gain - long.gain) / long.gain < 0.1)
  }

  @Test func softLimitsInsteadOfClipping() {
    #expect(limit(0.5) == 0.5)
    #expect(limit(-0.5) == -0.5)
    #expect(limit(3) < 1)
    #expect(limit(3) > 0.9)
    #expect(limit(-3) == -limit(3))
    #expect(limit(0.8) < 0.8)
  }

  @Test func scalesInt16Samples() {
    var gain = InputGain()
    var samples = tone(0.02).map { Int16($0 * 32767) }
    for _ in 0..<30 {
      samples = tone(0.02).map { Int16($0 * 32767) }
      samples.withUnsafeMutableBufferPointer { gain.apply(to: $0, sampleRate: 16000) }
    }
    #expect(rms(samples.map { Float($0) / 32768 }) > 0.08)
  }
}
