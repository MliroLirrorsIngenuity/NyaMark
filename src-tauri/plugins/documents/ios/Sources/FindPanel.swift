import SwiftUI
import UIKit

/// The words on the find bar; the page sends them in its language.
struct FindLabels: Equatable {
  var placeholder = ""
  var next = ""
  var prev = ""
  var close = ""
  var toggleReplace = ""
  var replacePlaceholder = ""
  var replace = ""
  var replaceAll = ""

  init() {}

  init(_ body: [String: Any]) {
    func word(_ key: String) -> String { body[key] as? String ?? "" }
    placeholder = word("placeholder")
    next = word("next")
    prev = word("prev")
    close = word("close")
    toggleReplace = word("toggleReplace")
    replacePlaceholder = word("replacePlaceholder")
    replace = word("replace")
    replaceAll = word("replaceAll")
  }
}

/// What the find bar shows and the fields hold.
final class FindModel: ObservableObject {
  @Published var query = ""
  @Published var replacement = ""
  @Published var count = ""
  /// The source pane is being searched, which can replace.
  @Published var source = false
  @Published var replaceShown = false
  /// The bar is in place; false while it comes in or goes out.
  @Published var shown = false
  @Published var labels = FindLabels()
  /// Raised to have the find field take the keyboard and select its text.
  @Published var focusFind = 0
  @Published var focusReplace = 0
}

/// The find bar: glass capsules floating under the editor's navigation bar, over the document.
final class FindPanelController: NativePanel {
  private static let goingOut: TimeInterval = 0.4

  private unowned let shell: NativeShell
  private let model = FindModel()
  private var bar: UIViewController?
  private var removal: DispatchWorkItem?
  /// The page answers an open with the query to show; later states leave the field to the user.
  private var awaitingQuery = false

  init(shell: NativeShell) {
    self.shell = shell
  }

  func open(_ body: [String: Any]) {
    show()
    awaitingQuery = true
    model.focusFind += 1
    shell.tell("find", "open")
  }

  func receive(_ op: String, _ body: [String: Any]) {
    guard op == "state" else { return }
    model.labels = FindLabels(body["labels"] as? [String: Any] ?? [:])
    model.count = body["count"] as? String ?? ""
    model.source = body["source"] as? Bool ?? false
    if awaitingQuery {
      awaitingQuery = false
      model.query = body["query"] as? String ?? ""
      model.focusFind += 1
    }
  }

  /// Has the bar go out and the page end its search.
  func close() {
    guard bar != nil, removal == nil else { return }
    shell.editorPage.view.endEditing(true)
    withAnimation(.spring()) { model.shown = false }
    let item = DispatchWorkItem { [weak self] in self?.remove() }
    removal = item
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.goingOut, execute: item)
    shell.tell("find", "close")
  }

  private func show() {
    removal?.cancel()
    removal = nil
    if bar != nil {
      withAnimation(.spring()) { model.shown = true }
      return
    }
    let controller = UIHostingController(
      rootView: FindBar(
        model: model,
        send: { [weak self] op, data in self?.shell.tell("find", op, data) },
        close: { [weak self] in self?.close() }))
    controller.view.backgroundColor = .clear
    controller.view.translatesAutoresizingMaskIntoConstraints = false
    let page = shell.editorPage
    page.addChild(controller)
    page.view.addSubview(controller.view)
    controller.didMove(toParent: page)
    pin(controller.view, in: page.view)
    bar = controller
  }

  private func remove() {
    guard let bar else { return }
    bar.willMove(toParent: nil)
    bar.view.removeFromSuperview()
    bar.removeFromParent()
    self.bar = nil
    removal = nil
    model.shown = false
    model.replaceShown = false
  }

  /// Hangs `bar` 8 points under the page's top safe area, 16 points from the sides or the safe area, whichever is farther.
  private func pin(_ bar: UIView, in page: UIView) {
    let safe = page.safeAreaLayoutGuide
    let leading = bar.leadingAnchor.constraint(equalTo: page.leadingAnchor, constant: 16)
    let trailing = bar.trailingAnchor.constraint(equalTo: page.trailingAnchor, constant: -16)
    leading.priority = .defaultHigh
    trailing.priority = .defaultHigh
    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
      bar.leadingAnchor.constraint(greaterThanOrEqualTo: page.leadingAnchor, constant: 16),
      bar.leadingAnchor.constraint(greaterThanOrEqualTo: safe.leadingAnchor),
      bar.trailingAnchor.constraint(lessThanOrEqualTo: page.trailingAnchor, constant: -16),
      bar.trailingAnchor.constraint(lessThanOrEqualTo: safe.trailingAnchor),
      leading, trailing,
    ])
  }
}

/// The find row of glass, and under it the replace row of the source pane behind its toggle.
struct FindBar: View {
  @ObservedObject var model: FindModel
  @ObservedObject private var theme = Theme.shared
  let send: (String, [String: Any]) -> Void
  let close: () -> Void

  var body: some View {
    GlassGroup(spacing: 8) {
      VStack(spacing: 10) {
        findRow
        if model.source && model.replaceShown { replaceRow }
      }
    }
    .opacity(model.shown ? 1 : 0)
    .offset(y: model.shown ? 0 : -12)
    .allowsHitTesting(model.shown)
    .onAppear { withAnimation(.spring()) { model.shown = true } }
  }

  private var findRow: some View {
    HStack(spacing: 4) {
      if model.source { replaceToggle }
      field(
        $model.query, model.labels.placeholder, symbol: "magnifyingglass", count: model.count,
        returnKey: .search, focus: model.focusFind, committedOnly: true,
        changed: { send("query", ["text": $0]) },
        submit: { send("next", [:]) })
      iconButton("chevron.up", model.labels.prev) { send("prev", [:]) }
      iconButton("chevron.down", model.labels.next) { send("next", [:]) }
      closeButton
    }
    .padding(4)
    .glass(Capsule())
  }

  private var replaceRow: some View {
    HStack(spacing: 4) {
      field(
        $model.replacement, model.labels.replacePlaceholder, symbol: nil, count: "",
        returnKey: .done, focus: model.focusReplace, committedOnly: false, changed: { _ in },
        submit: { send("replace", ["text": model.replacement]) })
      Button(model.labels.replace) { send("replace", ["text": model.replacement]) }
        .lineLimit(1)
        .glassButton()
      Button(model.labels.replaceAll) { send("replaceAll", ["text": model.replacement]) }
        .lineLimit(1)
        .prominentGlassButton()
    }
    .padding(4)
    .glass(Capsule())
  }

  private var replaceToggle: some View {
    Button {
      withAnimation(.spring()) { model.replaceShown.toggle() }
      if model.replaceShown {
        model.focusReplace += 1
      } else {
        model.focusFind += 1
      }
    } label: {
      Image(systemName: "arrow.2.squarepath")
        .frame(width: 22, height: 22)
        .foregroundStyle(model.replaceShown ? theme.color("accent") : Color.primary)
    }
    .glassButton()
    .circleBorder()
    .accessibilityLabel(model.labels.toggleReplace)
    .accessibilityAddTraits(model.replaceShown ? .isSelected : [])
  }

  @ViewBuilder
  private var closeButton: some View {
    iconButton("xmark", model.labels.close, run: close)
  }

  /// The system search field's look: a tertiary fill capsule holding the symbol, the text, and the count.
  private func field(
    _ text: Binding<String>, _ placeholder: String, symbol: String?, count: String,
    returnKey: UIReturnKeyType, focus: Int, committedOnly: Bool,
    changed: @escaping (String) -> Void, submit: @escaping () -> Void
  ) -> some View {
    HStack(spacing: 6) {
      if let symbol {
        Image(systemName: symbol).foregroundStyle(.secondary)
      }
      FindField(
        text: text, placeholder: placeholder, returnKey: returnKey, focus: focus,
        committedOnly: committedOnly, changed: changed, submit: submit
      )
      .frame(maxWidth: .infinity)
      if !count.isEmpty {
        Text(count)
          .font(.footnote.monospacedDigit())
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .fixedSize()
      }
    }
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity, minHeight: 40, maxHeight: 40)
    .background(Capsule().fill(Color(.tertiarySystemFill)))
  }

  private func iconButton(_ symbol: String, _ label: String, run: @escaping () -> Void)
    -> some View
  {
    Button(action: run) {
      Image(systemName: symbol).frame(width: 22, height: 22)
    }
    .glassButton()
    .circleBorder()
    .accessibilityLabel(label)
  }
}

private extension View {
  /// Round buttons, from the iOS that has the circle border shape.
  @ViewBuilder
  func circleBorder() -> some View {
    if #available(iOS 17.0, *) {
      buttonBorderShape(.circle)
    } else {
      self
    }
  }
}

/// A single-line field that sends its text as it changes, leaving out what an input method is still composing when `committedOnly`.
struct FindField: UIViewRepresentable {
  @Binding var text: String
  let placeholder: String
  let returnKey: UIReturnKeyType
  /// Raised to have the field take the keyboard and select its text.
  let focus: Int
  let committedOnly: Bool
  let changed: (String) -> Void
  let submit: () -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  func makeUIView(context: Context) -> UITextField {
    let field = UITextField()
    field.delegate = context.coordinator
    field.addTarget(
      context.coordinator, action: #selector(Coordinator.edited(_:)), for: .editingChanged)
    field.autocorrectionType = .no
    field.autocapitalizationType = .none
    field.spellCheckingType = .no
    field.smartQuotesType = .no
    field.smartDashesType = .no
    field.smartInsertDeleteType = .no
    field.returnKeyType = returnKey
    field.clearButtonMode = .always
    field.font = .preferredFont(forTextStyle: .body)
    field.adjustsFontForContentSizeCategory = true
    field.textColor = .label
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return field
  }

  func updateUIView(_ field: UITextField, context: Context) {
    context.coordinator.parent = self
    field.attributedPlaceholder = NSAttributedString(
      string: placeholder, attributes: [.foregroundColor: UIColor.placeholderText])
    field.accessibilityLabel = placeholder
    if field.markedTextRange == nil, field.text != text { field.text = text }
    if context.coordinator.focus != focus {
      context.coordinator.focus = focus
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
        field.becomeFirstResponder()
        field.selectedTextRange = field.textRange(
          from: field.beginningOfDocument, to: field.endOfDocument)
      }
    }
  }

  final class Coordinator: NSObject, UITextFieldDelegate {
    var parent: FindField
    var focus = 0

    init(_ parent: FindField) {
      self.parent = parent
    }

    @objc func edited(_ field: UITextField) {
      if parent.committedOnly && field.markedTextRange != nil { return }
      let text = field.text ?? ""
      parent.text = text
      parent.changed(text)
    }

    func textFieldShouldClear(_ field: UITextField) -> Bool {
      parent.text = ""
      parent.changed("")
      return true
    }

    func textFieldShouldReturn(_ field: UITextField) -> Bool {
      parent.submit()
      return false
    }
  }
}
