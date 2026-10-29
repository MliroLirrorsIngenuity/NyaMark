import Foundation
import UIKit

struct FolderEntry: Encodable {
  let name: String
  let path: String
  let kind: String
  let modifiedAt: Double?
  let downloaded: Bool

  enum CodingKeys: String, CodingKey {
    case name, path, kind, modifiedAt, downloaded
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(name, forKey: .name)
    try container.encode(path, forKey: .path)
    try container.encode(kind, forKey: .kind)
    try container.encode(modifiedAt, forKey: .modifiedAt)
    try container.encode(downloaded, forKey: .downloaded)
  }
}

private func milliseconds(_ date: Date?) -> Double? {
  date.map { ($0.timeIntervalSince1970 * 1000).rounded() }
}

private func settle<T>(_ result: Result<T, Error>?, _ coordinationError: NSError?) throws -> T {
  if let coordinationError { throw Failure.from(coordinationError) }
  guard let result else { throw Failure.io("The file could not be accessed.") }
  do {
    return try result.get()
  } catch {
    throw Failure.from(error)
  }
}

/// Runs `body` while a file coordinator holds `url` for reading.
private func coordinatedRead<T>(
  _ url: URL, options: NSFileCoordinator.ReadingOptions = [], _ body: (URL) throws -> T
) throws -> T {
  var coordinationError: NSError?
  var result: Result<T, Error>?
  NSFileCoordinator(filePresenter: nil).coordinate(
    readingItemAt: url, options: options, error: &coordinationError
  ) { url in result = Result { try body(url) } }
  return try settle(result, coordinationError)
}

/// Runs `body` while a file coordinator holds `url` for writing.
private func coordinatedWrite<T>(
  _ url: URL, options: NSFileCoordinator.WritingOptions = [], _ body: (URL) throws -> T
) throws -> T {
  var coordinationError: NSError?
  var result: Result<T, Error>?
  NSFileCoordinator(filePresenter: nil).coordinate(
    writingItemAt: url, options: options, error: &coordinationError
  ) { url in result = Result { try body(url) } }
  return try settle(result, coordinationError)
}

/// Keeps a write going for the few seconds iOS grants once the app leaves the screen.
private func inBackgroundTask<T>(_ body: () throws -> T) rethrows -> T {
  var task = UIBackgroundTaskIdentifier.invalid
  DispatchQueue.main.sync {
    task = UIApplication.shared.beginBackgroundTask(withName: "NyaMark save") {
      UIApplication.shared.endBackgroundTask(task)
      task = .invalid
    }
  }
  defer {
    DispatchQueue.main.async {
      if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }
  }
  return try body()
}

enum FileAccess {
  static func read(_ url: URL, limit: UInt64) throws -> Data {
    if FileManager.default.isUbiquitousItem(at: url) {
      try? FileManager.default.startDownloadingUbiquitousItem(at: url)
    }
    return try coordinatedRead(url) { url in
      let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      if UInt64(size) > limit { throw Failure.tooLarge }
      return try Data(contentsOf: url)
    }
  }

  /// Writes the way UIDocument saves: staged beside the volume, then swapped in.
  static func write(_ data: Data, to url: URL) throws {
    try inBackgroundTask {
      try coordinatedWrite(url, options: .forReplacing) { url in
        try replaceContents(of: url, with: data)
      }
    }
  }

  private static func replaceContents(of url: URL, with data: Data) throws {
    let manager = FileManager.default
    guard manager.fileExists(atPath: url.path) else {
      try data.write(to: url, options: .withoutOverwriting)
      return
    }
    let staging = try manager.url(
      for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: url, create: true)
    defer { try? manager.removeItem(at: staging) }
    let staged = staging.appendingPathComponent(url.lastPathComponent)
    try data.write(to: staged)
    _ = try manager.replaceItemAt(url, withItemAt: staged)
  }

  /// Appends `text` as a block after what the file holds, creating it when missing.
  static func append(_ text: String, to url: URL) throws {
    try inBackgroundTask {
      try coordinatedWrite(url, options: .forMerging) { url in
        var existing = ""
        if FileManager.default.fileExists(atPath: url.path) {
          existing = try String(contentsOf: url, encoding: .utf8)
        }
        while existing.hasSuffix("\n") { existing.removeLast() }
        let joined = existing.isEmpty ? text : existing + "\n\n" + text
        try replaceContents(of: url, with: Data((joined + "\n").utf8))
      }
    }
  }

  static func createDocument(in folder: URL, baseName: String, extension ext: String) throws -> URL {
    let base = try validName(baseName)
    for number in 1...999 {
      let name = number == 1 ? "\(base).\(ext)" : "\(base) \(number).\(ext)"
      let target = folder.appendingPathComponent(name)
      if FileManager.default.fileExists(atPath: target.path) { continue }
      do {
        try coordinatedWrite(target) { url in
          try Data().write(to: url, options: .withoutOverwriting)
        }
        return target
      } catch Failure.exists {
        continue
      }
    }
    throw Failure.exists(base)
  }

  static func rename(_ item: URL, to stem: String) throws -> URL {
    let name = try validName(stem)
    let isFolder = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    let newName = isFolder || item.pathExtension.isEmpty ? name : "\(name).\(item.pathExtension)"
    let target = item.deletingLastPathComponent().appendingPathComponent(newName)
    if target.lastPathComponent == item.lastPathComponent { return item }
    let sameFile = canonicalPath(target) == canonicalPath(item)
    if !sameFile && FileManager.default.fileExists(atPath: target.path) {
      throw Failure.exists(newName)
    }
    var coordinationError: NSError?
    var moveError: Error?
    let coordinator = NSFileCoordinator(filePresenter: nil)
    coordinator.coordinate(
      writingItemAt: item, options: .forMoving, writingItemAt: target, options: .forReplacing,
      error: &coordinationError
    ) { source, destination in
      do {
        coordinator.item(at: source, willMoveTo: destination)
        try FileManager.default.moveItem(at: source, to: destination)
        coordinator.item(at: source, didMoveTo: destination)
      } catch {
        moveError = error
      }
    }
    if let coordinationError { throw Failure.from(coordinationError) }
    if let moveError { throw Failure.from(moveError) }
    return target
  }

  static func delete(_ item: URL) throws {
    try coordinatedWrite(item, options: .forDeleting) { url in
      do {
        try FileManager.default.trashItem(at: url, resultingItemURL: nil)
      } catch {
        try FileManager.default.removeItem(at: url)
      }
    }
  }

  /// The subfolders and the documents with one of `extensions` directly in `folder`.
  static func list(_ folder: URL, extensions: Set<String>, completion: @escaping (Result<[FolderEntry], Error>) -> Void) {
    let local: [FolderEntry]
    do {
      local = try listOnDisk(folder, extensions: extensions)
    } catch {
      completion(.failure(error))
      return
    }
    guard FileManager.default.isUbiquitousItem(at: folder) else {
      completion(.success(local))
      return
    }
    UbiquitousListing.documents(in: folder, extensions: extensions) { remote in
      let known = Set(local.map(\.path))
      completion(.success(local + remote.filter { !known.contains($0.path) }))
    }
  }

  private static func listOnDisk(_ folder: URL, extensions: Set<String>) throws -> [FolderEntry] {
    let keys: [URLResourceKey] = [
      .isDirectoryKey, .isPackageKey, .contentModificationDateKey,
      .ubiquitousItemDownloadingStatusKey,
    ]
    return try coordinatedRead(folder, options: .immediatelyAvailableMetadataOnly) { url in
        try FileManager.default.contentsOfDirectory(
          at: url, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]
        ).compactMap { item -> FolderEntry? in
          let values = try? item.resourceValues(forKeys: Set(keys))
          if values?.isDirectory == true && values?.isPackage != true {
            return FolderEntry(
              name: item.lastPathComponent, path: canonicalPath(item), kind: "folder",
              modifiedAt: milliseconds(values?.contentModificationDate), downloaded: true)
          }
          guard extensions.contains(item.pathExtension.lowercased()) else { return nil }
          let status = values?.ubiquitousItemDownloadingStatus
          return FolderEntry(
            name: item.lastPathComponent, path: canonicalPath(item), kind: "document",
            modifiedAt: milliseconds(values?.contentModificationDate),
            downloaded: status == nil || status != .notDownloaded)
        }
    }
  }
}

/// iCloud keeps documents it has not downloaded out of the folder's listing; Spotlight's
/// metadata query still names them.
enum UbiquitousListing {
  private static var running: [NSMetadataQuery] = []

  static func documents(
    in folder: URL, extensions: Set<String>, completion: @escaping ([FolderEntry]) -> Void
  ) {
    let folderPath = canonicalPath(folder)
    DispatchQueue.main.async {
      let query = NSMetadataQuery()
      query.searchScopes = [
        NSMetadataQueryUbiquitousDocumentsScope,
        NSMetadataQueryAccessibleUbiquitousExternalDocumentsScope,
      ]
      query.predicate = NSCompoundPredicate(
        orPredicateWithSubpredicates: extensions.map {
          NSPredicate(format: "%K ENDSWITH[c] %@", NSMetadataItemFSNameKey, ".\($0)")
        })
      var observer: NSObjectProtocol?
      var finished = false
      let finish: ([FolderEntry]) -> Void = { entries in
        if finished { return }
        finished = true
        query.stop()
        if let observer { NotificationCenter.default.removeObserver(observer) }
        running.removeAll { $0 === query }
        completion(entries)
      }
      observer = NotificationCenter.default.addObserver(
        forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main
      ) { _ in
        query.disableUpdates()
        let entries = query.results.compactMap { result -> FolderEntry? in
          guard let item = result as? NSMetadataItem,
            let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL,
            canonicalPath(url.deletingLastPathComponent()) == folderPath
          else { return nil }
          let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
          return FolderEntry(
            name: url.lastPathComponent, path: canonicalPath(url), kind: "document",
            modifiedAt: milliseconds(item.value(forAttribute: NSMetadataItemFSContentChangeDateKey) as? Date),
            downloaded: status != NSMetadataUbiquitousItemDownloadingStatusNotDownloaded)
        }
        finish(entries)
      }
      running.append(query)
      if !query.start() {
        finish([])
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { finish([]) }
    }
  }
}
