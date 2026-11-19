// swift-tools-version: 6.0
// Benchmark-only package; never built by scripts/build-native.mjs.
// FLUIDAUDIO_PATH points at a local FluidAudio checkout (else the tag below).
import Foundation
import PackageDescription

let local = ProcessInfo.processInfo.environment["FLUIDAUDIO_PATH"]
let package = Package(
  name: "fluid-bench",
  platforms: [.macOS("15.0")],
  dependencies: [
    local.map { .package(path: $0) }
      ?? .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.18.3")
  ],
  targets: [
    .executableTarget(
      name: "fluid-bench",
      dependencies: [.product(name: "FluidAudio", package: "FluidAudio")])
  ],
  swiftLanguageModes: [.v5]
)
