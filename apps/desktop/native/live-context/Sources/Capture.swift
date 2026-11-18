import AVFoundation
import CoreAudio
import Foundation

protocol AudioCapture: AnyObject {
  func start(_ onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws
  func stop()
}

/// The default input device through AVAudioEngine.
final class MicrophoneCapture: AudioCapture {
  private var engine: AVAudioEngine?

  func start(_ onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw HelperError("no_microphone", "No microphone is available.")
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
      onBuffer(buffer)
    }
    engine.prepare()
    try engine.start()
    self.engine = engine
  }

  func stop() {
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
  }

  static func authorization() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "undetermined"
    @unknown default: return "undetermined"
    }
  }

  static func requestAccess() async -> Bool {
    await AVCaptureDevice.requestAccess(for: .audio)
  }
}

/// Everything the Mac plays, through a Core Audio process tap (macOS 14.2+).
/// Unlike ScreenCaptureKit it needs only the "System Audio Recording Only"
/// permission, not Screen Recording. macOS offers no way to read that
/// permission: until it is granted the tap delivers silence.
final class SystemAudioCapture: AudioCapture {
  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var aggregateID = AudioObjectID(kAudioObjectUnknown)
  private var procID: AudioDeviceIOProcID?
  private let queue = DispatchQueue(label: "pine.live-context.system-audio", qos: .userInitiated)

  func start(_ onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
    let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    description.uuid = UUID()
    description.name = "Pine Live Context"
    description.isPrivate = true
    description.muteBehavior = .unmuted
    try check(AudioHardwareCreateProcessTap(description, &tapID), "create the audio tap")

    var streamDescription = AudioStreamBasicDescription()
    try getProperty(tapID, kAudioTapPropertyFormat, &streamDescription)
    guard let format = AVAudioFormat(streamDescription: &streamDescription) else {
      throw HelperError("system_audio_failed", "The audio tap has an unknown format.")
    }

    var outputID = AudioObjectID(kAudioObjectUnknown)
    try getProperty(
      AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice,
      &outputID)
    var outputUID: CFString = "" as CFString
    try getProperty(outputID, kAudioDevicePropertyDeviceUID, &outputUID)

    let aggregate: [String: Any] = [
      kAudioAggregateDeviceNameKey: "Pine Live Context",
      kAudioAggregateDeviceUIDKey: UUID().uuidString,
      kAudioAggregateDeviceMainSubDeviceKey: outputUID as String,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID as String]],
      kAudioAggregateDeviceTapListKey: [
        [
          kAudioSubTapDriftCompensationKey: true,
          kAudioSubTapUIDKey: description.uuid.uuidString,
        ]
      ],
    ]
    try check(
      AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID),
      "create the aggregate device")
    try check(
      AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { _, input, _, _, _ in
        guard
          let buffer = AVAudioPCMBuffer(
            pcmFormat: format, bufferListNoCopy: input, deallocator: nil)
        else { return }
        onBuffer(buffer)
      }, "attach to the aggregate device")
    try check(AudioDeviceStart(aggregateID, procID), "start the system audio capture")
  }

  func stop() {
    if aggregateID != kAudioObjectUnknown {
      if let procID {
        AudioDeviceStop(aggregateID, procID)
        AudioDeviceDestroyIOProcID(aggregateID, procID)
      }
      AudioHardwareDestroyAggregateDevice(aggregateID)
    }
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
    procID = nil
    aggregateID = AudioObjectID(kAudioObjectUnknown)
    tapID = AudioObjectID(kAudioObjectUnknown)
  }

  private func check(_ status: OSStatus, _ action: String) throws {
    guard status == noErr else {
      throw HelperError("system_audio_failed", "Could not \(action) (OSStatus \(status)).")
    }
  }

  private func getProperty<T>(
    _ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ value: inout T
  ) throws {
    var address = AudioObjectPropertyAddress(
      mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size)
    try check(
      withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
      }, "read an audio property")
  }
}
