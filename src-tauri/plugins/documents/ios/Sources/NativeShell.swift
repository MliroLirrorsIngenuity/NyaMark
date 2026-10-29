import Combine
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

/// What the editor page's bars show; the page reports it as the document changes.
final class EditorChrome: ObservableObject {
  @Published var title = ""
  @Published var status = ""
  @Published var sourceMode = false
  @Published var keyboardShown = false
}

/// The app's screens on iPhone and iPad, drawn natively in NyaMark's design around the page's editor.
final class NativeShell: NSObject, WKScriptMessageHandler, UIGestureRecognizerDelegate {
  static private(set) var current: NativeShell?

  let queue: DispatchQueue
  let library: Library
  let webView: WKWebView
  let toolbar = KeyboardToolbar()
  let model: LibraryModel
  let chrome = EditorChrome()
  private let navigation: UINavigationController
  private let libraryPage: UIViewController
  private var libraryWatch: AnyCancellable?
  fileprivate let editor: EditorViewController
  /// The editor page, for panels that float over the document rather than in a sheet.
  var editorPage: UIViewController { editor }
  private var editingDocument = false
  /// Messages wait here while the page loads; it takes them once it reports ready.
  private var pending: [[String: Any]] = []
  private var pageReady = false
  private var replies: [String: (String?) -> Void] = [:]
  private var picker: PickerDelegate?
  private var themeWatch: AnyCancellable?
  /// The native panels by the name the page addresses them with.
  private lazy var panels: [String: NativePanel] = [
    "outline": OutlinePanelController(shell: self),
    "find": FindPanelController(shell: self),
    "form": FormPanelController(shell: self),
    "ai": AiPanelController(shell: self),
    "quick": QuickMenuController(shell: self),
    "toast": ToastController(shell: self),
  ]

  static let markdownExtensions: [String] = {
    let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleDocumentTypes") as? [[String: Any]]
    let extensions = types?.flatMap { $0["CFBundleTypeExtensions"] as? [String] ?? [] } ?? []
    return extensions.isEmpty ? ["md"] : extensions
  }()

  private init(webView: WKWebView, queue: DispatchQueue, library: Library, deviceName: String) {
    self.webView = webView
    self.queue = queue
    self.library = library
    model = LibraryModel(queue: queue, library: library, deviceName: deviceName)
    editor = EditorViewController(webView: webView)
    let home = UIHostingController(rootView: AnyView(EmptyView()))
    libraryPage = home
    navigation = UINavigationController(rootViewController: home)
    super.init()
    home.rootView = AnyView(LibraryHome(model: model, shell: self))
    home.navigationItem.largeTitleDisplayMode = .always
    navigation.navigationBar.prefersLargeTitles = true
    let add = UIBarButtonItem(
      systemItem: .add,
      primaryAction: UIAction { [weak self] _ in
        guard let self, let folder = self.model.defaultFolder else { return }
        self.create(in: folder)
      })
    home.navigationItem.rightBarButtonItem = add
    libraryWatch = model.$locations.sink { [weak self, weak add] _ in
      DispatchQueue.main.async { add?.isEnabled = self?.model.defaultFolder != nil }
    }
    retitle()
    navigation.interactivePopGestureRecognizer?.delegate = self
    editor.shell = self
  }

  /// Puts the native screens in the window that holds the page; the page becomes the editor page's body.
  static func install(
    webView: WKWebView, queue: DispatchQueue, library: Library, deviceName: String, attempt: Int = 0
  ) {
    guard current == nil else { return }
    guard let window = webView.window else {
      if attempt < 50 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
          install(
            webView: webView, queue: queue, library: library, deviceName: deviceName,
            attempt: attempt + 1)
        }
      }
      return
    }
    let shell = NativeShell(webView: webView, queue: queue, library: library, deviceName: deviceName)
    current = shell
    webView.configuration.userContentController.add(shell, name: "nyamark")
    shell.toolbar.onKey = { [weak shell] key in shell?.send(key) }
    shell.toolbar.onHideKeyboard = { [weak shell] in shell?.webView.endEditing(true) }
    shell.themeWatch = Theme.shared.$colors.sink { [weak window] _ in
      DispatchQueue.main.async {
        window?.overrideUserInterfaceStyle = Theme.shared.dark ? .dark : .light
        window?.tintColor = Theme.shared.ui("accent")
      }
    }
    window.rootViewController = shell.navigation
    shell.park()
    queue.async {
      let reopening = library.current() != nil
      DispatchQueue.main.async {
        if reopening {
          shell.editor.conceal()
          shell.showEditor(animated: false)
        }
        shell.model.reload()
      }
    }
  }

  /// Keeps the page in the window, behind the library, so it goes on loading and drawing.
  func park() {
    guard let window = navigation.view.window ?? webView.window else { return }
    webView.endEditing(true)
    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = true
    webView.frame = window.bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    window.insertSubview(webView, at: 0)
  }

  func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    navigation.viewControllers.count > 1
  }

  // MARK: Page messages

  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "ready":
      pageReady = true
      let waiting = pending
      pending = []
      waiting.forEach(send)
      if let language = body["language"] as? String, language != L10n.language {
        L10n.language = language
        model.objectWillChange.send()
        retitle()
      }
      if body["path"] is String {
        showEditor(animated: navigation.viewControllers.count == 1)
        editor.reveal()
      } else if navigation.viewControllers.contains(editor) {
        navigation.popToRootViewController(animated: true)
      }
    case "state":
      chrome.title = body["title"] as? String ?? ""
      chrome.status = body["status"] as? String ?? ""
      chrome.sourceMode = body["sourceMode"] as? Bool ?? false
      toolbar.setSourceMode(chrome.sourceMode)
      toolbar.setActive(Set(body["active"] as? [String] ?? []))
    case "theme":
      Theme.shared.update(
        dark: body["dark"] as? Bool ?? false, reported: body["colors"] as? [String: [Double]] ?? [:])
    case "focus":
      let editing = body["document"] as? Bool ?? false
      if editing != editingDocument {
        editingDocument = editing
        FirstResponder.reloadInputViews()
      }
    case "reply":
      if let id = body["id"] as? String, let done = replies.removeValue(forKey: id) {
        done(body["error"] as? String)
      }
    case "panel":
      guard let name = body["panel"] as? String, let op = body["op"] as? String else { return }
      // The page opens a panel itself with `present`, as a shortcut or another panel asks.
      if op == "present" {
        panels[name]?.open(body)
      } else {
        panels[name]?.receive(op, body)
      }
    default:
      break
    }
  }

  /// The view shown above the keyboard; none outside the document, where the page's own fields are.
  var accessoryView: UIView? {
    editingDocument ? toolbar : nil
  }

  // MARK: Telling the page

  func send(_ message: [String: Any]) {
    guard pageReady else {
      pending.append(message)
      return
    }
    // The page reloads with the document it opens and reports ready again.
    if message["type"] as? String == "open" { pageReady = false }
    guard let data = try? JSONSerialization.data(withJSONObject: message),
      let json = String(data: data, encoding: .utf8)
    else { return }
    webView.evaluateJavaScript("window.__nyamarkNative?.receive(\(json))", completionHandler: nil)
  }

  private func send(_ key: ToolbarKey) {
    if let text = key.text {
      send(["type": "insert", "text": text])
    } else {
      send(["type": "command", "name": key.id])
    }
  }

  func perform(_ action: String) {
    send(["type": "action", "name": action])
  }

  /// Opens the native panel named `name`, as the bottom bar's buttons do.
  func openPanel(_ name: String, _ body: [String: Any] = [:]) {
    panels[name]?.open(body)
  }

  /// Asks the page and hands its answer, an error message or nil, to `done`.
  private func ask(_ message: [String: Any], done: @escaping (String?) -> Void) {
    let id = UUID().uuidString
    replies[id] = done
    var request = message
    request["reply"] = id
    send(request)
  }

  func tellInsets(bottom: CGFloat) {
    send(["type": "insets", "bottom": bottom])
  }

  // MARK: Navigation

  func open(_ path: String) {
    editor.conceal()
    showEditor(animated: true)
    send(["type": "open", "path": path])
  }

  private func showEditor(animated: Bool) {
    guard navigation.topViewController !== editor else { return }
    if navigation.viewControllers.contains(editor) {
      navigation.popToViewController(editor, animated: animated)
    } else {
      navigation.pushViewController(editor, animated: animated)
    }
  }

  func goBack() {
    navigation.popViewController(animated: true)
  }

  /// The editor page went; the page saves the document and closes it.
  func editorClosed() {
    (panels["find"] as? FindPanelController)?.close()
    park()
    send(["type": "leave"])
    model.reload()
  }

  func showFolder(title: String, path: String) {
    let folder = FolderModel(path: path, queue: queue)
    navigation.pushViewController(FolderPage(model: folder, title: title, shell: self), animated: true)
    folder.reload()
  }

  /// The library's title in the language the page reports.
  private func retitle() {
    libraryPage.navigationItem.title = L10n.text("documents")
    libraryPage.navigationItem.rightBarButtonItem?.accessibilityLabel = L10n.text("newDocument")
  }

  func create(in folder: String) {
    queue.async {
      do {
        let url = try FileAccess.createDocument(
          in: URL(fileURLWithPath: folder, isDirectory: true), baseName: L10n.text("untitled"),
          extension: "md")
        DispatchQueue.main.async { self.open(canonicalPath(url)) }
      } catch {
        DispatchQueue.main.async { self.report(error) }
      }
    }
  }

  // MARK: Sheets and dialogs

  var presenter: UIViewController {
    var top: UIViewController = navigation
    while let presented = top.presentedViewController { top = presented }
    return top
  }

  /// The editor page's ⋯: the file menu.
  func fileMenu() -> UIMenu {
    func item(_ key: String, _ symbol: String, _ run: @escaping (NativeShell) -> Void) -> UIAction {
      UIAction(title: L10n.text(key), image: UIImage(systemName: symbol)) { [weak self] _ in
        if let self { run(self) }
      }
    }
    return UIMenu(children: [
      UIMenu(
        options: .displayInline,
        children: [
          item("new", "square.and.pencil") { shell in
            if let folder = shell.model.defaultFolder { shell.create(in: folder) }
          },
          item("open", "folder") { $0.pickDocument() },
          item("rename", "pencil") { $0.renameCurrent() },
        ]),
      UIMenu(
        options: .displayInline,
        children: [
          item("share", "square.and.arrow.up") { $0.perform("share") },
          item("exportPdf", "doc.richtext") { $0.perform("exportPdf") },
          item("print", "printer") { $0.perform("print") },
        ]),
    ])
  }

  private func renameCurrent() {
    askForName(initial: displayName(chrome.title)) { [weak self] stem, done in
      self?.ask(["type": "rename", "stem": stem], done: done)
    }
  }

  /// Asks for a name with the system's alert; `submit` answers with a message to show again, or nil.
  func askForName(
    initial: String, problem: String? = nil,
    submit: @escaping (String, @escaping (String?) -> Void) -> Void
  ) {
    let alert = UIAlertController(
      title: L10n.text("rename"), message: problem, preferredStyle: .alert)
    alert.addTextField { field in
      field.text = initial
      field.clearButtonMode = .whileEditing
      field.autocapitalizationType = .none
      field.returnKeyType = .done
    }
    alert.addAction(UIAlertAction(title: L10n.text("cancel"), style: .cancel))
    let confirm = UIAlertAction(title: L10n.text("rename"), style: .default) {
      [weak self, weak alert] _ in
      let name = (alert?.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if name.isEmpty || name.contains("/") || name.contains(":") {
        self?.askForName(initial: name, problem: L10n.text("invalidName"), submit: submit)
        return
      }
      submit(name) { message in
        if let message { self?.askForName(initial: name, problem: message, submit: submit) }
      }
    }
    alert.addAction(confirm)
    alert.preferredAction = confirm
    presenter.present(alert, animated: true)
  }

  func report(_ error: Error) {
    let alert = UIAlertController(
      title: nil, message: L10n.text("failed", Failure.from(error).message), preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    presenter.present(alert, animated: true)
  }

  /// Asks for a new name for the item at `path`, then renames it.
  func askToRename(path: String, current: String, done: @escaping (String) -> Void) {
    askForName(initial: current) { [weak self] stem, finish in
      guard let self else { return }
      self.queue.async {
        do {
          let renamed = try FileAccess.rename(URL(fileURLWithPath: path), to: stem)
          DispatchQueue.main.async {
            finish(nil)
            done(canonicalPath(renamed))
          }
        } catch Failure.exists(let name) {
          DispatchQueue.main.async { finish(L10n.text("exists", name)) }
        } catch {
          DispatchQueue.main.async { finish(L10n.text("failed", Failure.from(error).message)) }
        }
      }
    }
  }

  /// Asks before deleting the item at `path`, as the page did with the system's alert.
  func askToDelete(path: String, name: String, done: @escaping () -> Void) {
    let alert = UIAlertController(
      title: L10n.text("deleteTitle", name), message: L10n.text("deleteBody"), preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: L10n.text("cancel"), style: .cancel))
    alert.addAction(
      UIAlertAction(title: L10n.text("delete"), style: .destructive) { [weak self] _ in
        guard let self else { return }
        self.queue.async {
          do {
            let url = URL(fileURLWithPath: path)
            let recent = self.library.recentIDs(at: canonicalPath(url))
            try FileAccess.delete(url)
            self.library.forget(ids: recent)
            DispatchQueue.main.async { done() }
          } catch {
            DispatchQueue.main.async { self.report(error) }
          }
        }
      })
    presenter.present(alert, animated: true)
  }

  // MARK: Pickers

  private func pick(_ types: [UTType], completion: @escaping (URL) -> Void) {
    let controller = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
    controller.shouldShowFileExtensions = true
    let delegate = PickerDelegate { [weak self] url in
      self?.picker = nil
      if let url { completion(url) }
    }
    picker = delegate
    controller.delegate = delegate
    presenter.present(controller, animated: true)
  }

  func pickFolder() {
    pick([.folder]) { url in
      self.queue.async {
        do {
          _ = try self.library.addFolder(url)
          self.model.reload()
        } catch {
          DispatchQueue.main.async { self.report(error) }
        }
      }
    }
  }

  func pickDocument() {
    let types = Self.markdownExtensions.compactMap { UTType(filenameExtension: $0) }
    pick(types.isEmpty ? [.plainText] : types) { url in
      self.queue.async {
        do {
          try self.library.noteOpened(url)
          DispatchQueue.main.async { self.open(canonicalPath(url)) }
        } catch {
          DispatchQueue.main.async { self.report(error) }
        }
      }
    }
  }
}

/// The editor page: the document's name in the system's bar, the page's editor, and the tools in the system's toolbar.
final class EditorViewController: UIViewController {
  weak var shell: NativeShell? {
    didSet { installBars() }
  }
  private let webView: WKWebView
  private let sourceItem = UIBarButtonItem()
  private var watches: [AnyCancellable] = []

  init(webView: WKWebView) {
    self.webView = webView
    super.init(nibName: nil, bundle: nil)
    navigationItem.largeTitleDisplayMode = .never
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  private func installBars() {
    guard let shell, watches.isEmpty else { return }
    let file = UIBarButtonItem(
      title: L10n.text("file"), image: UIImage(systemName: "ellipsis"), primaryAction: nil,
      menu: shell.fileMenu())
    navigationItem.rightBarButtonItem = file
    sourceItem.image = UIImage(systemName: "chevron.left.forwardslash.chevron.right")
    sourceItem.primaryAction = UIAction(
      image: UIImage(systemName: "chevron.left.forwardslash.chevron.right")
    ) { [weak self] _ in self?.shell?.perform("toggleSource") }
    let tool = { [weak self] (symbol: String, run: @escaping (NativeShell) -> Void) -> UIBarButtonItem in
      UIBarButtonItem(
        image: UIImage(systemName: symbol),
        primaryAction: UIAction(image: UIImage(systemName: symbol)) { [weak self] _ in
          if let shell = self?.shell { run(shell) }
        })
    }
    let outline = tool("list.bullet.indent") { $0.openPanel("outline") }
    let ai = tool("sparkles") { $0.openPanel("ai") }
    let find = tool("magnifyingglass") { $0.openPanel("find") }
    let settings = tool("gearshape") { $0.openPanel("form", ["form": "settings"]) }
    toolbarItems = [
      outline, .flexibleSpace(), sourceItem, .flexibleSpace(), ai, .flexibleSpace(), find,
      .flexibleSpace(), settings,
    ]
    let label = { [weak self, weak shell, weak file] in
      guard let self, let shell else { return }
      for (item, key) in [
        (outline, "outline"), (self.sourceItem, "source"), (ai, "ai"), (find, "find"),
        (settings, "settings"),
      ] {
        item.accessibilityLabel = L10n.text(key)
      }
      file?.title = L10n.text("file")
      file?.menu = shell.fileMenu()
    }
    label()
    watches.append(
      shell.chrome.$title.sink { [weak self] title in
        self?.navigationItem.title = title
        label()
      })
    watches.append(
      shell.chrome.$status.sink { [weak self] status in
        if #available(iOS 26.0, *) { self?.navigationItem.subtitle = status }
      })
    watches.append(
      shell.chrome.$sourceMode.sink { [weak self] on in self?.sourceItem.isSelected = on })
    watches.append(
      Theme.shared.$colors.sink { [weak self] colors in
        self?.viewIfLoaded?.backgroundColor = colors["app-bg-start"]
      })
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.shared.ui("app-bg-start")
    for name in [UIResponder.keyboardWillShowNotification, UIResponder.keyboardWillHideNotification] {
      NotificationCenter.default.addObserver(
        self, selector: #selector(keyboardMoves(_:)), name: name, object: nil)
    }
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    navigationController?.setToolbarHidden(shell?.chrome.keyboardShown ?? false, animated: animated)
    guard webView.superview !== view else { return }
    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = false
    view.insertSubview(webView, at: 0)
    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    navigationController?.setToolbarHidden(true, animated: animated)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    tellInsets()
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isMovingFromParent { shell?.editorClosed() }
  }

  /// The page keeps the end of the document clear of the toolbar floating over it.
  private func tellInsets() {
    guard let shell, let toolbar = navigationController?.toolbar, !toolbar.isHidden,
      !shell.chrome.keyboardShown
    else {
      shell?.tellInsets(bottom: 0)
      return
    }
    let top = toolbar.convert(toolbar.bounds, to: view).minY
    shell.tellInsets(bottom: max(0, view.bounds.maxY - top))
  }

  @objc private func keyboardMoves(_ note: Notification) {
    let shown = note.name == UIResponder.keyboardWillShowNotification
    shell?.chrome.keyboardShown = shown
    guard navigationController?.topViewController === self else { return }
    navigationController?.setToolbarHidden(shown, animated: true)
    tellInsets()
  }

  func conceal() {
    webView.alpha = 0
  }

  func reveal() {
    UIView.animate(withDuration: 0.2) { self.webView.alpha = 1 }
  }
}

/// A folder of the library: its documents in a system list, with the system's search and + button.
final class FolderPage: UIHostingController<FolderView>, UISearchResultsUpdating {
  private let model: FolderModel

  init(model: FolderModel, title: String, shell: NativeShell) {
    self.model = model
    super.init(rootView: FolderView(model: model, shell: shell))
    navigationItem.title = title
    navigationItem.largeTitleDisplayMode = .never
    let search = UISearchController(searchResultsController: nil)
    search.searchResultsUpdater = self
    search.obscuresBackgroundDuringPresentation = false
    search.searchBar.placeholder = L10n.text("search")
    navigationItem.searchController = search
    navigationItem.hidesSearchBarWhenScrolling = false
    let add = UIBarButtonItem(
      systemItem: .add,
      primaryAction: UIAction { [weak shell] _ in shell?.create(in: model.path) })
    add.accessibilityLabel = L10n.text("newDocument")
    navigationItem.rightBarButtonItem = add
  }

  @MainActor required dynamic init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  func updateSearchResults(for controller: UISearchController) {
    model.query = controller.searchBar.text ?? ""
  }
}

/// Finds the first responder through the responder chain, to have it ask for its input views again.
enum FirstResponder {
  fileprivate static weak var found: UIResponder?

  static func reloadInputViews() {
    found = nil
    UIApplication.shared.sendAction(
      #selector(UIResponder.nyamarkCaptureFirstResponder), to: nil, from: nil, for: nil)
    found?.reloadInputViews()
  }
}

extension UIResponder {
  @objc fileprivate func nyamarkCaptureFirstResponder() {
    FirstResponder.found = self
  }
}

@_cdecl("nyamark_keyboard_accessory")
func nyamarkKeyboardAccessory() -> UnsafeMutableRawPointer? {
  guard let view = NativeShell.current?.accessoryView else { return nil }
  return Unmanaged.passUnretained(view).toOpaque()
}
