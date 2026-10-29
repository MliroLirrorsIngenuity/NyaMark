import SwiftUI
import UIKit

private let tapHaptics = UIImpactFeedbackGenerator(style: .light)

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
  @Published var labels = FindLabels()
  /// Raised to have the find field take the keyboard and select its text.
  @Published var focusFind = 0
  @Published var focusReplace = 0
}

/// The find bar, as the page's `.ny-search` showed it on a phone: floating under the title bar, over the document.
final class FindPanelController: NativePanel {
  private unowned let shell: NativeShell
  private let model = FindModel()
  private var bar: UIViewController?
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

  /// Takes the bar away and has the page end its search.
  func close() {
    guard let bar else { return }
    shell.editorPage.view.endEditing(true)
    bar.willMove(toParent: nil)
    bar.view.removeFromSuperview()
    bar.removeFromParent()
    self.bar = nil
    model.replaceShown = false
    shell.tell("find", "close")
  }

  private func show() {
    guard bar == nil else { return }
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

  /// Hangs `bar` 56 points under the top, 16 points from the sides or the safe area, whichever is farther.
  private func pin(_ bar: UIView, in page: UIView) {
    let safe = page.safeAreaLayoutGuide
    let leading = bar.leadingAnchor.constraint(equalTo: page.leadingAnchor, constant: 16)
    let trailing = bar.trailingAnchor.constraint(equalTo: page.trailingAnchor, constant: -16)
    leading.priority = .defaultLow
    trailing.priority = .defaultLow
    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: safe.topAnchor, constant: 56),
      bar.leadingAnchor.constraint(greaterThanOrEqualTo: page.leadingAnchor, constant: 16),
      bar.leadingAnchor.constraint(greaterThanOrEqualTo: safe.leadingAnchor),
      bar.trailingAnchor.constraint(lessThanOrEqualTo: page.trailingAnchor, constant: -16),
      bar.trailingAnchor.constraint(lessThanOrEqualTo: safe.trailingAnchor),
      leading, trailing,
    ])
  }
}

/// Two rows of the page's `.ny-search`, and the replace row of the source pane behind its toggle.
struct FindBar: View {
  @ObservedObject var model: FindModel
  @ObservedObject private var theme = Theme.shared
  let send: (String, [String: Any]) -> Void
  let close: () -> Void
  @State private var appeared = false

  var body: some View {
    VStack(spacing: 6) {
      HStack(spacing: 6) {
        if model.source {
          iconButton("chevron.right", model.labels.toggleReplace, turned: model.replaceShown) {
            withAnimation(.easeOut(duration: 0.15)) { model.replaceShown.toggle() }
            if model.replaceShown {
              model.focusReplace += 1
            } else {
              model.focusFind += 1
            }
          }
        }
        field(
          $model.query, model.labels.placeholder, returnKey: .search, focus: model.focusFind,
          committedOnly: true,
          changed: { send("query", ["text": $0]) },
          submit: { send("next", [:]) })
        iconButton("xmark", model.labels.close, run: close)
      }
      HStack(spacing: 6) {
        Text(model.count)
          .font(.system(size: 13).monospacedDigit())
          .foregroundStyle(theme.color("text-muted"))
          .lineLimit(1)
          .padding(.leading, 12)
          .frame(maxWidth: .infinity, alignment: .leading)
        iconButton("chevron.up", model.labels.prev) { send("prev", [:]) }
        iconButton("chevron.down", model.labels.next) { send("next", [:]) }
      }
      if model.source && model.replaceShown {
        VStack(spacing: 6) {
          field(
            $model.replacement, model.labels.replacePlaceholder, returnKey: .done,
            focus: model.focusReplace, committedOnly: false, changed: { _ in },
            submit: { send("replace", ["text": model.replacement]) })
          HStack(spacing: 6) {
            textButton(model.labels.replace) { send("replace", ["text": model.replacement]) }
            textButton(model.labels.replaceAll) { send("replaceAll", ["text": model.replacement]) }
            Spacer(minLength: 0)
          }
        }
      }
    }
    .padding(8)
    .glassCard()
    .barShadow()
    .opacity(appeared ? 1 : 0)
    .offset(y: appeared ? 0 : -8)
    .onAppear { withAnimation(.easeOut(duration: 0.15)) { appeared = true } }
  }

  private func field(
    _ text: Binding<String>, _ placeholder: String, returnKey: UIReturnKeyType, focus: Int,
    committedOnly: Bool, changed: @escaping (String) -> Void, submit: @escaping () -> Void
  ) -> some View {
    FindField(
      text: text, placeholder: placeholder, returnKey: returnKey, focus: focus,
      committedOnly: committedOnly, changed: changed, submit: submit
    )
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity, minHeight: 44, maxHeight: 44)
    .background(
      RoundedRectangle(cornerRadius: 16, style: .continuous).fill(theme.color("fill-soft")))
  }

  private func iconButton(
    _ symbol: String, _ label: String, turned: Bool = false, run: @escaping () -> Void
  ) -> some View {
    Button {
      tapHaptics.impactOccurred()
      run()
    } label: {
      Image(systemName: symbol)
        .font(.system(size: 17, weight: .medium))
        .rotationEffect(.degrees(turned ? 90 : 0))
        .frame(width: 44, height: 44)
        .contentShape(Circle())
    }
    .buttonStyle(FindButtonStyle())
    .accessibilityLabel(label)
  }

  private func textButton(_ title: String, run: @escaping () -> Void) -> some View {
    Button {
      tapHaptics.impactOccurred()
      run()
    } label: {
      Text(title)
        .font(.system(size: 15))
        .lineLimit(1)
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .contentShape(Capsule())
    }
    .buttonStyle(FindButtonStyle(ink: "text-secondary"))
  }
}

/// A round or pill button of the find bar: a soft fill, the accent while pressed.
struct FindButtonStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared
  var ink = "text-primary"

  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    return configuration.label
      .foregroundStyle(pressed ? theme.color("accent-ink") : theme.color(ink))
      .background(Capsule().fill(pressed ? theme.color("accent-soft") : theme.color("fill-soft")))
      .animation(.easeOut(duration: 0.1), value: pressed)
  }
}

/// A single-line field that sends its text as it changes, leaving out what an input method is still composing when `committedOnly`.
struct FindField: UIViewRepresentable {
  @ObservedObject private var theme = Theme.shared
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
    field.font = .systemFont(ofSize: 16)
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return field
  }

  func updateUIView(_ field: UITextField, context: Context) {
    context.coordinator.parent = self
    field.textColor = theme.ui("text-primary")
    field.attributedPlaceholder = NSAttributedString(
      string: placeholder, attributes: [.foregroundColor: theme.ui("text-muted")])
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

    func textFieldShouldReturn(_ field: UITextField) -> Bool {
      parent.submit()
      return false
    }
  }
}
