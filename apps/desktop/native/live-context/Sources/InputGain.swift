import AVFoundation

/// Slow automatic gain for what the transcriber hears. A lecturer across the
/// room reaches the microphone 20–25 dB below someone at the keyboard, and
/// SpeechTranscriber loses words on such quiet input; raising it toward
/// speech level cut word errors on far-field English lecture audio from
/// 20.6% to 14.1% with no change on close speech (bench, 2026-11).
///
/// The level follows the loudest recent audio (quick to rise, slow to fall),
/// so pauses between sentences are not pumped up; the gain never cuts and
/// boosts at most `maxGain`, and peaks are soft-limited instead of clipped.
struct InputGain {
  /// Speech RMS the gain aims for (≈ −20 dBFS).
  var target: Float = 0.1
  /// At most +20 dB, so room noise in a silent room stays quiet.
  var maxGain: Float = 10
  private(set) var level: Float = 0
  private(set) var gain: Float = 1

  /// Scales `samples` (−1…1 floats at `sampleRate`) in place.
  mutating func apply(to samples: UnsafeMutableBufferPointer<Float>, sampleRate: Double) {
    let from = gain
    advance(rms: rms(samples.lazy.map { $0 }), seconds: Double(samples.count) / sampleRate)
    ramp(samples.count, from: from) { index, g in samples[index] = limit(samples[index] * g) }
  }

  /// Scales 16-bit samples at `sampleRate` in place.
  mutating func apply(to samples: UnsafeMutableBufferPointer<Int16>, sampleRate: Double) {
    let scale: Float = 32768
    let from = gain
    advance(
      rms: rms(samples.lazy.map { Float($0) / scale }),
      seconds: Double(samples.count) / sampleRate)
    ramp(samples.count, from: from) { index, g in
      let value = limit(Float(samples[index]) / scale * g) * scale
      samples[index] = Int16(max(-32768, min(32767, value.rounded())))
    }
  }

  /// Scales a mono float or Int16 `buffer` in place; others pass unchanged.
  mutating func apply(to buffer: AVAudioPCMBuffer) {
    let frames = Int(buffer.frameLength)
    let rate = buffer.format.sampleRate
    guard frames > 0, rate > 0, buffer.format.channelCount == 1 else { return }
    if let data = buffer.floatChannelData {
      apply(to: UnsafeMutableBufferPointer(start: data[0], count: frames), sampleRate: rate)
    } else if let data = buffer.int16ChannelData {
      apply(to: UnsafeMutableBufferPointer(start: data[0], count: frames), sampleRate: rate)
    }
  }

  /// Per 100 ms: the level rises halfway to a louder input, otherwise falls
  /// 1% (≈ 7 s to halve); the gain moves a fifth of the way to its goal.
  /// Scaled by the buffer's length, so 10 ms and 85 ms buffers agree.
  private mutating func advance(rms: Float, seconds: Double) {
    let tenths = Float(seconds / 0.1)
    level =
      rms > level
      ? level + (rms - level) * (1 - pow(0.5, tenths)) : level * pow(0.99, tenths)
    let wanted = min(maxGain, max(1, target / max(level, 1e-4)))
    gain += (wanted - gain) * (1 - pow(0.8, tenths))
  }

  /// Moves from the previous gain to the new one across the buffer, so a
  /// gain change never steps mid-word.
  private func ramp(_ count: Int, from: Float, _ body: (Int, Float) -> Void) {
    guard count > 0 else { return }
    let step = (gain - from) / Float(count)
    for index in 0..<count { body(index, from + step * Float(index)) }
  }

  private func rms<S: Sequence>(_ samples: S) -> Float where S.Element == Float {
    var squares: Float = 0
    var count = 0
    for sample in samples {
      squares += sample * sample
      count += 1
    }
    return count > 0 ? (squares / Float(count)).squareRoot() : 0
  }
}

/// Passes samples below 0.7 through and bends louder ones smoothly toward 1.
func limit(_ sample: Float) -> Float {
  let magnitude = abs(sample)
  guard magnitude > 0.7 else { return sample }
  let bent = 0.7 + 0.3 * tanh((magnitude - 0.7) / 0.3)
  return sample < 0 ? -bent : bent
}
