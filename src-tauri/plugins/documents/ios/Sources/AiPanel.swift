import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A JSON object from the page, read without trapping on a field that is missing.
struct AiJSON {
  let raw: [String: Any]

  init(_ raw: [String: Any]) {
    self.raw = raw
  }

  func text(_ key: String) -> String { raw[key] as? String ?? "" }
  func optionalText(_ key: String) -> String? { raw[key] as? String }
  func int(_ key: String) -> Int { raw[key] as? Int ?? 0 }
  func flag(_ key: String) -> Bool { raw[key] as? Bool ?? false }
  func object(_ key: String) -> AiJSON? { (raw[key] as? [String: Any]).map(AiJSON.init) }
  func list(_ key: String) -> [AiJSON] { (raw[key] as? [[String: Any]] ?? []).map(AiJSON.init) }
}

/// The pictures the page sends as base64, decoded once.
enum AiPicture {
  private static let cache = NSCache<NSString, UIImage>()

  static func image(_ base64: String) -> UIImage? {
    guard !base64.isEmpty else { return nil }
    let key = base64 as NSString
    if let known = cache.object(forKey: key) { return known }
    guard let data = Data(base64Encoded: base64), let image = UIImage(data: data) else { return nil }
    cache.setObject(image, forKey: key)
    return image
  }
}

// MARK: What the sheet shows around the conversation

struct AiAction: Identifiable {
  let id: String
  let label: String
  let primary: Bool

  init(_ json: AiJSON) {
    id = json.text("id")
    label = json.text("label")
    primary = json.flag("primary") || json.text("role") == "primary"
  }
}

struct AiOption: Identifiable {
  let id: String
  let label: String
  let note: String
  let checked: Bool

  init(_ json: AiJSON) {
    id = json.text("value")
    label = json.text("label")
    note = json.text("note")
    checked = json.flag("checked")
  }
}

struct AiOptionGroup: Identifiable {
  let id: Int
  let name: String
  let options: [AiOption]
}

struct AiTrayImage: Identifiable {
  let id: Int
  let name: String
  let picture: UIImage?
  let remove: String
}

struct AiComposerState {
  let placeholder: String
  let send: String
  let stop: String
  let attach: String
  let room: Int
  let images: [AiTrayImage]
  let notice: String?

  init(_ json: AiJSON) {
    placeholder = json.text("placeholder")
    send = json.text("send")
    stop = json.text("stop")
    attach = json.text("attach")
    room = json.int("room")
    images = json.list("images").map {
      AiTrayImage(
        id: $0.int("id"), name: $0.text("name"), picture: AiPicture.image($0.text("thumbnail")),
        remove: $0.text("remove"))
    }
    notice = json.optionalText("notice")
  }
}

struct AiState {
  struct Service: Identifiable {
    let id: String
    let name: String
  }

  struct Setup {
    let title: String
    let body: String
    let services: [Service]
    let action: String
    let note: String
  }

  struct Intro {
    struct Suggestion {
      let icon: String
      let label: String
    }
    let title: String
    let body: String
    let suggestions: [Suggestion]
  }

  struct ModelMenu {
    let label: String
    let groups: [AiOptionGroup]
    let manage: String
  }

  struct EffortMenu {
    let label: String
    let title: String
    let heading: String
    let options: [AiOption]
  }

  struct ModeMenu {
    let value: String
    let label: String
    let note: String
    let options: [AiOption]
  }

  struct Review {
    let text: String
    let prev: String
    let next: String
    let rejectAll: String
    let acceptAll: String
  }

  struct Plan {
    let text: String
    let manage: String
  }

  struct History {
    let visible: Bool
    let label: String
    let loading: String
    let empty: String
    let listFailed: String
    let delete: String
  }

  let title: String
  let ready: Bool
  let empty: Bool
  let busy: Bool
  let newChat: String
  let close: String
  let jump: String
  let waiting: String
  let history: History
  let setup: Setup?
  let intro: Intro?
  let model: ModelMenu
  let effort: EffortMenu?
  let mode: ModeMenu
  let review: Review?
  let plan: Plan?
  let composer: AiComposerState?

  init(_ json: AiJSON) {
    title = json.text("title")
    ready = json.flag("ready")
    empty = json.flag("empty")
    busy = json.flag("busy")
    let labels = json.object("labels") ?? AiJSON([:])
    newChat = labels.text("newChat")
    close = labels.text("close")
    jump = labels.text("jump")
    waiting = labels.text("waiting")
    let kept = json.object("history") ?? AiJSON([:])
    history = History(
      visible: kept.flag("visible"), label: kept.text("label"), loading: kept.text("loading"),
      empty: kept.text("empty"), listFailed: kept.text("listFailed"), delete: kept.text("delete"))
    setup = json.object("setup").map { setup in
      Setup(
        title: setup.text("title"), body: setup.text("body"),
        services: setup.list("services").map { Service(id: $0.text("id"), name: $0.text("name")) },
        action: setup.text("action"), note: setup.text("note"))
    }
    intro = json.object("intro").map { intro in
      Intro(
        title: intro.text("title"), body: intro.text("body"),
        suggestions: intro.list("suggestions").map {
          Intro.Suggestion(icon: $0.text("icon"), label: $0.text("label"))
        })
    }
    let models = json.object("model") ?? AiJSON([:])
    model = ModelMenu(
      label: models.text("label"),
      groups: models.list("groups").enumerated().map { index, group in
        AiOptionGroup(
          id: index, name: group.text("name"), options: group.list("options").map(AiOption.init))
      },
      manage: models.text("manage"))
    effort = json.object("effort").map { effort in
      EffortMenu(
        label: effort.text("label"), title: effort.text("title"), heading: effort.text("heading"),
        options: effort.list("options").map(AiOption.init))
    }
    let modes = json.object("mode") ?? AiJSON([:])
    mode = ModeMenu(
      value: modes.text("value"), label: modes.text("label"), note: modes.text("note"),
      options: modes.list("options").map(AiOption.init))
    review = json.object("review").map { review in
      Review(
        text: review.text("text"), prev: review.text("prev"), next: review.text("next"),
        rejectAll: review.text("rejectAll"), acceptAll: review.text("acceptAll"))
    }
    plan = json.object("plan").map { Plan(text: $0.text("text"), manage: $0.text("manage")) }
    composer = json.object("composer").map(AiComposerState.init)
  }
}

// MARK: The conversation

struct AiSource: Identifiable {
  let id: Int
  let title: String
  let host: String
  let href: String
}

struct AiDiffRow: Identifiable {
  let id: Int
  let kind: String
  let mark: String
  let text: String
}

struct AiApproval {
  let id: String
  let title: String
  let note: String?
  let path: String?
  let added: Int
  let removed: Int
  let text: String?
  let rows: [AiDiffRow]
  let answers: [AiAction]
}

struct AiEdit {
  let edit: String
  let title: String
  let meta: String
  let pending: Bool
  let reveal: String
  let accept: String
  let reject: String
}

struct AiGroup {
  let id: String
  let label: String
  let state: String
  let single: Bool
  let flat: Bool
  let parts: [AiPart]
  let cards: [AiPart]
}

/// One piece of a reply: text, a fold of steps, or something inside or under a fold.
enum AiPart {
  case text([Any])
  case group(AiGroup)
  case reasoning(label: String, text: String)
  case tool(label: String, state: String)
  case sources(label: String, items: [AiSource])
  case image(UIImage?, caption: String)
  case approval(AiApproval)
  case edit(AiEdit)

  static func parse(_ json: AiJSON) -> AiPart? {
    switch json.text("kind") {
    case "text":
      return .text(json.raw["blocks"] as? [Any] ?? [])
    case "group":
      return .group(
        AiGroup(
          id: json.text("id"), label: json.text("label"), state: json.text("state"),
          single: json.flag("single"), flat: json.flag("flat"),
          parts: json.list("parts").compactMap(parse), cards: json.list("cards").compactMap(parse)))
    case "reasoning":
      return .reasoning(label: json.text("label"), text: json.text("text"))
    case "tool":
      return .tool(label: json.text("label"), state: json.text("state"))
    case "sources":
      return .sources(
        label: json.text("label"),
        items: json.list("items").enumerated().map { index, item in
          AiSource(
            id: index, title: item.text("title"), host: item.text("host"), href: item.text("href"))
        })
    case "image":
      return .image(AiPicture.image(json.text("thumbnail")), caption: json.text("caption"))
    case "approval":
      return .approval(
        AiApproval(
          id: json.text("id"), title: json.text("title"), note: json.optionalText("note"),
          path: json.object("meta")?.optionalText("path"),
          added: json.object("meta")?.int("added") ?? 0,
          removed: json.object("meta")?.int("removed") ?? 0, text: json.optionalText("text"),
          rows: json.list("rows").enumerated().map { index, row in
            AiDiffRow(
              id: index, kind: row.text("kind"), mark: row.text("mark"), text: row.text("text"))
          },
          answers: json.list("answers").map(AiAction.init)))
    case "edit":
      return .edit(
        AiEdit(
          edit: json.text("edit"), title: json.text("title"), meta: json.text("meta"),
          pending: json.flag("pending"), reveal: json.text("reveal"), accept: json.text("accept"),
          reject: json.text("reject")))
    default:
      return nil
    }
  }
}

struct AiEntry {
  enum Role { case user, assistant }

  struct Foot {
    let text: String
    let actions: [AiAction]
  }

  struct Failure {
    let text: String
    let detail: String?
    let actions: [AiAction]
  }

  let id: Int
  let role: Role
  var text = ""
  var images: [UIImage?] = []
  var parts: [AiPart] = []
  var waiting = false
  var status: String?
  var foot: Foot?
  var failure: Failure?

  static func parse(_ raw: [String: Any]) -> AiEntry? {
    let json = AiJSON(raw)
    guard raw["id"] is Int else { return nil }
    var entry = AiEntry(id: json.int("id"), role: json.text("role") == "user" ? .user : .assistant)
    if entry.role == .user {
      entry.text = json.text("text")
      entry.images = json.list("images").map { AiPicture.image($0.text("thumbnail")) }
      return entry
    }
    entry.parts = json.list("parts").compactMap(AiPart.parse)
    entry.waiting = json.flag("waiting")
    entry.status = json.object("status")?.optionalText("text")
    entry.foot = json.object("foot").map { foot in
      Foot(
        text: foot.text("text"),
        actions: foot.list("actions").map(AiAction.init))
    }
    entry.failure = json.object("error").map { failure in
      Failure(
        text: failure.text("text"), detail: failure.optionalText("detail"),
        actions: failure.list("actions").map(AiAction.init))
    }
    return entry
  }
}

/// A message of the conversation; only its own row redraws as a reply streams in.
final class AiEntryBox: ObservableObject, Identifiable {
  let id: Int
  @Published var entry: AiEntry

  init(_ entry: AiEntry) {
    id = entry.id
    self.entry = entry
  }
}

struct AiHistoryItem: Identifiable {
  let id: String
  let title: String
  let detail: String
  let current: Bool
}

/// Text the AI menu hands the conversation, to add to what is written.
struct AiInsertion: Equatable {
  let id = UUID()
  let text: String
}

final class AiModel: ObservableObject {
  @Published var state: AiState?
  @Published var insertion: AiInsertion?
  @Published private(set) var boxes: [AiEntryBox] = []
  /// Counts the times the list is to be shown from its end again.
  @Published var pinned = 0
  @Published var historyShown = false
  @Published var historyLoaded = false
  @Published var historyItems: [AiHistoryItem] = []
  @Published var historyFailure: String?
  @Published var copied: Int?
  var copying: Int?

  func replace(_ entries: [AiEntry]) {
    boxes = entries.map(AiEntryBox.init)
    pinned += 1
  }

  func upsert(_ entry: AiEntry) {
    if let box = boxes.first(where: { $0.id == entry.id }) {
      box.entry = entry
      return
    }
    boxes.append(AiEntryBox(entry))
    if entry.role == .user { pinned += 1 }
  }

  func remove(_ id: Int) {
    boxes.removeAll { $0.id == id }
  }

  func apply(history json: AiJSON) {
    historyItems = json.list("items").map {
      AiHistoryItem(
        id: $0.text("id"), title: $0.text("title"), detail: $0.text("detail"),
        current: $0.flag("current"))
    }
    historyFailure = json.optionalText("failed")
    historyLoaded = true
  }

  func markCopied() {
    guard let entry = copying else { return }
    copied = entry
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
      if self?.copied == entry { self?.copied = nil }
    }
  }
}

/// What the sheet's views ask of the page and of the screen around them.
final class AiBridge {
  private unowned let shell: NativeShell
  private unowned let model: AiModel
  var pickImages: (Int) -> Void = { _ in }
  var lowerSheet: () -> Void = {}
  var closeSheet: () -> Void = {}

  init(shell: NativeShell, model: AiModel) {
    self.shell = shell
    self.model = model
  }

  func send(_ text: String) { shell.tell("ai", "send", ["text": text]) }
  func stop() { shell.tell("ai", "stop") }
  func retry() { shell.tell("ai", "retry") }
  func newChat() { shell.tell("ai", "newChat") }
  func suggestion(_ index: Int) { shell.tell("ai", "suggestion", ["index": index]) }
  func service(_ id: String) { shell.tell("ai", "service", ["id": id]) }
  func settings() { shell.tell("ai", "settings") }
  func chooseModel(_ value: String) { shell.tell("ai", "model", ["value": value]) }
  func chooseEffort(_ value: String) { shell.tell("ai", "effort", ["value": value]) }
  func chooseMode(_ value: String) { shell.tell("ai", "mode", ["value": value]) }
  func unattach(_ id: Int) { shell.tell("ai", "unattach", ["id": id]) }
  func approval(_ id: String, _ answer: String) {
    shell.tell("ai", "approval", ["id": id, "answer": answer])
  }
  func link(_ href: String) { shell.tell("ai", "link", ["href": href]) }
  func plan() { shell.tell("ai", "plan") }

  func copy(_ entry: Int) {
    model.copying = entry
    shell.tell("ai", "copy", ["entry": entry])
  }

  func history() {
    model.historyLoaded = false
    model.historyShown = true
    shell.tell("ai", "history")
  }

  func conversation(_ action: String, _ id: String) {
    shell.tell("ai", "conversation", ["action": action, "id": id])
  }

  func edit(_ action: String, _ edit: String) {
    if action == "reveal" { lowerSheet() }
    shell.tell("ai", "edit", ["action": action, "edit": edit])
  }

  func review(_ action: String) {
    if action == "prev" || action == "next" { lowerSheet() }
    shell.tell("ai", "review", ["action": action])
  }

  func attach(room: Int) {
    if room > 0 {
      pickImages(room)
    } else {
      shell.tell("ai", "attach", ["images": [[String: Any]]()])
    }
  }

  func attached(_ images: [[String: Any]]) {
    shell.tell("ai", "attach", ["images": images])
  }
}

/// The assistant as a sheet over the document, lowered so the document stays usable above it.
final class AiPanelController: NativePanel {
  private unowned let shell: NativeShell
  private let model = AiModel()
  private lazy var bridge = AiBridge(shell: shell, model: model)
  private var sheet: UIViewController?
  private var picker: AiImagePicker?

  init(shell: NativeShell) {
    self.shell = shell
  }

  func open(_ body: [String: Any]) {
    guard sheet == nil else { return }
    bridge.closeSheet = { [weak self] in self?.close() }
    bridge.pickImages = { [weak self] room in self?.pickImages(room: room) }
    bridge.lowerSheet = { [weak self] in self?.lower() }
    let view = AiPanelView(model: model, bridge: bridge)
    sheet = PanelSheet.present(
      view, from: shell.presenter, heights: [.medium, .large], undimmed: .medium
    ) { [weak self] in
      self?.sheet = nil
      self?.model.historyShown = false
      self?.shell.tell("ai", "close")
    }
    shell.tell("ai", "open")
  }

  func receive(_ op: String, _ body: [String: Any]) {
    switch op {
    case "state":
      model.state = AiState(AiJSON(body))
    case "entries":
      model.replace((body["entries"] as? [[String: Any]] ?? []).compactMap(AiEntry.parse))
    case "entry":
      if let entry = (body["entry"] as? [String: Any]).flatMap(AiEntry.parse) { model.upsert(entry) }
    case "removed":
      if let id = body["id"] as? Int { model.remove(id) }
    case "history":
      model.apply(history: AiJSON(body))
    case "historyDone":
      model.historyShown = false
    case "write":
      model.insertion = AiInsertion(text: body["text"] as? String ?? "")
    case "copy":
      UIPasteboard.general.string = body["text"] as? String ?? ""
      model.markCopied()
    case "hide":
      close()
    default:
      break
    }
  }

  private func close() {
    guard let sheet else {
      shell.tell("ai", "close")
      return
    }
    PanelSheet.close(sheet)
  }

  private func lower() {
    sheet?.sheetPresentationController?.animateChanges {
      sheet?.sheetPresentationController?.selectedDetentIdentifier = .medium
    }
  }

  private func pickImages(room: Int) {
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = room
    configuration.preferredAssetRepresentationMode = .compatible
    let controller = PHPickerViewController(configuration: configuration)
    let delegate = AiImagePicker { [weak self] images in
      self?.picker = nil
      self?.bridge.attached(images)
    }
    picker = delegate
    controller.delegate = delegate
    shell.presenter.present(controller, animated: true)
  }
}

/// Reads the pictures chosen in the photo picker as the page takes them: a name, a type and the bytes in base64.
final class AiImagePicker: NSObject, PHPickerViewControllerDelegate {
  private let completion: ([[String: Any]]) -> Void

  init(completion: @escaping ([[String: Any]]) -> Void) {
    self.completion = completion
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    var images = [[String: Any]?](repeating: nil, count: results.count)
    let lock = NSLock()
    let group = DispatchGroup()
    for (index, result) in results.enumerated() {
      let provider = result.itemProvider
      guard
        let identifier = provider.registeredTypeIdentifiers.first(where: {
          UTType($0)?.conforms(to: .image) ?? false
        })
      else { continue }
      group.enter()
      provider.loadDataRepresentation(forTypeIdentifier: identifier) { data, _ in
        defer { group.leave() }
        guard let data else { return }
        let type = UTType(identifier)
        let name = provider.suggestedName ?? ""
        let suffix = type?.preferredFilenameExtension.map { ".\($0)" } ?? ""
        let image: [String: Any] = [
          "name": name.isEmpty ? "" : name + suffix,
          "type": type?.preferredMIMEType ?? "image/jpeg",
          "data": data.base64EncodedString(),
        ]
        lock.lock()
        images[index] = image
        lock.unlock()
      }
    }
    group.notify(queue: .main) { [completion] in
      completion(images.compactMap { $0 })
    }
  }
}
