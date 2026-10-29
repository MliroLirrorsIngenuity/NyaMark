import UIKit

/// One key of the bar above the keyboard: an editor command, or text typed in source mode.
struct ToolbarKey {
  let id: String
  let symbol: String?
  let text: String?
  let label: String

  static func command(_ id: String, _ symbol: String, _ labelKey: String) -> ToolbarKey {
    ToolbarKey(id: id, symbol: symbol, text: nil, label: L10n.text(labelKey))
  }

  static func typing(_ text: String) -> ToolbarKey {
    ToolbarKey(id: "insert", symbol: nil, text: text, label: L10n.text("insert", text))
  }
}

/// The bar the system shows above the keyboard while the document is edited.
final class KeyboardToolbar: UIInputView {
  /// Runs a key; `text` is set for keys that type.
  var onKey: ((ToolbarKey) -> Void)?
  var onHideKeyboard: (() -> Void)?

  private let scroll = UIScrollView()
  private let stack = UIStackView()
  private var buttons: [String: UIButton] = [:]
  private var sourceMode = false
  private let haptics = UIImpactFeedbackGenerator(style: .light)

  private static let richKeys: [[ToolbarKey]] = [
    [
      .command("undo", "arrow.uturn.backward", "undo"),
      .command("redo", "arrow.uturn.forward", "redo"),
    ],
    [
      .command("heading", "textformat.size", "heading"),
      .command("bullet-list", "list.bullet", "bulletList"),
      .command("task-list", "checklist", "taskList"),
      .command("ordered-list", "list.number", "orderedList"),
      .command("indent", "increase.indent", "indent"),
      .command("outdent", "decrease.indent", "outdent"),
    ],
    [
      .command("bold", "bold", "bold"),
      .command("italic", "italic", "italic"),
      .command("strikethrough", "strikethrough", "strikethrough"),
      .command("code", "chevron.left.forwardslash.chevron.right", "code"),
      .command("link", "link", "link"),
    ],
    [
      .command("image", "photo", "image"),
      .command("table", "tablecells", "table"),
      .command("code-block", "curlybraces", "codeBlock"),
      .command("quote", "text.quote", "quote"),
      .command("hr", "minus", "divider"),
      .command("math", "function", "math"),
    ],
    [
      .command("caret-left", "arrow.left", "moveLeft"),
      .command("caret-right", "arrow.right", "moveRight"),
    ],
  ]

  private static let sourceKeys: [[ToolbarKey]] = [
    [
      .command("undo", "arrow.uturn.backward", "undo"),
      .command("redo", "arrow.uturn.forward", "redo"),
      .command("indent", "increase.indent", "indent"),
      .command("outdent", "decrease.indent", "outdent"),
    ],
    ["#", "*", "_", "`", "-", ">", "[", "]", "(", ")", "|", "!"].map(ToolbarKey.typing),
  ]

  init() {
    super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 48), inputViewStyle: .keyboard)
    allowsSelfSizing = true
    translatesAutoresizingMaskIntoConstraints = false

    scroll.showsHorizontalScrollIndicator = false
    scroll.alwaysBounceHorizontal = true
    scroll.translatesAutoresizingMaskIntoConstraints = false
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 2
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)

    let hide = UIButton(type: .system)
    hide.setImage(UIImage(systemName: "keyboard.chevron.compact.down"), for: .normal)
    hide.accessibilityLabel = L10n.text("hideKeyboard")
    hide.addAction(UIAction { [weak self] _ in self?.onHideKeyboard?() }, for: .touchUpInside)
    hide.translatesAutoresizingMaskIntoConstraints = false

    let divider = UIView()
    divider.backgroundColor = .separator
    divider.translatesAutoresizingMaskIntoConstraints = false

    addSubview(scroll)
    addSubview(divider)
    addSubview(hide)
    NSLayoutConstraint.activate([
      heightAnchor.constraint(equalToConstant: 48),
      scroll.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor),
      scroll.topAnchor.constraint(equalTo: topAnchor),
      scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
      scroll.trailingAnchor.constraint(equalTo: divider.leadingAnchor),
      divider.widthAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),
      divider.heightAnchor.constraint(equalToConstant: 24),
      divider.centerYAnchor.constraint(equalTo: centerYAnchor),
      divider.trailingAnchor.constraint(equalTo: hide.leadingAnchor),
      hide.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -4),
      hide.centerYAnchor.constraint(equalTo: centerYAnchor),
      hide.widthAnchor.constraint(equalToConstant: 48),
      hide.heightAnchor.constraint(equalToConstant: 44),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 6),
      stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -6),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
    ])
    rebuild()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  /// Shows the Markdown symbols in source mode and the formatting commands otherwise.
  func setSourceMode(_ on: Bool) {
    guard on != sourceMode else { return }
    sourceMode = on
    rebuild()
  }

  /// Highlights the commands that apply at the caret.
  func setActive(_ active: Set<String>) {
    for (id, button) in buttons {
      button.isSelected = active.contains(id)
    }
  }

  private func rebuild() {
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    buttons = [:]
    let groups = sourceMode ? Self.sourceKeys : Self.richKeys
    for (index, group) in groups.enumerated() {
      if index > 0 { stack.addArrangedSubview(spacer()) }
      for key in group { stack.addArrangedSubview(button(for: key)) }
    }
    scroll.setContentOffset(.zero, animated: false)
  }

  private func spacer() -> UIView {
    let view = UIView()
    view.translatesAutoresizingMaskIntoConstraints = false
    view.widthAnchor.constraint(equalToConstant: 10).isActive = true
    return view
  }

  private func button(for key: ToolbarKey) -> UIButton {
    var configuration = UIButton.Configuration.plain()
    configuration.cornerStyle = .medium
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8)
    if let symbol = key.symbol {
      configuration.image = UIImage(systemName: symbol)
      configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
        pointSize: 17, weight: .regular)
    } else if let text = key.text {
      var title = AttributedString(text)
      title.font = .monospacedSystemFont(ofSize: 18, weight: .medium)
      configuration.attributedTitle = title
    }
    let button = UIButton(configuration: configuration)
    button.configurationUpdateHandler = { button in
      var updated = button.configuration
      updated?.background.backgroundColor =
        button.isSelected ? UIColor.tintColor.withAlphaComponent(0.16) : .clear
      updated?.baseForegroundColor = button.isSelected ? .tintColor : .label
      button.configuration = updated
    }
    button.accessibilityLabel = key.label
    button.translatesAutoresizingMaskIntoConstraints = false
    button.widthAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
    button.heightAnchor.constraint(equalToConstant: 40).isActive = true
    button.addAction(
      UIAction { [weak self] _ in
        self?.haptics.impactOccurred()
        self?.onKey?(key)
      }, for: .touchUpInside)
    if key.text == nil { buttons[key.id] = button }
    return button
  }
}
