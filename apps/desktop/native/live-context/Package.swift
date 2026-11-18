// swift-tools-version: 6.0
// The Live Context helper: captures the microphone and system audio and
// transcribes them on device. Built by scripts/build-native.mjs, which also
// embeds Info.plist so a standalone run can ask for access.
import PackageDescription

let package = Package(
  name: "pine-live-context",
  platforms: [.macOS("26.0")],
  targets: [
    // Opens sherpa-onnx with dlopen for optional speaker diarization; the
    // helper never links it.
    .target(name: "CSherpaOnnx", path: "CSherpaOnnx"),
    .executableTarget(
      name: "pine-live-context", dependencies: ["CSherpaOnnx"], path: "Sources"),
  ],
  swiftLanguageModes: [.v5]
)
