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
  fileprivate let editor: EditorViewController
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
    navigation = UINavigationController(rootViewController: home)
    super.init()
    home.rootView = AnyView(LibraryHome(model: model, shell: self))
    navigation.setNavigationBarHidden(true, animated: false)
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
    shell.themeWatch = Theme.shared.$dark.sink { [weak window] dark in
      window?.overrideUserInterfaceStyle = dark ? .dark : .light
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
      panels[name]?.receive(op, body)
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
    park()
    send(["type": "leave"])
    model.reload()
  }

  func showFolder(title: String, path: String) {
    let folder = FolderModel(path: path, queue: queue)
    let page = UIHostingController(rootView: FolderView(model: folder, title: title, shell: self))
    navigation.pushViewController(page, animated: true)
    folder.reload()
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

  func showActions(title: String?, closeInHeader: Bool = false, _ actions: [SheetAction]) {
    OverlayPresenter.present(from: presenter) { close in
      ActionSheet(
        title: title, closeInHeader: closeInHeader, actions: actions, cancel: L10n.text("cancel"),
        dismiss: close)
    }
  }

  /// The editor page's ⋯: the file menu.
  func showFileMenu() {
    let actions = [
      SheetAction(title: L10n.text("new")) { [weak self] in
        guard let self, let folder = self.model.defaultFolder else { return }
        self.create(in: folder)
      },
      SheetAction(title: L10n.text("open")) { [weak self] in self?.pickDocument() },
      SheetAction(title: L10n.text("rename") + "…") { [weak self] in self?.renameCurrent() },
      SheetAction(title: L10n.text("share")) { [weak self] in self?.perform("share") },
      SheetAction(title: L10n.text("exportPdf")) { [weak self] in self?.perform("exportPdf") },
      SheetAction(title: L10n.text("print")) { [weak self] in self?.perform("print") },
    ]
    showActions(title: L10n.text("file"), closeInHeader: true, actions)
  }

  private func renameCurrent() {
    let current = displayName(chrome.title)
    OverlayPresenter.present(from: presenter) { close in
      RenameDialog(
        initial: current,
        submit: { [weak self] stem, done in
          self?.ask(["type": "rename", "stem": stem], done: done)
        }, dismiss: close)
    }
  }

  func report(_ error: Error) {
    let alert = UIAlertController(
      title: nil, message: L10n.text("failed", Failure.from(error).message), preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    presenter.present(alert, animated: true)
  }

  /// Asks for a new name for the item at `path`, then renames it.
  func askToRename(path: String, current: String, done: @escaping (String) -> Void) {
    OverlayPresenter.present(from: presenter) { close in
      RenameDialog(
        initial: current,
        submit: { [weak self] stem, finish in
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
        }, dismiss: close)
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

/// The editor page: NyaMark's title bar and bottom bar around the page's editor.
final class EditorViewController: UIViewController {
  weak var shell: NativeShell? {
    didSet { installBars() }
  }
  private let webView: WKWebView
  private var header: UIHostingController<AnyView>?
  private var bottomBar: UIHostingController<AnyView>?
  private var watches: [AnyCancellable] = []

  init(webView: WKWebView) {
    self.webView = webView
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  private func installBars() {
    guard let shell, header == nil else { return }
    header = UIHostingController(rootView: AnyView(EditorHeader(chrome: shell.chrome, shell: shell)))
    bottomBar = UIHostingController(
      rootView: AnyView(EditorBottomBar(chrome: shell.chrome, shell: shell)))
    watches.append(
      Theme.shared.$colors.sink { [weak self] colors in
        self?.viewIfLoaded?.backgroundColor = colors["app-bg-start"]
      })
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Theme.shared.ui("app-bg-start")
    guard let header, let bottomBar else { return }
    for bar in [header, bottomBar] {
      addChild(bar)
      bar.view.backgroundColor = .clear
      bar.view.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(bar.view)
      bar.didMove(toParent: self)
    }
    NSLayoutConstraint.activate([
      header.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      header.view.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      header.view.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      header.view.heightAnchor.constraint(equalToConstant: 56),
      bottomBar.view.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      bottomBar.view.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      bottomBar.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    for name in [UIResponder.keyboardWillShowNotification, UIResponder.keyboardWillHideNotification] {
      NotificationCenter.default.addObserver(
        self, selector: #selector(keyboardMoves(_:)), name: name, object: nil)
    }
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    guard webView.superview !== view, let header else { return }
    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = false
    view.insertSubview(webView, at: 0)
    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: header.view.bottomAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    tellInsets()
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isMovingFromParent { shell?.editorClosed() }
  }

  /// The page keeps the end of the document clear of the bottom bar.
  private func tellInsets() {
    guard let shell, let bottomBar, !shell.chrome.keyboardShown else {
      shell?.tellInsets(bottom: 0)
      return
    }
    shell.tellInsets(bottom: max(0, view.bounds.maxY - bottomBar.view.frame.minY))
  }

  @objc private func keyboardMoves(_ note: Notification) {
    let shown = note.name == UIResponder.keyboardWillShowNotification
    let duration =
      (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
    withAnimation(.easeOut(duration: duration)) { shell?.chrome.keyboardShown = shown }
    tellInsets()
  }

  func conceal() {
    webView.alpha = 0
  }

  func reveal() {
    UIView.animate(withDuration: 0.2) { self.webView.alpha = 1 }
  }
}

/// NyaMark's title bar: back, the document's name and save state, and the file menu.
struct EditorHeader: View {
  @ObservedObject var chrome: EditorChrome
  @ObservedObject private var theme = Theme.shared
  weak var shell: NativeShell?

  var body: some View {
    ZStack {
      VStack(spacing: 2) {
        Text(chrome.title)
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(theme.color("text-primary"))
          .lineLimit(1)
        Text(chrome.status)
          .font(.system(size: 12))
          .foregroundStyle(theme.color("text-muted"))
          .lineLimit(1)
      }
      .padding(.horizontal, 76)
      HStack {
        CircleButton(symbol: "chevron.left", label: L10n.text("documents")) { shell?.goBack() }
        Spacer()
        CircleButton(symbol: "ellipsis", label: L10n.text("file")) { shell?.showFileMenu() }
      }
      .padding(.horizontal, 16)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// NyaMark's floating bottom bar: outline, source, assistant, find and settings.
struct EditorBottomBar: View {
  @ObservedObject var chrome: EditorChrome
  @ObservedObject private var theme = Theme.shared
  weak var shell: NativeShell?

  var body: some View {
    ZStack {
      if !chrome.keyboardShown {
        GlassGroup(spacing: 8) {
          HStack(spacing: 8) {
            item("list.bullet.indent", "outline") { shell?.openPanel("outline") }
            item("chevron.left.forwardslash.chevron.right", "source", on: chrome.sourceMode) {
              shell?.perform("toggleSource")
            }
            item("sparkles", "ai") { shell?.openPanel("ai") }
            item("magnifyingglass", "find") { shell?.openPanel("find") }
            item("gearshape", "settings") { shell?.openPanel("form", ["form": "settings"]) }
          }
          .padding(6)
          .glassCard()
        }
        .barShadow()
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
  }

  private func item(
    _ symbol: String, _ label: String, on: Bool = false, run: @escaping () -> Void
  ) -> some View {
    Button {
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      run()
    } label: {
      Image(systemName: symbol)
        .font(.system(size: 19))
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(NavItemStyle(on: on))
    .accessibilityLabel(L10n.text(label))
  }
}

struct NavItemStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared
  let on: Bool

  func makeBody(configuration: Configuration) -> some View {
    let lit = on || configuration.isPressed
    return configuration.label
      .foregroundStyle(lit ? theme.color("accent-ink") : theme.color("text-secondary"))
      .background(
        RoundedRectangle(cornerRadius: 24, style: .continuous)
          .fill(lit ? theme.color("accent-soft") : .clear))
      .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
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
