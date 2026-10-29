import Foundation

/// Text other apps shared through the share extension waits in the app group's `Inbox`
/// folder, one file per share, until the app appends it to the inbox document.
enum Inbox {
  static func pendingFolder() -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "NyaMarkAppGroup") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent("Inbox", isDirectory: true)
  }

  /// Appends every waiting share to `target` in the order they came; the target, or nil when none waited.
  static func drain(into target: URL) throws -> URL? {
    guard let folder = pendingFolder() else { return nil }
    let pending =
      ((try? FileManager.default.contentsOfDirectory(
        at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? [])
      .filter { $0.pathExtension == "md" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    if pending.isEmpty { return nil }
    let entries = pending.compactMap { try? String(contentsOf: $0, encoding: .utf8) }
      .map { $0.trimmingCharacters(in: .newlines) }
      .filter { !$0.isEmpty }
    if !entries.isEmpty {
      try FileAccess.append(entries.joined(separator: "\n\n"), to: target)
    }
    for file in pending { try? FileManager.default.removeItem(at: file) }
    return target
  }
}
