import Foundation

struct DocumentLocation: Encodable {
  let id: String
  let kind: String
  let name: String
  let path: String?
  let available: Bool

  enum CodingKeys: String, CodingKey { case id, kind, name, path, available }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(kind, forKey: .kind)
    try container.encode(name, forKey: .name)
    try container.encode(path, forKey: .path)
    try container.encode(available, forKey: .available)
  }
}

struct RecentDocument: Encodable {
  let id: String
  let name: String
  let path: String?
  let folder: String?
  let openedAt: Double
  let available: Bool

  enum CodingKeys: String, CodingKey { case id, name, path, folder, openedAt, available }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(name, forKey: .name)
    try container.encode(path, forKey: .path)
    try container.encode(folder, forKey: .folder)
    try container.encode(openedAt, forKey: .openedAt)
    try container.encode(available, forKey: .available)
  }
}

private struct SavedItem: Codable {
  var id: String
  var bookmark: Data
  var name: String
  var folder: String?
  var openedAt: Date
}

private struct SavedLibrary: Codable {
  var recents: [SavedItem] = []
  var folders: [SavedItem] = []
  var current: String?
}

/// Recent documents, added folders and the document to reopen, kept as bookmarks so they
/// survive moves and stay reachable outside the app's own folders after a relaunch.
/// Only touched on the plugin's queue.
final class Library {
  private static let defaultsKey = "nyamark.documents.library"
  private static let recentLimit = 30

  private var saved: SavedLibrary
  /// Security-scoped URLs started this run, by canonical path; kept open while the app runs.
  private var scoped: [String: URL] = [:]
  private var ubiquityDocuments: URL??

  init() {
    if let data = UserDefaults.standard.data(forKey: Self.defaultsKey),
      let decoded = try? JSONDecoder().decode(SavedLibrary.self, from: data)
    {
      saved = decoded
    } else {
      saved = SavedLibrary()
    }
  }

  private func persist() {
    if let data = try? JSONEncoder().encode(saved) {
      UserDefaults.standard.set(data, forKey: Self.defaultsKey)
    }
  }

  /// Starts the security scope a picked or resolved URL carries, once per path.
  @discardableResult
  func access(_ url: URL) -> String {
    let path = canonicalPath(url)
    if scoped[path] == nil, url.startAccessingSecurityScopedResource() {
      scoped[path] = url
    }
    return path
  }

  private func release(_ path: String) {
    scoped.removeValue(forKey: path)?.stopAccessingSecurityScopedResource()
  }

  private func resolve(_ item: inout SavedItem) -> URL? {
    var stale = false
    guard
      let url = try? URL(
        resolvingBookmarkData: item.bookmark, options: [], relativeTo: nil,
        bookmarkDataIsStale: &stale)
    else { return nil }
    access(url)
    if stale, let refreshed = try? url.bookmarkData() {
      item.bookmark = refreshed
    }
    item.name = url.lastPathComponent
    item.folder = url.deletingLastPathComponent().lastPathComponent
    return url
  }

  // MARK: Locations

  /// iCloud Drive's NyaMark folder; nil when iCloud is off. Looked up once, off the main thread.
  func iCloudDocuments() -> URL? {
    if let known = ubiquityDocuments { return known }
    let documents = FileManager.default.url(forUbiquityContainerIdentifier: nil)?
      .appendingPathComponent("Documents", isDirectory: true)
    if let documents {
      try? FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
    }
    ubiquityDocuments = .some(documents)
    return documents
  }

  func localDocuments() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  /// Where a new document or the inbox goes when no folder was chosen.
  func primaryFolder() -> URL {
    iCloudDocuments() ?? localDocuments()
  }

  func locations(deviceName: String) -> [DocumentLocation] {
    let icloud = iCloudDocuments()
    var result = [
      DocumentLocation(
        id: "icloud", kind: "icloud", name: "", path: icloud.map(canonicalPath),
        available: icloud != nil),
      DocumentLocation(
        id: "local", kind: "local", name: deviceName, path: canonicalPath(localDocuments()),
        available: true),
    ]
    for index in saved.folders.indices {
      let url = resolve(&saved.folders[index])
      result.append(
        DocumentLocation(
          id: saved.folders[index].id, kind: "folder", name: saved.folders[index].name,
          path: url.map(canonicalPath), available: url != nil))
    }
    persist()
    return result
  }

  func addFolder(_ url: URL) throws -> DocumentLocation {
    let path = access(url)
    if let index = saved.folders.firstIndex(where: { item in
      var item = item
      return resolve(&item).map(canonicalPath) == path
    }) {
      let item = saved.folders[index]
      return DocumentLocation(id: item.id, kind: "folder", name: item.name, path: path, available: true)
    }
    let item = SavedItem(
      id: UUID().uuidString, bookmark: try url.bookmarkData(), name: url.lastPathComponent,
      folder: nil, openedAt: Date())
    saved.folders.append(item)
    persist()
    return DocumentLocation(id: item.id, kind: "folder", name: item.name, path: path, available: true)
  }

  func removeFolder(id: String) {
    guard let index = saved.folders.firstIndex(where: { $0.id == id }) else { return }
    var item = saved.folders.remove(at: index)
    if let url = resolve(&item) { release(canonicalPath(url)) }
    persist()
  }

  // MARK: Recents

  func recents() -> [RecentDocument] {
    var result: [RecentDocument] = []
    // A bookmark follows its file into the trash; such a document is gone for the user.
    saved.recents.removeAll { item in
      var item = item
      return resolve(&item)?.pathComponents.contains(".Trash") == true
    }
    for index in saved.recents.indices {
      let url = resolve(&saved.recents[index])
      let item = saved.recents[index]
      result.append(
        RecentDocument(
          id: item.id, name: item.name, path: url.map(canonicalPath), folder: item.folder,
          openedAt: (item.openedAt.timeIntervalSince1970 * 1000).rounded(), available: url != nil))
    }
    persist()
    return result
  }

  private func recentIndex(of path: String) -> Int? {
    saved.recents.firstIndex { item in
      var item = item
      return resolve(&item).map(canonicalPath) == path
    }
  }

  /// Puts the document first among the recent ones and makes it the one reopened at launch.
  func noteOpened(_ url: URL) throws {
    let path = access(url)
    var item: SavedItem
    if let index = recentIndex(of: path) {
      item = saved.recents.remove(at: index)
    } else {
      item = SavedItem(
        id: UUID().uuidString, bookmark: try url.bookmarkData(), name: url.lastPathComponent,
        folder: url.deletingLastPathComponent().lastPathComponent, openedAt: Date())
    }
    item.openedAt = Date()
    saved.recents.insert(item, at: 0)
    if saved.recents.count > Self.recentLimit {
      saved.recents.removeLast(saved.recents.count - Self.recentLimit)
    }
    saved.current = item.id
    persist()
  }

  func removeRecent(id: String) {
    saved.recents.removeAll { $0.id == id }
    if saved.current == id { saved.current = nil }
    persist()
  }

  /// The recent documents at `path`; taken before the file moves, since their bookmarks move with it. */
  func recentIDs(at path: String) -> Set<String> {
    Set(saved.recents.filter { item in
      var item = item
      return resolve(&item).map(canonicalPath) == path
    }.map(\.id))
  }

  func forget(ids: Set<String>) {
    saved.recents.removeAll { ids.contains($0.id) }
    if let current = saved.current, ids.contains(current) { saved.current = nil }
    persist()
  }

  func setCurrent(path: String?) throws {
    guard let path else {
      saved.current = nil
      persist()
      return
    }
    if let index = recentIndex(of: path) {
      saved.current = saved.recents[index].id
      persist()
    } else {
      try noteOpened(URL(fileURLWithPath: path))
    }
  }

  func current() -> String? {
    guard let id = saved.current, let index = saved.recents.firstIndex(where: { $0.id == id })
    else { return nil }
    let url = resolve(&saved.recents[index])
    persist()
    return url.map(canonicalPath)
  }
}
