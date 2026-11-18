import Foundation

/// JSON Lines on stdout: one event per line, written whole. Diagnostics go to
/// stderr so stdout stays machine-readable.
enum Output {
  private static let lock = NSLock()

  static func emit(_ event: [String: Any]) {
    guard
      let data = try? JSONSerialization.data(
        withJSONObject: event, options: [.withoutEscapingSlashes])
    else { return }
    lock.lock()
    defer { lock.unlock() }
    FileHandle.standardOutput.write(data + Data([0x0A]))
  }

  static func status(_ state: String, _ extra: [String: Any] = [:]) {
    emit(["type": "status", "state": state].merging(extra) { _, new in new })
  }

  static func error(_ code: String, _ message: String, source: String? = nil) {
    var event: [String: Any] = ["type": "error", "code": code, "message": message]
    if let source { event["source"] = source }
    emit(event)
  }

  static func log(_ message: String) {
    FileHandle.standardError.write(Data("[pine-live-context] \(message)\n".utf8))
  }
}

/// Unix time in milliseconds.
func nowMs() -> Double {
  (Date().timeIntervalSince1970 * 1000).rounded()
}
