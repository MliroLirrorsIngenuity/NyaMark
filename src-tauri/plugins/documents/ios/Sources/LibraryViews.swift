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
}

final class FolderModel: NSObject, ObservableObject, UISearchResultsUpdating {
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

  func updateSearchResults(for searchController: UISearchController) {
    query = searchController.searchBar.text ?? ""
  }
}

private struct Row: View {
  let symbol: String
  let title: String
  let detail: String?
  var dimmed = false
  var disclosure = false

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: symbol)
        .font(.system(size: 20))
        .foregroundStyle(dimmed ? Color.secondary : Color.accentColor)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .foregroundStyle(dimmed ? Color.secondary : Color.primary)
          .lineLimit(1)
        if let detail {
          Text(detail)
            .font(.footnote)
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
    .contentShape(Rectangle())
  }
}

struct LibraryHome: View {
  @ObservedObject var model: LibraryModel
  weak var shell: NativeShell?

  var body: some View {
    List {
      Section(L10n.text("recents")) {
        if model.recents.isEmpty {
          Text(L10n.text("recentsEmpty")).foregroundStyle(.secondary)
        }
        ForEach(model.recents) { recent in
          recentRow(recent)
        }
      }
      Section(L10n.text("locations")) {
        ForEach(model.locations) { location in
          locationRow(location)
        }
        Button {
          shell?.pickFolder()
        } label: {
          Row(symbol: "folder.badge.plus", title: L10n.text("addFolder"), detail: nil)
        }
        Button {
          shell?.pickDocument()
        } label: {
          Row(symbol: "arrow.up.forward.square", title: L10n.text("openOther"), detail: nil)
        }
      }
    }
    .listStyle(.insetGrouped)
    .refreshable {
      await withCheckedContinuation { done in model.reload { done.resume() } }
    }
  }

  @ViewBuilder
  private func recentRow(_ recent: RecentDocument) -> some View {
    let name = displayName(recent.name)
    if let path = recent.path, recent.available {
      let date = shortDate(recent.openedAt)
      let folder = model.folderLabel(of: recent)
      Button {
        shell?.open(path)
      } label: {
        Row(symbol: "doc.text", title: name, detail: folder.map { "\($0) · \(date)" } ?? date)
      }
      .swipeActions {
        Button(role: .destructive) {
          shell?.askToDelete(path: path, name: name) { model.reload() }
        } label: {
          Label(L10n.text("delete"), systemImage: "trash")
        }
        Button {
          model.removeRecent(recent.id)
        } label: {
          Label(L10n.text("removeRecent"), systemImage: "clock.badge.xmark")
        }
      }
      .contextMenu {
        Button {
          shell?.askToRename(path: path, current: name) { _ in model.reload() }
        } label: {
          Label(L10n.text("rename"), systemImage: "pencil")
        }
        Button {
          model.removeRecent(recent.id)
        } label: {
          Label(L10n.text("removeRecent"), systemImage: "clock.badge.xmark")
        }
        Button(role: .destructive) {
          shell?.askToDelete(path: path, name: name) { model.reload() }
        } label: {
          Label(L10n.text("delete"), systemImage: "trash")
        }
      }
    } else {
      Row(symbol: "doc.text", title: name, detail: L10n.text("documentUnavailable"), dimmed: true)
        .swipeActions {
          Button(role: .destructive) {
            model.removeRecent(recent.id)
          } label: {
            Label(L10n.text("removeRecent"), systemImage: "clock.badge.xmark")
          }
        }
    }
  }

  @ViewBuilder
  private func locationRow(_ location: DocumentLocation) -> some View {
    let label = model.label(of: location)
    let symbol =
      location.kind == "icloud" ? "icloud" : location.kind == "local" ? "iphone" : "folder"
    if let path = location.path, location.available {
      Button {
        shell?.showFolder(title: label, path: path)
      } label: {
        Row(symbol: symbol, title: label, detail: nil, disclosure: true)
      }
      .swipeActions {
        if location.kind == "folder" {
          Button(role: .destructive) {
            model.removeFolder(location.id)
          } label: {
            Label(L10n.text("removeLocation"), systemImage: "minus.circle")
          }
        }
      }
    } else {
      Row(
        symbol: symbol, title: label,
        detail: L10n.text(location.kind == "icloud" ? "icloudUnavailable" : "folderUnavailable"),
        dimmed: true)
    }
  }
}

struct FolderView: View {
  @ObservedObject var model: FolderModel
  weak var shell: NativeShell?

  var body: some View {
    List {
      if model.shown.isEmpty {
        Text(L10n.text("folderEmpty")).foregroundStyle(.secondary)
      }
      ForEach(model.shown) { entry in
        entryRow(entry)
      }
    }
    .listStyle(.insetGrouped)
    .refreshable {
      await withCheckedContinuation { done in model.reload { done.resume() } }
    }
  }

  @ViewBuilder
  private func entryRow(_ entry: FolderEntry) -> some View {
    let name = entry.kind == "folder" ? entry.name : displayName(entry.name)
    Button {
      if entry.kind == "folder" {
        shell?.showFolder(title: name, path: entry.path)
      } else {
        shell?.open(entry.path)
      }
    } label: {
      if entry.kind == "folder" {
        Row(symbol: "folder", title: name, detail: nil, disclosure: true)
      } else {
        let date = entry.modifiedAt.map(shortDate)
        let detail = entry.downloaded ? date : [date, L10n.text("notDownloaded")].compactMap { $0 }
          .joined(separator: " · ")
        Row(symbol: entry.downloaded ? "doc.text" : "icloud.and.arrow.down", title: name, detail: detail)
      }
    }
    .swipeActions {
      Button(role: .destructive) {
        shell?.askToDelete(path: entry.path, name: name) { model.reload() }
      } label: {
        Label(L10n.text("delete"), systemImage: "trash")
      }
      Button {
        shell?.askToRename(path: entry.path, current: name) { _ in model.reload() }
      } label: {
        Label(L10n.text("rename"), systemImage: "pencil")
      }
    }
    .contextMenu {
      Button {
        shell?.askToRename(path: entry.path, current: name) { _ in model.reload() }
      } label: {
        Label(L10n.text("rename"), systemImage: "pencil")
      }
      Button(role: .destructive) {
        shell?.askToDelete(path: entry.path, name: name) { model.reload() }
      } label: {
        Label(L10n.text("delete"), systemImage: "trash")
      }
    }
  }
}
