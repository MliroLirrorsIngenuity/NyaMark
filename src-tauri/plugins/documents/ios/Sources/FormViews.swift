import SwiftUI
import UIKit

extension FormTone {
  /// The ink of a note or badge in this tone.
  var ink: Color {
    switch self {
    case .muted: return .secondary
    case .warning: return .orange
    case .error: return .red
    case .success: return .green
    }
  }
}

extension View {
  @ViewBuilder fileprivate func dismissesKeyboardOnScroll() -> some View {
    if #available(iOS 16.0, *) {
      scrollDismissesKeyboard(.interactively)
    } else {
      self
    }
  }
}

// MARK: Page

/// A page of a form as a system grouped list; its title and buttons sit in the navigation bar.
struct FormPageView: View {
  @ObservedObject var model: FormPageModel
  @ObservedObject private var theme = Theme.shared
  let send: FormEmitter

  var body: some View {
    let page = model.page
    Form {
      if let tabs = page.tabs {
        FormTabs(tabs: tabs, select: send.tab)
      }
      ForEach(page.sections) { section in
        FormSectionView(section: section, send: send)
      }
      if let footer = page.footer {
        Section { footerButton(footer) }
      }
    }
    .listStyle(.insetGrouped)
    .dismissesKeyboardOnScroll()
    .tint(theme.color("accent"))
  }

  private func footerButton(_ button: FormButton) -> some View {
    Button(role: button.role == .destructive ? .destructive : nil) {
      send.press(button.id)
    } label: {
      Text(button.label)
        .font(.body.weight(button.role == .primary ? .semibold : .regular))
        .frame(maxWidth: .infinity)
    }
    .disabled(button.disabled ?? false)
  }
}

/// The segmented control that opens the page, on the list's own background.
struct FormTabs: View {
  let tabs: FormTabSet
  let select: (String) -> Void

  var body: some View {
    Section {
      Picker(
        "",
        selection: Binding(
          get: { tabs.value },
          set: { if $0 != tabs.value { select($0) } })
      ) {
        ForEach(tabs.options) { option in
          Text(option.label).tag(option.value)
        }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .listRowBackground(Color.clear)
      .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
    }
  }
}

// MARK: Section

struct FormSectionView: View {
  let section: FormSection
  let send: FormEmitter

  var body: some View {
    Section {
      ForEach(section.rows) { row in
        FormRowView(row: row, send: send)
      }
    } header: {
      if let title = section.title { Text(title).textCase(nil) }
    } footer: {
      if let footer = section.footer { Text(footer) }
    }
  }
}

// MARK: Rows

/// Draws a row by its kind.
struct FormRowView: View {
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    switch row.kind {
    case .toggle: FormToggleRow(row: row, send: send)
    case .choice: FormChoiceRow(row: row, send: send)
    case .cards: FormCardsRow(row: row, send: send)
    case .number: FormNumberRow(row: row, send: send)
    case .slider: FormSliderRow(row: row, send: send)
    case .text: FormTextRow(row: row, send: send)
    case .button: FormButtonRow(row: row, send: send)
    case .value: FormValueRow(row: row)
    case .note: FormNoteRow(row: row)
    case .link: FormLinkRow(row: row, send: send)
    case .item: FormItemRow(row: row, send: send)
    }
  }
}

/// A row's label with its detail beneath, for rows that carry their control beside it.
struct FormLabel: View {
  let text: String
  var detail: String? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(text)
      if let detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(Color.secondary)
      }
    }
  }
}

struct FormToggleRow: View {
  let row: FormRow
  let send: FormEmitter
  @State private var on: Bool

  init(row: FormRow, send: FormEmitter) {
    self.row = row
    self.send = send
    _on = State(initialValue: row.flag)
  }

  var body: some View {
    Toggle(isOn: $on) {
      FormLabel(text: row.label ?? "", detail: row.detail)
    }
    .disabled(row.isDisabled)
    .onChange(of: on) { value in
      if value != row.flag { send.change(row.id, value) }
    }
    .onChange(of: row.flag) { on = $0 }
  }
}

struct FormChoiceRow: View {
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    let options = row.options ?? []
    let chosen = options.first { $0.value == row.string }
    Group {
      if chosen != nil && options.allSatisfy({ $0.detail == nil }) {
        Picker(
          selection: Binding(
            get: { row.string ?? "" },
            set: { if $0 != row.string { send.change(row.id, $0) } })
        ) {
          ForEach(options) { option in
            Text(option.label).tag(option.value)
          }
        } label: {
          FormLabel(text: row.label ?? "", detail: row.detail)
        }
        .pickerStyle(.menu)
      } else {
        menu(options, chosen: chosen)
      }
    }
    .disabled(row.isDisabled)
  }

  /// The menu with the placeholder or the options' details, which a `Picker` cannot show.
  private func menu(_ options: [FormOption], chosen: FormOption?) -> some View {
    Menu {
      ForEach(options) { option in
        Button {
          send.change(row.id, option.value)
        } label: {
          Text(option.label)
          if let detail = option.detail { Text(detail) }
          if option.value == chosen?.value { Image(systemName: "checkmark") }
        }
      }
    } label: {
      HStack(spacing: 8) {
        FormLabel(text: row.label ?? "", detail: row.detail)
          .foregroundStyle(Color.primary)
        Spacer(minLength: 8)
        Text(chosen?.label ?? row.placeholder ?? "")
          .foregroundStyle(.tint)
          .lineLimit(1)
        Image(systemName: "chevron.up.chevron.down")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.tint)
      }
      .contentShape(Rectangle())
    }
  }
}

/// Option rows, one chosen: each its title and detail, the chosen one checked.
struct FormCardsRow: View {
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    ForEach(row.options ?? []) { option in
      card(option)
    }
  }

  private func card(_ option: FormOption) -> some View {
    let chosen = option.value == row.string
    return Button {
      guard !chosen else { return }
      send.change(row.id, option.value)
    } label: {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(option.label)
            .foregroundStyle(Color.primary)
          if let detail = option.detail {
            Text(detail)
              .font(.subheadline)
              .foregroundStyle(Color.secondary)
          }
        }
        Spacer(minLength: 8)
        if chosen {
          Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(.tint)
        }
      }
      .contentShape(Rectangle())
    }
    .accessibilityAddTraits(chosen ? .isSelected : [])
  }
}

/// Turns what was typed into a number kept between a row's bounds and on its step, and back into text.
enum FormNumber {
  private static let formatter: NumberFormatter = {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.locale = .current
    formatter.usesGroupingSeparator = false
    formatter.maximumFractionDigits = 10
    formatter.generatesDecimalNumbers = true
    return formatter
  }()

  static func text(_ value: Double) -> String {
    formatter.string(from: NSNumber(value: value)) ?? "\(value)"
  }

  /// The number `text` holds, or nil when it holds none.
  static func entered(_ text: String, row: FormRow) -> Double? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let typed = formatter.number(from: trimmed) as? NSDecimalNumber else { return nil }
    let low = row.min ?? -.infinity
    let high = row.max ?? .infinity
    var value = typed.decimalValue
    if let step = row.step, step > 0, let size = Decimal(string: "\(step)") {
      let base = Decimal(string: "\(low.isFinite ? low : 0)") ?? 0
      var quotient = (value - base) / size
      var steps = Decimal()
      NSDecimalRound(&steps, &quotient, 0, .plain)
      value = base + steps * size
    }
    let number = Double("\(value)") ?? .nan
    return number.isFinite ? min(max(number, low), high) : nil
  }
}

struct FormNumberRow: View {
  let row: FormRow
  let send: FormEmitter
  @State private var text: String
  @State private var focused = false

  init(row: FormRow, send: FormEmitter) {
    self.row = row
    self.send = send
    _text = State(initialValue: FormNumber.text(row.number))
  }

  var body: some View {
    HStack(spacing: 8) {
      FormLabel(text: row.label ?? "", detail: row.detail)
        .layoutPriority(1)
      FormTextField(
        text: $text, focused: $focused, typing: FormTyping(keyboard: .decimalPad), doneBar: true,
        alignment: .right
      )
      .frame(minWidth: 56, maxWidth: .infinity)
      if let unit = row.unit {
        Text(unit)
          .foregroundStyle(Color.secondary)
      }
    }
    .disabled(row.isDisabled)
    .onChange(of: focused) { editing in
      if !editing { commit() }
    }
    .onChange(of: row.number) { number in
      if !focused { text = FormNumber.text(number) }
    }
  }

  private func commit() {
    guard let value = FormNumber.entered(text, row: row) else {
      text = FormNumber.text(row.number)
      return
    }
    text = FormNumber.text(value)
    if value != row.number { send.change(row.id, value) }
  }
}

/// Passes on the latest work handed to it, at most once a frame.
final class FrameLimiter {
  private static let interval: TimeInterval = 1.0 / 60
  private var pending: (() -> Void)?
  private var last = CACurrentMediaTime()

  func run(_ work: @escaping () -> Void) {
    let idle = pending == nil
    pending = work
    guard idle else { return }
    let wait = max(0, last + Self.interval - CACurrentMediaTime())
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [self] in
      last = CACurrentMediaTime()
      let work = pending
      pending = nil
      work?()
    }
  }
}

struct FormSliderRow: View {
  let row: FormRow
  let send: FormEmitter
  @State private var value: Double
  @State private var dragging = false
  @State private var limiter = FrameLimiter()

  init(row: FormRow, send: FormEmitter) {
    self.row = row
    self.send = send
    _value = State(initialValue: row.number)
  }

  var body: some View {
    let low = row.min ?? 0
    let high = Swift.max(low, row.max ?? 1)
    VStack(spacing: 4) {
      HStack(spacing: 12) {
        Text(row.label ?? "")
        Spacer(minLength: 8)
        Text(row.valueText ?? "")
          .monospacedDigit()
          .foregroundStyle(Color.secondary)
      }
      slider(low: low, high: high)
    }
    .disabled(row.isDisabled)
    .onChange(of: value) { next in
      guard next != row.number else { return }
      let id = row.id
      limiter.run { send.change(id, next) }
    }
    .onChange(of: row.number) { number in
      if !dragging { value = number }
    }
  }

  @ViewBuilder private func slider(low: Double, high: Double) -> some View {
    if let step = row.step, step > 0 {
      Slider(value: $value, in: low...high, step: step) { dragging = $0 }
    } else {
      Slider(value: $value, in: low...high) { dragging = $0 }
    }
  }
}

struct FormTextRow: View {
  let row: FormRow
  let send: FormEmitter
  @State private var text: String
  @State private var focused = false

  init(row: FormRow, send: FormEmitter) {
    self.row = row
    self.send = send
    _text = State(initialValue: row.string ?? "")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let label = row.label {
        Text(label)
          .font(.subheadline)
          .foregroundStyle(Color.secondary)
      }
      if let detail = row.detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(Color.secondary)
      }
      field
      if let error = row.error {
        Text(error)
          .font(.footnote)
          .foregroundStyle(.red)
      }
    }
    .disabled(row.isDisabled)
    .onChange(of: text) { next in
      if next != (row.string ?? "") { send.change(row.id, next) }
    }
    .onChange(of: row.string) { next in
      if !focused { text = next ?? "" }
    }
  }

  private var typing: FormTyping {
    let literal = row.secure == true || (row.input ?? .text) != .text
    let keyboard: UIKeyboardType
    switch row.input ?? .text {
    case .text: keyboard = .default
    case .url: keyboard = .URL
    case .email: keyboard = .emailAddress
    case .code: keyboard = .asciiCapable
    }
    return FormTyping(keyboard: keyboard, secure: row.secure == true, literal: literal)
  }

  @ViewBuilder private var field: some View {
    if row.multiline == true {
      ZStack(alignment: .topLeading) {
        FormTextArea(text: $text, focused: $focused, typing: typing)
        if text.isEmpty, let placeholder = row.placeholder {
          Text(placeholder)
            .foregroundStyle(Color(.placeholderText))
            .allowsHitTesting(false)
        }
      }
    } else {
      FormTextField(
        text: $text, focused: $focused, placeholder: row.placeholder ?? "", typing: typing)
    }
  }
}

struct FormButtonRow: View {
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    let busy = row.busy ?? false
    Button(role: row.role == .destructive ? .destructive : nil) {
      send.press(row.id)
    } label: {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          Text(row.label ?? "")
            .font(.body.weight(row.role == .primary ? .semibold : .regular))
          if let detail = row.detail {
            Text(detail)
              .font(.caption)
              .foregroundStyle(Color.secondary)
          }
        }
        Spacer(minLength: 8)
        if busy { ProgressView() }
      }
      .contentShape(Rectangle())
    }
    .disabled(row.isDisabled || busy)
  }
}

struct FormValueRow: View {
  let row: FormRow

  var body: some View {
    if #available(iOS 16.0, *) {
      LabeledContent {
        value
      } label: {
        FormLabel(text: row.label ?? "", detail: row.detail)
      }
    } else {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        FormLabel(text: row.label ?? "", detail: row.detail)
        Spacer(minLength: 8)
        value
      }
    }
  }

  private var value: some View {
    Text(row.string ?? "")
      .foregroundStyle(Color.secondary)
      .multilineTextAlignment(.trailing)
      .textSelection(.enabled)
  }
}

struct FormNoteRow: View {
  let row: FormRow

  var body: some View {
    Text(row.text ?? "")
      .font(.footnote)
      .foregroundStyle(row.tone?.ink ?? .secondary)
  }
}

struct FormLinkRow: View {
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    Button {
      send.open(row.id)
    } label: {
      HStack(spacing: 8) {
        FormLabel(text: row.label ?? "", detail: row.detail)
          .foregroundStyle(Color.primary)
        Spacer(minLength: 8)
        if let value = row.string {
          Text(value)
            .foregroundStyle(Color.secondary)
            .lineLimit(1)
        }
        Image(systemName: row.external == true ? "arrow.up.right" : "chevron.right")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(Color(.tertiaryLabel))
      }
      .contentShape(Rectangle())
    }
    .disabled(row.isDisabled)
  }
}

/// An entry of a list: tapped to open, with a switch when it has one and its actions on a swipe and a long press.
struct FormItemRow: View {
  let row: FormRow
  let send: FormEmitter
  @State private var on: Bool

  init(row: FormRow, send: FormEmitter) {
    self.row = row
    self.send = send
    _on = State(initialValue: row.toggle ?? false)
  }

  var body: some View {
    let actions = row.actions ?? []
    HStack(spacing: 12) {
      opener
      if row.toggle != nil {
        Toggle(row.title ?? "", isOn: $on)
          .labelsHidden()
      }
    }
    .swipeActions(edge: .trailing) { actionButtons(actions) }
    .contextMenu { actionButtons(actions) }
    .onChange(of: on) { value in
      if value != row.toggle { send.change(row.id, value) }
    }
    .onChange(of: row.toggle) { on = $0 ?? false }
  }

  /// Beside a switch the button takes only its own content, so the switch keeps its touches.
  @ViewBuilder private var opener: some View {
    if row.toggle == nil {
      openButton
    } else {
      openButton.buttonStyle(.plain)
    }
  }

  private var openButton: some View {
    Button {
      send.open(row.id)
    } label: {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          Text(row.title ?? "")
            .foregroundStyle(Color.primary)
          if let detail = row.detail {
            Text(detail)
              .font(.subheadline)
              .foregroundStyle(Color.secondary)
              .lineLimit(2)
          }
        }
        Spacer(minLength: 0)
        if let badge = row.badge { badgeView(badge) }
      }
      .contentShape(Rectangle())
    }
  }

  private func badgeView(_ text: String) -> some View {
    let ink = row.tone?.ink ?? .secondary
    return Text(text)
      .font(.caption.weight(.medium))
      .foregroundStyle(ink)
      .lineLimit(1)
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .background(Capsule().fill(ink.opacity(0.14)))
  }

  @ViewBuilder private func actionButtons(_ actions: [FormAction]) -> some View {
    ForEach(actions) { action in
      Button(role: action.destructive == true ? .destructive : nil) {
        send.action(row.id, action.id)
      } label: {
        Text(action.label)
      }
    }
  }
}


// MARK: Text input on UIKit

/// How a field takes typing.
struct FormTyping: Equatable {
  var keyboard: UIKeyboardType = .default
  var secure = false
  /// Typed as written: no capitals, corrections or smart punctuation.
  var literal = false

  func apply(to field: UITextField) {
    field.keyboardType = keyboard
    field.isSecureTextEntry = secure
    field.autocapitalizationType = literal ? .none : .sentences
    field.autocorrectionType = literal ? .no : .default
    field.spellCheckingType = literal ? .no : .default
    field.smartQuotesType = literal ? .no : .default
    field.smartDashesType = literal ? .no : .default
    field.smartInsertDeleteType = literal ? .no : .default
  }

  func apply(to view: UITextView) {
    view.keyboardType = keyboard
    view.autocapitalizationType = literal ? .none : .sentences
    view.autocorrectionType = literal ? .no : .default
    view.spellCheckingType = literal ? .no : .default
    view.smartQuotesType = literal ? .no : .default
    view.smartDashesType = literal ? .no : .default
    view.smartInsertDeleteType = literal ? .no : .default
  }
}

/// A single-line field on UIKit, which has the smart punctuation switches SwiftUI's lacks.
struct FormTextField: UIViewRepresentable {
  @Binding var text: String
  @Binding var focused: Bool
  var placeholder = ""
  var typing = FormTyping()
  /// Adds a Done key above the keyboard, for the keypad that has no Return.
  var doneBar = false
  var alignment: NSTextAlignment = .natural

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  func makeUIView(context: Context) -> UITextField {
    let field = UITextField()
    field.delegate = context.coordinator
    field.addTarget(
      context.coordinator, action: #selector(Coordinator.edited(_:)), for: .editingChanged)
    field.font = .preferredFont(forTextStyle: .body)
    field.adjustsFontForContentSizeCategory = true
    field.textAlignment = alignment
    field.returnKeyType = .done
    field.clearButtonMode = .never
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    typing.apply(to: field)
    if doneBar {
      let bar = UIToolbar()
      bar.items = [
        UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
        UIBarButtonItem(
          barButtonSystemItem: .done, target: field,
          action: #selector(UIResponder.resignFirstResponder)),
      ]
      bar.sizeToFit()
      field.inputAccessoryView = bar
    }
    return field
  }

  func updateUIView(_ field: UITextField, context: Context) {
    context.coordinator.parent = self
    if !field.isFirstResponder, field.text != text { field.text = text }
    if field.placeholder != placeholder { field.placeholder = placeholder }
    field.isEnabled = context.environment.isEnabled
    field.alpha = field.isEnabled ? 1 : 0.4
  }

  final class Coordinator: NSObject, UITextFieldDelegate {
    var parent: FormTextField

    init(_ parent: FormTextField) {
      self.parent = parent
    }

    @objc func edited(_ field: UITextField) {
      guard field.markedTextRange == nil else { return }
      parent.text = field.text ?? ""
    }

    func textFieldDidBeginEditing(_ field: UITextField) {
      parent.focused = true
    }

    func textFieldDidEndEditing(_ field: UITextField) {
      parent.text = field.text ?? ""
      parent.focused = false
    }

    func textFieldShouldReturn(_ field: UITextField) -> Bool {
      field.resignFirstResponder()
      return true
    }
  }
}

/// A text view that is as tall as its text, between three lines and a screenful.
final class GrowingTextView: UITextView {
  private static let heights: ClosedRange<CGFloat> = 68...200
  private var fittedWidth: CGFloat = 0

  func height(fitting width: CGFloat) -> CGFloat {
    guard width > 0 else { return Self.heights.lowerBound }
    let fit = sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
    return Swift.min(Swift.max(fit, Self.heights.lowerBound), Self.heights.upperBound)
  }

  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: height(fitting: bounds.width))
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if bounds.width != fittedWidth {
      fittedWidth = bounds.width
      invalidateIntrinsicContentSize()
    }
  }
}

/// A multi-line field on UIKit, for the same reason as `FormTextField`.
struct FormTextArea: UIViewRepresentable {
  @Binding var text: String
  @Binding var focused: Bool
  var typing = FormTyping()

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  func makeUIView(context: Context) -> GrowingTextView {
    let view = GrowingTextView()
    view.delegate = context.coordinator
    view.backgroundColor = .clear
    view.font = .preferredFont(forTextStyle: .body)
    view.adjustsFontForContentSizeCategory = true
    view.textContainerInset = .zero
    view.textContainer.lineFragmentPadding = 0
    typing.apply(to: view)
    return view
  }

  func updateUIView(_ view: GrowingTextView, context: Context) {
    context.coordinator.parent = self
    if !view.isFirstResponder, view.text != text { view.text = text }
    view.isEditable = context.environment.isEnabled
    view.alpha = view.isEditable ? 1 : 0.4
    view.invalidateIntrinsicContentSize()
  }

  @available(iOS 16.0, *)
  func sizeThatFits(_ proposal: ProposedViewSize, uiView view: GrowingTextView, context: Context)
    -> CGSize?
  {
    let width = proposal.width ?? view.bounds.width
    return CGSize(width: width, height: view.height(fitting: width))
  }

  final class Coordinator: NSObject, UITextViewDelegate {
    var parent: FormTextArea

    init(_ parent: FormTextArea) {
      self.parent = parent
    }

    func textViewDidChange(_ view: UITextView) {
      if view.markedTextRange == nil { parent.text = view.text ?? "" }
      view.invalidateIntrinsicContentSize()
    }

    func textViewDidBeginEditing(_ view: UITextView) {
      parent.focused = true
    }

    func textViewDidEndEditing(_ view: UITextView) {
      parent.text = view.text ?? ""
      parent.focused = false
    }
  }
}
