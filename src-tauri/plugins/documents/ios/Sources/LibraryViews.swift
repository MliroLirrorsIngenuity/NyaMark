import SwiftUI
import UIKit

extension RecentDocument: Identifiable {}
extension DocumentLocation: Identifiable {}
extension FolderEntry: Identifiable {
  var id: String { path }
}

/// A file name without a Markdown extension.
func displayName(_ fileName: String) -> String {
  let ext = (fileName as NSString).pathExtension.lowercased()
  guard NativeShell.markdownExtensions.contains(ext) else { return fileName }
  return (fileName as NSString).deletingPathExtension
}

/// Today's time, or the date of an earlier day, in the app's language.
func shortDate(_ milliseconds: Double) -> String {
  let date = Date(timeIntervalSince1970: milliseconds / 1000)
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: L10n.language)
  if Calendar.current.isDateInToday(date) {
    formatter.timeStyle = .short
  } else {
    formatter.dateStyle = .medium
  }
  return formatter.string(from: date)
}

final class LibraryModel: ObservableObject {
  @Published var recents: [RecentDocument] = []
  @Published var locations: [DocumentLocation] = []
  private let queue: DispatchQueue
  private let library: Library
  private let deviceName: String

  init(queue: DispatchQueue, library: Library, deviceName: String) {
    self.queue = queue
    self.library = library
    self.deviceName = deviceName
  }

  func reload(done: (() -> Void)? = nil) {
    queue.async {
      let recents = self.library.recents()
      let locations = self.library.locations(deviceName: self.deviceName)
      DispatchQueue.main.async {
        self.recents = recents
        self.locations = locations
        done?()
      }
    }
  }

  func removeRecent(_ id: String) {
    queue.async {
      self.library.removeRecent(id: id)
      self.reload()
    }
  }

  func removeFolder(_ id: String) {
    queue.async {
      self.library.removeFolder(id: id)
      self.reload()
    }
  }

  func label(of location: DocumentLocation) -> String {
    switch location.kind {
    case "icloud": return L10n.text("icloud")
    case "local": return L10n.text("onMyDevice", location.name)
    default: return location.name
    }
  }

  /// A document at the top of a location is labelled with the location, not its folder's name.
  func folderLabel(of recent: RecentDocument) -> String? {
    guard let path = recent.path else { return recent.folder }
    let parent = (path as NSString).deletingLastPathComponent
    if let root = locations.first(where: { $0.path == parent }) { return label(of: root) }
    return recent.folder
  }

  /// Where a new document goes: iCloud Drive's NyaMark folder, else the device's.
  var defaultFolder: String? {
    locations.first(where: { $0.kind == "icloud" && $0.available })?.path
      ?? locations.first(where: { $0.kind == "local" })?.path
  }
}

final class FolderModel: ObservableObject {
  @Published var entries: [FolderEntry] = []
  @Published var query = ""
  let path: String
  private let queue: DispatchQueue

  init(path: String, queue: DispatchQueue) {
    self.path = path
    self.queue = queue
  }

  var shown: [FolderEntry] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    guard !needle.isEmpty else { return entries }
    return entries.filter { displayName($0.name).lowercased().contains(needle) }
  }

  func reload(done: (() -> Void)? = nil) {
    queue.async {
      FileAccess.list(
        URL(fileURLWithPath: self.path, isDirectory: true),
        extensions: Set(NativeShell.markdownExtensions)
      ) { result in
        let entries = (try? result.get()) ?? []
        let folders = entries.filter { $0.kind == "folder" }
          .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        let documents = entries.filter { $0.kind == "document" }
          .sorted { ($0.modifiedAt ?? 0) > ($1.modifiedAt ?? 0) }
        DispatchQueue.main.async {
          self.entries = folders + documents
          done?()
        }
      }
    }
  }
}

/// An action offered on a row by a swipe and a long press.
struct RowAction: Identifiable {
  let id = UUID()
  let title: String
  let symbol: String
  var destructive = false
  let run: () -> Void
}

/// A row of the library: the item's symbol in the accent, its name and a detail line.
private struct LibraryRow: View {
  @ObservedObject private var theme = Theme.shared
  let symbol: String
  let title: String
  var detail: String? = nil
  var dimmed = false
  var disclosure = false
  var actions: [RowAction] = []
  let tap: () -> Void

  var body: some View {
    Button(action: tap) {
      HStack(spacing: 14) {
        Image(systemName: symbol)
          .font(.title3)
          .foregroundStyle(theme.color("accent"))
          .frame(width: 30)
        VStack(alignment: .leading, spacing: 2) {
          Text(title)
            .font(.body)
            .foregroundStyle(.primary)
            .lineLimit(1)
          if let detail {
            Text(detail)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .lineLimit(2)
          }
        }
        Spacer(minLength: 0)
        if disclosure {
          Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
        }
      }
      .opacity(dimmed ? 0.5 : 1)
      .padding(.vertical, 4)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      ForEach(actions.reversed()) { action in
        Button(role: action.destructive ? .destructive : nil, action: action.run) {
          Label(action.title, systemImage: action.symbol)
        }
        .tint(action.destructive ? nil : Color(.systemGray))
      }
    }
    .contextMenu {
      ForEach(actions) { action in
        Button(role: action.destructive ? .destructive : nil, action: action.run) {
          Label(action.title, systemImage: action.symbol)
        }
      }
    }
  }
}

struct LibraryHome: View {
  @ObservedObject var model: LibraryModel
  @ObservedObject private var theme = Theme.shared
  weak var shell: NativeShell?

  var body: some View {
    List {
      Section(L10n.text("recents")) {
        if model.recents.isEmpty {
          Text(L10n.text("recentsEmpty"))
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        ForEach(model.recents) { recent in recentRow(recent) }
      }
      Section(L10n.text("locations")) {
        ForEach(model.locations) { location in locationRow(location) }
        LibraryRow(symbol: "folder.badge.plus", title: L10n.text("addFolder")) {
          shell?.pickFolder()
        }
        LibraryRow(symbol: "arrow.up.forward.square", title: L10n.text("openOther")) {
          shell?.pickDocument()
        }
      }
    }
    .listStyle(.insetGrouped)
    .tint(theme.color("accent"))
    .refreshable {
      await withCheckedContinuation { done in model.reload { done.resume() } }
    }
  }

  @ViewBuilder
  private func recentRow(_ recent: RecentDocument) -> some View {
    let name = displayName(recent.name)
    let removal = RowAction(title: L10n.text("removeRecent"), symbol: "minus.circle") {
      model.removeRecent(recent.id)
    }
    if let path = recent.path, recent.available {
      let date = shortDate(recent.openedAt)
      let folder = model.folderLabel(of: recent)
      LibraryRow(
        symbol: "doc.text", title: name, detail: folder.map { "\($0) · \(date)" } ?? date,
        actions: [
          RowAction(title: L10n.text("rename"), symbol: "pencil") {
            shell?.askToRename(path: path, current: name) { _ in model.reload() }
          },
          removal,
          RowAction(title: L10n.text("delete"), symbol: "trash", destructive: true) {
            shell?.askToDelete(path: path, name: name) { model.reload() }
          },
        ]
      ) { shell?.open(path) }
    } else {
      LibraryRow(
        symbol: "doc.text", title: name, detail: L10n.text("documentUnavailable"), dimmed: true,
        actions: [removal]
      ) {}
    }
  }

  @ViewBuilder
  private func locationRow(_ location: DocumentLocation) -> some View {
    let label = model.label(of: location)
    let symbol =
      location.kind == "icloud" ? "icloud" : location.kind == "local" ? "iphone" : "folder"
    let removal: [RowAction] =
      location.kind == "folder"
      ? [
        RowAction(title: L10n.text("removeLocation"), symbol: "minus.circle") {
          model.removeFolder(location.id)
        }
      ] : []
    if let path = location.path, location.available {
      LibraryRow(symbol: symbol, title: label, disclosure: true, actions: removal) {
        shell?.showFolder(title: label, path: path)
      }
    } else {
      LibraryRow(
        symbol: symbol, title: label,
        detail: L10n.text(location.kind == "icloud" ? "icloudUnavailable" : "folderUnavailable"),
        dimmed: true, actions: removal
      ) {}
    }
  }
}

struct FolderView: View {
  @ObservedObject var model: FolderModel
  @ObservedObject private var theme = Theme.shared
  weak var shell: NativeShell?

  var body: some View {
    List {
      if model.shown.isEmpty {
        Text(L10n.text("folderEmpty"))
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      ForEach(model.shown) { entry in entryRow(entry) }
    }
    .listStyle(.insetGrouped)
    .tint(theme.color("accent"))
    .refreshable {
      await withCheckedContinuation { done in model.reload { done.resume() } }
    }
  }

  @ViewBuilder
  private func entryRow(_ entry: FolderEntry) -> some View {
    let isFolder = entry.kind == "folder"
    let name = isFolder ? entry.name : displayName(entry.name)
    let actions = [
      RowAction(title: L10n.text("rename"), symbol: "pencil") {
        shell?.askToRename(path: entry.path, current: name) { _ in model.reload() }
      },
      RowAction(title: L10n.text("delete"), symbol: "trash", destructive: true) {
        shell?.askToDelete(path: entry.path, name: name) { model.reload() }
      },
    ]
    if isFolder {
      LibraryRow(symbol: "folder", title: name, disclosure: true, actions: actions) {
        shell?.showFolder(title: name, path: entry.path)
      }
    } else {
      let date = entry.modifiedAt.map(shortDate)
      let detail =
        entry.downloaded
        ? date : [date, L10n.text("notDownloaded")].compactMap { $0 }.joined(separator: " · ")
      LibraryRow(
        symbol: entry.downloaded ? "doc.text" : "icloud.and.arrow.down", title: name,
        detail: detail, actions: actions
      ) { shell?.open(entry.path) }
    }
  }
}
