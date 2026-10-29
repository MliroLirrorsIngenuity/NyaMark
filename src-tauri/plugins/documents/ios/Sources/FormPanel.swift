import SwiftUI
import UIKit

// MARK: The form as the page describes it (`FormView` and what it holds in `form.ts`)

struct FormOption: Decodable, Equatable, Identifiable {
  let value: String
  let label: String
  let detail: String?

  var id: String { value }
}

struct FormAction: Decodable, Equatable, Identifiable {
  let id: String
  let label: String
  let destructive: Bool?
}

enum FormTone: String, Decodable { case muted, warning, error, success }

enum FormRole: String, Decodable { case normal, primary, destructive }

enum FormInput: String, Decodable { case text, url, email, code }

/// The `value` of a row: a switch, a number or a string, whichever its kind carries.
enum FormValue: Decodable, Equatable {
  case flag(Bool)
  case number(Double)
  case text(String)

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let flag = try? container.decode(Bool.self) {
      self = .flag(flag)
    } else if let number = try? container.decode(Double.self) {
      self = .number(number)
    } else {
      self = .text(try container.decode(String.self))
    }
  }
}

/// One row of a section; the fields set depend on `kind`.
struct FormRow: Decodable, Equatable, Identifiable {
  enum Kind: String, Decodable {
    case toggle, choice, cards, number, slider, text, button, value, note, link, item
  }

  let id: String
  let kind: Kind
  let label: String?
  let title: String?
  let text: String?
  let detail: String?
  let value: FormValue?
  let options: [FormOption]?
  let placeholder: String?
  let disabled: Bool?
  let min: Double?
  let max: Double?
  let step: Double?
  let unit: String?
  let valueText: String?
  let secure: Bool?
  let multiline: Bool?
  let input: FormInput?
  let error: String?
  let role: FormRole?
  let busy: Bool?
  let tone: FormTone?
  let external: Bool?
  let badge: String?
  let toggle: Bool?
  let actions: [FormAction]?

  var flag: Bool {
    if case .flag(let on) = value { return on }
    return false
  }

  var number: Double {
    if case .number(let number) = value { return number }
    return 0
  }

  var string: String? {
    if case .text(let text) = value { return text }
    return nil
  }

  var isDisabled: Bool { disabled ?? false }
}

struct FormSection: Decodable, Equatable, Identifiable {
  let id: String
  let title: String?
  let footer: String?
  let rows: [FormRow]
}

struct FormButton: Decodable, Equatable {
  let id: String
  let label: String
  let role: FormRole?
  let disabled: Bool?
}

struct FormTabSet: Decodable, Equatable {
  let value: String
  let options: [FormOption]
}

struct FormPage: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let leading: FormButton?
  let trailing: FormButton?
  let tabs: FormTabSet?
  let sections: [FormSection]
  let footer: FormButton?
}

/// Everything one `show` carries: the pages of the stack from the first to the one on top.
struct FormContent: Decodable, Equatable {
  enum Height: String, Decodable { case medium, large }

  let pages: [FormPage]
  let height: Height
  let dismissible: Bool

  /// Reads the `view` of a `show` message; nil when it holds no page or is malformed.
  init?(json: Any?) {
    guard let json, JSONSerialization.isValidJSONObject(json),
      let data = try? JSONSerialization.data(withJSONObject: json),
      let content = try? JSONDecoder().decode(FormContent.self, from: data),
      !content.pages.isEmpty
    else { return nil }
    self = content
  }
}

// MARK: Page state and what the user does on it

/// What one page shows; it is published into, so the page's controller and its fields' focus stay.
final class FormPageModel: ObservableObject {
  @Published var page: FormPage

  init(_ page: FormPage) {
    self.page = page
  }
}

/// What the user does on one page, told to the page's side of the form.
struct FormEmitter {
  let page: String
  let tell: (String, [String: Any]) -> Void

  func change(_ id: String, _ value: Any) {
    tell("change", ["page": page, "id": id, "value": value])
  }

  func press(_ id: String) {
    tell("press", ["page": page, "id": id])
  }

  func open(_ id: String) {
    tell("open", ["page": page, "id": id])
  }

  func action(_ id: String, _ action: String) {
    tell("action", ["page": page, "id": id, "action": action])
  }

  func tab(_ value: String) {
    tell("tab", ["page": page, "value": value])
  }
}

// MARK: The panel

/// The forms the page asks for, each a sheet of natively drawn pages.
final class FormPanelController: NativePanel {
  private unowned let shell: NativeShell
  private var sheets: [String: FormSheet] = [:]
  /// Sheets on their way out, which a new sheet waits for.
  private var closing = 0
  private var waiting: [() -> Void] = []

  init(shell: NativeShell) {
    self.shell = shell
  }

  func open(_ body: [String: Any]) {
    guard let name = body["form"] as? String else { return }
    shell.tell("form", "launch", ["form": name])
  }

  func receive(_ op: String, _ body: [String: Any]) {
    guard let name = body["form"] as? String else { return }
    switch op {
    case "show":
      show(name, body["view"])
    case "hide":
      hide(name)
    case "alert":
      alert(name, body)
    default:
      break
    }
  }

  private func show(_ name: String, _ json: Any?) {
    guard let content = FormContent(json: json) else { return }
    if let sheet = sheets[name] {
      sheet.update(content)
      return
    }
    let sheet = FormSheet(name: name, content: content) { [weak self] op, data in
      var message = data
      message["form"] = name
      self?.shell.tell("form", op, message)
    }
    sheets[name] = sheet
    present(sheet)
  }

  private func present(_ sheet: FormSheet) {
    guard closing == 0 else {
      waiting.append { [weak self, weak sheet] in
        guard let self, let sheet, self.sheets[sheet.name] === sheet else { return }
        self.present(sheet)
      }
      return
    }
    sheet.present(from: shell.presenter) { [weak self, weak sheet] in
      guard let self, let sheet, self.sheets[sheet.name] === sheet else { return }
      self.sheets[sheet.name] = nil
      sheet.emit("dismiss", [:])
    }
  }

  private func hide(_ name: String) {
    guard let sheet = sheets.removeValue(forKey: name), let host = sheet.host else { return }
    closing += 1
    PanelSheet.close(host) { [weak self] in
      guard let self else { return }
      self.closing -= 1
      guard self.closing == 0 else { return }
      let queued = self.waiting
      self.waiting = []
      queued.forEach { $0() }
    }
  }

  private func alert(_ name: String, _ body: [String: Any]) {
    guard let reply = body["reply"] as? String, let title = body["title"] as? String else { return }
    let alert = UIAlertController(
      title: title, message: body["message"] as? String, preferredStyle: .alert)
    for action in body["actions"] as? [[String: Any]] ?? [] {
      guard let id = action["id"] as? String, let label = action["label"] as? String else {
        continue
      }
      alert.addAction(
        UIAlertAction(title: label, style: Self.style(action["role"] as? String)) { [weak self] _ in
          self?.shell.tell("form", "reply", ["form": name, "reply": reply, "value": id])
        })
    }
    var top = sheets[name]?.host ?? shell.presenter
    while let next = top.presentedViewController { top = next }
    top.present(alert, animated: true)
  }

  private static func style(_ role: String?) -> UIAlertAction.Style {
    switch role {
    case "cancel": return .cancel
    case "destructive": return .destructive
    default: return .default
    }
  }
}

// MARK: One form's sheet

/// A page of the stack, kept by id so the stack can be matched against what the page sends.
final class FormPageHost: UIHostingController<FormPageView> {
  let pageID: String

  init(pageID: String, rootView: FormPageView) {
    self.pageID = pageID
    super.init(rootView: rootView)
    view.backgroundColor = .clear
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }
}

/// A navigation stack without a bar that still goes back with a swipe from the edge.
final class FormNavigationController: UINavigationController, UIGestureRecognizerDelegate {
  override func viewDidLoad() {
    super.viewDidLoad()
    interactivePopGestureRecognizer?.delegate = self
  }

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    viewControllers.count > 1 && transitionCoordinator == nil
  }
}

/// Puts the stack inside the sheet's hosting controller.
struct FormNavigation: UIViewControllerRepresentable {
  let controller: UINavigationController

  func makeUIViewController(context: Context) -> UINavigationController { controller }

  func updateUIViewController(_ controller: UINavigationController, context: Context) {}
}

/// One form's sheet: the pages as a stack, matched against every `show`.
final class FormSheet: NSObject, UINavigationControllerDelegate {
  let name: String
  private(set) var host: UIViewController?
  private let navigation = FormNavigationController()
  private let tell: (String, [String: Any]) -> Void
  private var models: [String: FormPageModel] = [:]
  /// The page ids the stack holds, to tell a swipe back from a change the page asked for.
  private var known: [String] = []
  private var transitioning = false
  /// A `show` that came during a transition; the stack follows it once the transition ends.
  private var deferred: FormContent?
  private var height: FormContent.Height
  private var dismissible: Bool

  init(name: String, content: FormContent, emit: @escaping (String, [String: Any]) -> Void) {
    self.name = name
    tell = emit
    height = content.height
    dismissible = content.dismissible
    super.init()
    navigation.delegate = self
    navigation.setNavigationBarHidden(true, animated: false)
    navigation.view.backgroundColor = .clear
    reconcile(content)
  }

  func emit(_ op: String, _ data: [String: Any]) {
    tell(op, data)
  }

  func present(from presenter: UIViewController, dismissed: @escaping () -> Void) {
    let heights: [PanelHeight] = height == .medium ? [.medium, .large] : [.large]
    let host = PanelSheet.present(
      FormNavigation(controller: navigation).ignoresSafeArea(.container, edges: .bottom),
      from: presenter, heights: heights, dismissed: dismissed)
    host.isModalInPresentation = !dismissible
    self.host = host
  }

  func update(_ content: FormContent) {
    for page in content.pages {
      if let model = models[page.id], model.page != page { model.page = page }
    }
    dismissible = content.dismissible
    host?.isModalInPresentation = !dismissible
    resize(to: content.height)
    if transitioning {
      deferred = content
    } else {
      reconcile(content)
    }
  }

  private func resize(to next: FormContent.Height) {
    guard next != height else { return }
    height = next
    guard let sheet = host?.sheetPresentationController else { return }
    sheet.animateChanges {
      sheet.detents = next == .medium ? [.medium(), .large()] : [.large()]
      if next == .large { sheet.selectedDetentIdentifier = .large }
    }
  }

  /// Makes the stack hold the pages of `content`, popping and pushing only where they differ.
  private func reconcile(_ content: FormContent) {
    let wanted = content.pages.map(\.id)
    guard wanted != known else { return }
    let current = navigation.viewControllers
    let kept = zip(current, wanted).prefix { ($0 as? FormPageHost)?.pageID == $1 }.count
    var stack = Array(current.prefix(kept))
    for (index, page) in content.pages.enumerated().dropFirst(kept) {
      let model = FormPageModel(page)
      models[page.id] = model
      stack.append(
        FormPageHost(
          pageID: page.id,
          rootView: FormPageView(
            model: model, first: index == 0,
            send: FormEmitter(page: page.id, tell: tell),
            back: { [weak self] in self?.goBack(from: page.id) })))
    }
    models = models.filter { wanted.contains($0.key) }
    known = wanted
    navigation.setViewControllers(
      stack, animated: !current.isEmpty && navigation.viewIfLoaded?.window != nil)
  }

  private func goBack(from id: String) {
    guard known.count > 1, known.last == id, !transitioning else { return }
    known.removeLast()
    navigation.popViewController(animated: true)
    tell("back", ["page": id])
  }

  // MARK: UINavigationControllerDelegate

  /// Fades the page that leaves out while the next fades in.
  func navigationController(
    _ navigationController: UINavigationController, willShow viewController: UIViewController,
    animated: Bool
  ) {
    transitioning = animated
    guard animated, let coordinator = navigationController.transitionCoordinator,
      let from = coordinator.viewController(forKey: .from)?.view,
      let to = coordinator.viewController(forKey: .to)?.view
    else { return }
    to.alpha = 0
    coordinator.animate(
      alongsideTransition: { _ in
        from.alpha = 0
        to.alpha = 1
      },
      completion: { _ in
        from.alpha = 1
        to.alpha = 1
      })
  }

  func navigationController(
    _ navigationController: UINavigationController, didShow viewController: UIViewController,
    animated: Bool
  ) {
    transitioning = false
    let shown = navigationController.viewControllers.compactMap { ($0 as? FormPageHost)?.pageID }
    if shown != known {
      for id in known.reversed() where !shown.contains(id) { tell("back", ["page": id]) }
      known = shown
      deferred = nil
    } else if let content = deferred {
      deferred = nil
      reconcile(content)
    }
  }
}
