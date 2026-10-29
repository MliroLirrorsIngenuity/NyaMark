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

/// A gradient page as the app's background draws it.
struct PageBackground: View {
  @ObservedObject private var theme = Theme.shared

  var body: some View {
    LinearGradient(
      colors: [theme.color("app-bg-start"), theme.color("app-bg-end")], startPoint: .top,
      endPoint: .bottom
    )
    .ignoresSafeArea()
  }
}

private struct SectionTitle: View {
  @ObservedObject private var theme = Theme.shared
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.color("text-secondary"))
      .padding(.horizontal, 18)
      .padding(.top, 18)
      .padding(.bottom, 8)
  }
}

/// A card row: the main button, and a trailing ⋯ or chevron.
private struct LibraryRow: View {
  @ObservedObject private var theme = Theme.shared
  let label: RowLabel
  var disclosure = false
  var actions: [SheetAction] = []
  var actionTitle: String? = nil
  let shell: NativeShell?
  let tap: () -> Void

  var body: some View {
    HStack(spacing: 0) {
      Button(action: tap) { label }
        .buttonStyle(RowStyle())
      if !actions.isEmpty {
        Button {
          shell?.showActions(title: actionTitle, actions)
        } label: {
          Image(systemName: "ellipsis")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(theme.color("text-secondary"))
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowStyle())
        .clipShape(Circle())
        .padding(.trailing, 6)
        .accessibilityLabel(L10n.text("more"))
      } else if disclosure {
        Image(systemName: "chevron.right")
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(theme.color("text-muted"))
          .padding(.trailing, 18)
          .allowsHitTesting(false)
      }
    }
    .contextMenu {
      ForEach(actions) { action in
        if action.destructive {
          Button(role: .destructive, action: action.run) { Text(action.title) }
        } else {
          Button(action: action.run) { Text(action.title) }
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
    ZStack {
      PageBackground()
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          HStack {
            Spacer()
            CircleButton(
              symbol: "plus", label: L10n.text("newDocument"), disabled: model.defaultFolder == nil
            ) {
              if let folder = model.defaultFolder { shell?.create(in: folder) }
            }
          }
          .frame(minHeight: 56)
          Text(L10n.text("documents"))
            .font(.system(size: 34, weight: .bold))
            .foregroundStyle(theme.color("text-primary"))
            .padding(.horizontal, 4)
            .padding(.bottom, 10)
          SectionTitle(text: L10n.text("recents"))
          if model.recents.isEmpty {
            Text(L10n.text("recentsEmpty"))
              .font(.system(size: 15))
              .foregroundStyle(theme.color("text-secondary"))
              .padding(.horizontal, 18)
              .padding(.vertical, 4)
          } else {
            Card {
              ForEach(Array(model.recents.enumerated()), id: \.element.id) { index, recent in
                if index > 0 { Hairline() }
                recentRow(recent)
              }
            }
          }
          SectionTitle(text: L10n.text("locations"))
          Card {
            ForEach(model.locations) { location in
              locationRow(location)
              Hairline()
            }
            LibraryRow(
              label: RowLabel(symbol: "folder.badge.plus", title: L10n.text("addFolder")),
              shell: shell
            ) { shell?.pickFolder() }
            Hairline()
            LibraryRow(
              label: RowLabel(symbol: "arrow.up.forward.square", title: L10n.text("openOther")),
              shell: shell
            ) { shell?.pickDocument() }
          }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
      }
      .refreshable {
        await withCheckedContinuation { done in model.reload { done.resume() } }
      }
    }
  }

  @ViewBuilder
  private func recentRow(_ recent: RecentDocument) -> some View {
    let name = displayName(recent.name)
    let removal = SheetAction(title: L10n.text("removeRecent")) { model.removeRecent(recent.id) }
    if let path = recent.path, recent.available {
      let date = shortDate(recent.openedAt)
      let folder = model.folderLabel(of: recent)
      LibraryRow(
        label: RowLabel(
          symbol: "doc", title: name, detail: folder.map { "\($0) · \(date)" } ?? date,
        ),
        actions: [
          SheetAction(title: L10n.text("rename") + "…") {
            shell?.askToRename(path: path, current: name) { _ in model.reload() }
          },
          SheetAction(title: L10n.text("delete"), destructive: true) {
            shell?.askToDelete(path: path, name: name) { model.reload() }
          },
          removal,
        ], actionTitle: name, shell: shell
      ) { shell?.open(path) }
    } else {
      LibraryRow(
        label: RowLabel(
          symbol: "doc", title: name, detail: L10n.text("documentUnavailable"), dimmed: true),
        actions: [removal], actionTitle: name, shell: shell
      ) { shell?.showActions(title: name, [removal]) }
    }
  }

  @ViewBuilder
  private func locationRow(_ location: DocumentLocation) -> some View {
    let label = model.label(of: location)
    let symbol =
      location.kind == "icloud" ? "icloud" : location.kind == "local" ? "iphone" : "folder"
    let removal: [SheetAction] =
      location.kind == "folder"
      ? [SheetAction(title: L10n.text("removeLocation")) { model.removeFolder(location.id) }] : []
    if let path = location.path, location.available {
      LibraryRow(
        label: RowLabel(symbol: symbol, title: label), disclosure: true, actions: removal,
        actionTitle: label, shell: shell
      ) { shell?.showFolder(title: label, path: path) }
    } else {
      LibraryRow(
        label: RowLabel(
          symbol: symbol, title: label,
          detail: L10n.text(location.kind == "icloud" ? "icloudUnavailable" : "folderUnavailable"),
          dimmed: true),
        actions: removal, actionTitle: label, shell: shell
      ) {}
    }
  }
}

struct FolderView: View {
  @ObservedObject var model: FolderModel
  @ObservedObject private var theme = Theme.shared
  let title: String
  weak var shell: NativeShell?

  var body: some View {
    ZStack {
      PageBackground()
      VStack(spacing: 0) {
        ZStack {
          Text(title)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(theme.color("text-primary"))
            .lineLimit(1)
            .padding(.horizontal, 60)
          HStack {
            CircleButton(symbol: "chevron.left", label: L10n.text("back")) { shell?.goBack() }
            Spacer()
            CircleButton(symbol: "plus", label: L10n.text("newDocument")) {
              shell?.create(in: model.path)
            }
          }
        }
        .frame(minHeight: 56)
        .padding(.horizontal, 16)
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            TextField(L10n.text("search"), text: $model.query)
              .padding(.horizontal, 14)
              .frame(height: 44)
              .background(
                RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                  .fill(theme.color("fill-soft")))
              .overlay(
                RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                  .stroke(theme.color("border-soft"), lineWidth: 1))
              .padding(.bottom, 16)
            if model.shown.isEmpty {
              Text(L10n.text("folderEmpty"))
                .font(.system(size: 15))
                .foregroundStyle(theme.color("text-secondary"))
                .padding(.horizontal, 18)
            } else {
              Card {
                ForEach(Array(model.shown.enumerated()), id: \.element.id) { index, entry in
                  if index > 0 { Hairline() }
                  entryRow(entry)
                }
              }
            }
          }
          .padding(.horizontal, 16)
          .padding(.bottom, 24)
        }
        .refreshable {
          await withCheckedContinuation { done in model.reload { done.resume() } }
        }
      }
    }
  }

  @ViewBuilder
  private func entryRow(_ entry: FolderEntry) -> some View {
    let isFolder = entry.kind == "folder"
    let name = isFolder ? entry.name : displayName(entry.name)
    let actions = [
      SheetAction(title: L10n.text("rename") + "…") {
        shell?.askToRename(path: entry.path, current: name) { _ in model.reload() }
      },
      SheetAction(title: L10n.text("delete"), destructive: true) {
        shell?.askToDelete(path: entry.path, name: name) { model.reload() }
      },
    ]
    if isFolder {
      LibraryRow(
        label: RowLabel(symbol: "folder", title: name), actions: actions, actionTitle: name,
        shell: shell
      ) { shell?.showFolder(title: name, path: entry.path) }
    } else {
      let date = entry.modifiedAt.map(shortDate)
      let detail =
        entry.downloaded
        ? date : [date, L10n.text("notDownloaded")].compactMap { $0 }.joined(separator: " · ")
      LibraryRow(
        label: RowLabel(symbol: entry.downloaded ? "doc" : "icloud.and.arrow.down", title: name, detail: detail),
        actions: actions, actionTitle: name, shell: shell
      ) { shell?.open(entry.path) }
    }
  }
}
