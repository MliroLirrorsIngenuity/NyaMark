import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

/// The app's screens on iPhone and iPad: a native library and editor page around the page's editor.
final class NativeShell: NSObject, WKScriptMessageHandler {
  static private(set) var current: NativeShell?

  let queue: DispatchQueue
  let library: Library
  let webView: WKWebView
  let deviceName: String
  let toolbar = KeyboardToolbar()
  let model: LibraryModel
  private let navigation: UINavigationController
  fileprivate let editor: EditorViewController
  /// Whether the caret is in the document, where the formatting keys belong.
  private var editingDocument = false
  /// Messages wait here while the page loads; it takes them once it reports ready.
  private var pending: [[String: Any]] = []
  private var pageReady = false

  static let markdownExtensions: [String] = {
    let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleDocumentTypes") as? [[String: Any]]
    let extensions = types?.flatMap { $0["CFBundleTypeExtensions"] as? [String] ?? [] } ?? []
    return extensions.isEmpty ? ["md"] : extensions
  }()

  private init(webView: WKWebView, queue: DispatchQueue, library: Library, deviceName: String) {
    self.webView = webView
    self.queue = queue
    self.library = library
    self.deviceName = deviceName
    model = LibraryModel(queue: queue, library: library, deviceName: deviceName)
    editor = EditorViewController(webView: webView)
    let home = UIHostingController(rootView: AnyView(EmptyView()))
    navigation = UINavigationController(rootViewController: home)
    super.init()
    home.rootView = AnyView(LibraryHome(model: model, shell: self))
    home.navigationItem.title = L10n.text("documents")
    home.navigationItem.largeTitleDisplayMode = .always
    home.navigationItem.rightBarButtonItem = newDocumentButton { [weak self] in
      self?.createInDefaultFolder()
    }
    navigation.navigationBar.prefersLargeTitles = true
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
      } else if navigation.topViewController === editor {
        navigation.popToRootViewController(animated: true)
      }
    case "state":
      editor.update(
        title: body["title"] as? String ?? "", sourceMode: body["sourceMode"] as? Bool ?? false)
      toolbar.setSourceMode(body["sourceMode"] as? Bool ?? false)
      toolbar.setActive(Set(body["active"] as? [String] ?? []))
    case "focus":
      let editing = body["document"] as? Bool ?? false
      if editing != editingDocument {
        editingDocument = editing
        FirstResponder.reloadInputViews()
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

  /// The editor page went; the page saves the document and closes it.
  func editorClosed() {
    park()
    send(["type": "leave"])
    model.reload()
  }

  func showFolder(title: String, path: String) {
    let folder = FolderModel(path: path, queue: queue)
    let page = UIHostingController(rootView: FolderView(model: folder, shell: self))
    page.navigationItem.title = title
    page.navigationItem.largeTitleDisplayMode = .never
    page.navigationItem.rightBarButtonItem = newDocumentButton { [weak self] in
      self?.create(in: path)
    }
    let search = UISearchController(searchResultsController: nil)
    search.obscuresBackgroundDuringPresentation = false
    search.searchResultsUpdater = folder
    page.navigationItem.searchController = search
    page.navigationItem.hidesSearchBarWhenScrolling = false
    navigation.pushViewController(page, animated: true)
    folder.reload()
  }

  private func newDocumentButton(_ action: @escaping () -> Void) -> UIBarButtonItem {
    let item = UIBarButtonItem(
      systemItem: .compose, primaryAction: UIAction { _ in action() })
    item.accessibilityLabel = L10n.text("newDocument")
    return item
  }

  private func createInDefaultFolder() {
    queue.async {
      let folder = self.library.primaryFolder()
      DispatchQueue.main.async { self.create(in: canonicalPath(folder)) }
    }
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

  // MARK: Pickers

  private var picker: PickerDelegate?

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

  // MARK: Questions and errors

  var presenter: UIViewController {
    var top: UIViewController = navigation
    while let presented = top.presentedViewController { top = presented }
    return top
  }

  func report(_ error: Error) {
    let alert = UIAlertController(
      title: nil, message: L10n.text("failed", Failure.from(error).message), preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    presenter.present(alert, animated: true)
  }

  /// Asks for a new name for the item at `path`, then renames it.
  func askToRename(path: String, current: String, done: @escaping (String) -> Void) {
    let alert = UIAlertController(title: L10n.text("rename"), message: nil, preferredStyle: .alert)
    alert.addTextField { field in
      field.text = current
      field.placeholder = L10n.text("name")
      field.clearButtonMode = .whileEditing
    }
    alert.addAction(UIAlertAction(title: L10n.text("cancel"), style: .cancel))
    alert.addAction(
      UIAlertAction(title: L10n.text("rename"), style: .default) { [weak self, weak alert] _ in
        guard let self, let stem = alert?.textFields?.first?.text else { return }
        self.queue.async {
          do {
            let renamed = try FileAccess.rename(URL(fileURLWithPath: path), to: stem)
            DispatchQueue.main.async { done(canonicalPath(renamed)) }
          } catch {
            DispatchQueue.main.async { self.report(error) }
          }
        }
      })
    presenter.present(alert, animated: true)
  }

  /// Asks before deleting the item at `path`.
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
}

/// The editor page: the page's editor under a native navigation bar.
final class EditorViewController: UIViewController, UINavigationItemRenameDelegate {
  weak var shell: NativeShell?
  private let webView: WKWebView
  private var sourceMode = false

  init(webView: WKWebView) {
    self.webView = webView
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    navigationItem.largeTitleDisplayMode = .never
    if #available(iOS 16.0, *) {
      navigationItem.style = .editor
      navigationItem.renameDelegate = self
    }
    rebuildItems()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    guard webView.superview !== view else { return }
    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(webView)
    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isMovingFromParent { shell?.editorClosed() }
  }

  func conceal() {
    webView.alpha = 0
  }

  func reveal() {
    UIView.animate(withDuration: 0.2) { self.webView.alpha = 1 }
  }

  func update(title: String, sourceMode: Bool) {
    if navigationItem.title != title { navigationItem.title = title }
    if sourceMode != self.sourceMode {
      self.sourceMode = sourceMode
      rebuildItems()
    }
  }

  private func rebuildItems() {
    let act = { [weak self] (name: String) in self?.shell?.perform(name) }
    let menu = UIMenu(children: [
      UIMenu(
        options: .displayInline,
        children: [
          UIAction(title: L10n.text("share"), image: UIImage(systemName: "square.and.arrow.up")) {
            _ in act("share")
          },
          UIAction(title: L10n.text("exportPdf"), image: UIImage(systemName: "doc.richtext")) { _ in
            act("exportPdf")
          },
          UIAction(title: L10n.text("print"), image: UIImage(systemName: "printer")) { _ in
            act("print")
          },
        ]),
      UIMenu(
        options: .displayInline,
        children: [
          UIAction(title: L10n.text("outline"), image: UIImage(systemName: "list.bullet.indent")) {
            _ in act("outline")
          },
          UIAction(title: L10n.text("find"), image: UIImage(systemName: "magnifyingglass")) { _ in
            act("find")
          },
          UIAction(
            title: L10n.text("source"), image: UIImage(systemName: "chevron.left.forwardslash.chevron.right"),
            state: sourceMode ? .on : .off
          ) { _ in act("toggleSource") },
        ]),
      UIAction(title: L10n.text("settings"), image: UIImage(systemName: "gearshape")) { _ in
        act("settings")
      },
    ])
    let more = UIBarButtonItem(image: UIImage(systemName: "ellipsis.circle"), menu: menu)
    more.accessibilityLabel = L10n.text("more")
    let assistant = UIBarButtonItem(
      image: UIImage(systemName: "sparkles"), primaryAction: UIAction { _ in act("ai") })
    assistant.accessibilityLabel = L10n.text("ai")
    navigationItem.rightBarButtonItems = [more, assistant]
  }

  @available(iOS 16.0, *)
  func navigationItem(_ navigationItem: UINavigationItem, didEndRenamingWith title: String) {
    let stem = (title as NSString).deletingPathExtension
    shell?.send(["type": "rename", "stem": stem.isEmpty ? title : stem])
  }

  @available(iOS 16.0, *)
  func navigationItemShouldBeginRenaming(_ navigationItem: UINavigationItem) -> Bool {
    true
  }

  @available(iOS 16.0, *)
  func navigationItem(
    _ navigationItem: UINavigationItem, willBeginRenamingWith suggestedTitle: String,
    selectedRange: Range<String.Index>
  ) -> (String, Range<String.Index>) {
    let stem = (suggestedTitle as NSString).deletingPathExtension
    return (suggestedTitle, suggestedTitle.startIndex..<suggestedTitle.index(
      suggestedTitle.startIndex, offsetBy: stem.count))
  }
}

/// Finds the first responder through the responder chain, to have it ask for its input views again.
enum FirstResponder {
  fileprivate static weak var found: UIResponder?

  static func reloadInputViews() {
    found = nil
    UIApplication.shared.sendAction(#selector(UIResponder.nyamarkCaptureFirstResponder), to: nil, from: nil, for: nil)
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
