import Combine
import UIKit

/// One key of the bar above the keyboard: an editor command, or text typed in source mode.
struct ToolbarKey {
  let id: String
  let symbol: String?
  /// Typed into the source pane; such a key runs no command.
  let text: String?
  /// Drawn in place of a symbol, as the heading key's H.
  var glyph: String? = nil
  let label: String

  static func command(_ id: String, _ symbol: String, _ labelKey: String) -> ToolbarKey {
    ToolbarKey(id: id, symbol: symbol, text: nil, label: L10n.text(labelKey))
  }

  static func command(_ id: String, glyph: String, _ labelKey: String) -> ToolbarKey {
    ToolbarKey(id: id, symbol: nil, text: nil, glyph: glyph, label: L10n.text(labelKey))
  }

  static func typing(_ text: String) -> ToolbarKey {
    ToolbarKey(id: "insert", symbol: nil, text: text, label: L10n.text("insert", text))
  }
}

/// The format bar floating above the keyboard and the round button that hides it, as the page drew them.
final class KeyboardToolbar: UIView {
  var onKey: ((ToolbarKey) -> Void)?
  var onHideKeyboard: (() -> Void)?

  private static let barHeight: CGFloat = 56
  private static let gap: CGFloat = 8

  private let pill = UIView()
  private let scroll = UIScrollView()
  private let stack = UIStackView()
  private let hide = UIButton(type: .custom)
  private var buttons: [String: UIButton] = [:]
  private var dividers: [UIView] = []
  private var active: Set<String> = []
  private var sourceMode = false
  private let haptics = UIImpactFeedbackGenerator(style: .light)
  private var themeWatch: AnyCancellable?

  private static let richKeys: [[ToolbarKey]] = [
    [
      .command("undo", "arrow.uturn.backward", "undo"),
      .command("redo", "arrow.uturn.forward", "redo"),
    ],
    [
      .command("heading", glyph: "H", "heading"),
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
    super.init(frame: CGRect(x: 0, y: 0, width: 0, height: Self.barHeight + Self.gap))
    autoresizingMask = .flexibleWidth
    backgroundColor = .clear

    pill.layer.cornerRadius = Theme.radius
    pill.layer.cornerCurve = .continuous
    pill.layer.borderWidth = 1
    pill.layer.applyBarShadow()
    pill.translatesAutoresizingMaskIntoConstraints = false

    scroll.showsHorizontalScrollIndicator = false
    scroll.alwaysBounceHorizontal = true
    scroll.layer.cornerRadius = Theme.radius
    scroll.layer.cornerCurve = .continuous
    scroll.translatesAutoresizingMaskIntoConstraints = false
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 2
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    pill.addSubview(scroll)

    hide.setImage(
      UIImage(
        systemName: "keyboard.chevron.compact.down",
        withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)),
      for: .normal)
    hide.accessibilityLabel = L10n.text("hideKeyboard")
    hide.layer.cornerRadius = 22
    hide.layer.borderWidth = 1
    hide.layer.applyBarShadow()
    hide.addAction(
      UIAction { [weak self] _ in
        self?.haptics.impactOccurred()
        self?.onHideKeyboard?()
      }, for: .touchUpInside)
    hide.translatesAutoresizingMaskIntoConstraints = false

    addSubview(pill)
    addSubview(hide)
    NSLayoutConstraint.activate([
      pill.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 16),
      pill.topAnchor.constraint(equalTo: topAnchor),
      pill.heightAnchor.constraint(equalToConstant: Self.barHeight),
      pill.trailingAnchor.constraint(equalTo: hide.leadingAnchor, constant: -12),
      hide.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -16),
      hide.centerYAnchor.constraint(equalTo: pill.centerYAnchor),
      hide.widthAnchor.constraint(equalToConstant: 44),
      hide.heightAnchor.constraint(equalToConstant: 44),
      scroll.leadingAnchor.constraint(equalTo: pill.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: pill.trailingAnchor),
      scroll.topAnchor.constraint(equalTo: pill.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: pill.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 5),
      stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -5),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
    ])
    rebuild()
    themeWatch = Theme.shared.$colors.sink { [weak self] _ in
      DispatchQueue.main.async { self?.paint() }
    }
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: Self.barHeight + Self.gap)
  }

  /// Shows the Markdown symbols in source mode and the formatting commands otherwise.
  func setSourceMode(_ on: Bool) {
    guard on != sourceMode else { return }
    sourceMode = on
    rebuild()
  }

  /// Highlights the commands that apply at the caret.
  func setActive(_ keys: Set<String>) {
    guard keys != active else { return }
    active = keys
    for (id, button) in buttons { button.isSelected = keys.contains(id) }
  }

  private func paint() {
    let theme = Theme.shared
    pill.backgroundColor = theme.ui("statusbar-bg")
    pill.layer.borderColor = theme.ui("border-soft").cgColor
    hide.backgroundColor = theme.ui("statusbar-bg")
    hide.layer.borderColor = theme.ui("border-soft").cgColor
    hide.tintColor = theme.ui("text-primary")
    dividers.forEach { $0.backgroundColor = theme.ui("border-soft") }
    buttons.values.forEach { $0.setNeedsUpdateConfiguration() }
    stack.arrangedSubviews.compactMap { $0 as? UIButton }.forEach { $0.setNeedsUpdateConfiguration() }
  }

  private func rebuild() {
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    buttons = [:]
    dividers = []
    let groups = sourceMode ? Self.sourceKeys : Self.richKeys
    for (index, group) in groups.enumerated() {
      if index > 0 { stack.addArrangedSubview(divider()) }
      for key in group { stack.addArrangedSubview(button(for: key)) }
    }
    scroll.setContentOffset(.zero, animated: false)
    paint()
  }

  private func divider() -> UIView {
    let box = UIView()
    let line = UIView()
    line.translatesAutoresizingMaskIntoConstraints = false
    box.addSubview(line)
    NSLayoutConstraint.activate([
      box.widthAnchor.constraint(equalToConstant: 10),
      box.heightAnchor.constraint(equalToConstant: 44),
      line.widthAnchor.constraint(equalToConstant: 1),
      line.heightAnchor.constraint(equalToConstant: 16),
      line.centerXAnchor.constraint(equalTo: box.centerXAnchor),
      line.centerYAnchor.constraint(equalTo: box.centerYAnchor),
    ])
    dividers.append(line)
    return box
  }

  private func button(for key: ToolbarKey) -> UIButton {
    var configuration = UIButton.Configuration.plain()
    configuration.contentInsets = .zero
    configuration.background.cornerRadius = Theme.controlRadius
    if let symbol = key.symbol {
      configuration.image = UIImage(systemName: symbol)
      configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
        pointSize: 17, weight: .regular)
    } else if let glyph = key.glyph {
      var title = AttributedString(glyph)
      title.font = UIFont.systemFont(ofSize: 19, weight: .medium)
      configuration.attributedTitle = title
    } else if let text = key.text {
      var title = AttributedString(text)
      title.font = UIFont.monospacedSystemFont(ofSize: 18, weight: .medium)
      configuration.attributedTitle = title
    }
    let button = UIButton(configuration: configuration)
    button.configurationUpdateHandler = { button in
      let theme = Theme.shared
      let lit = button.isSelected || button.isHighlighted
      var updated = button.configuration
      updated?.background.backgroundColor = lit ? theme.ui("accent-soft") : .clear
      updated?.baseForegroundColor = lit ? theme.ui("accent-ink") : theme.ui("text-primary")
      button.configuration = updated
    }
    button.accessibilityLabel = key.label
    button.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      button.heightAnchor.constraint(equalToConstant: 44),
    ])
    button.addAction(
      UIAction { [weak self] _ in
        self?.haptics.impactOccurred()
        self?.onKey?(key)
      }, for: .touchUpInside)
    if key.text == nil { buttons[key.id] = button }
    return button
  }
}
