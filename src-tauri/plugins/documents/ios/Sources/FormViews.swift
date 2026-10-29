import SwiftUI
import UIKit

private func tapFeedback() {
  UIImpactFeedbackGenerator(style: .light).impactOccurred()
}

extension Theme {
  /// The ink of a note or badge in `tone`; none is the plain secondary text.
  func tone(_ tone: FormTone?) -> Color {
    switch tone {
    case .none: return color("text-secondary")
    case .muted: return color("text-muted")
    case .warning: return color("warning")
    case .error: return color("del-ink")
    case .success: return color("ok")
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

/// A page of a form as `.ny-settings-dialog` draws it on a phone.
struct FormPageView: View {
  @ObservedObject var model: FormPageModel
  @ObservedObject private var theme = Theme.shared
  /// Whether the page opens the stack; the pages after it get a back button.
  let first: Bool
  let send: FormEmitter
  let back: () -> Void

  var body: some View {
    let page = model.page
    VStack(spacing: 0) {
      header(page)
      if let tabs = page.tabs {
        FormTabBar(tabs: tabs, select: send.tab)
      }
      ScrollView {
        VStack(spacing: 10) {
          ForEach(page.sections) { section in
            FormSectionView(section: section, send: send)
          }
        }
        .padding(.top, page.tabs == nil ? 12 : 0)
        .padding(.bottom, 16)
      }
      .dismissesKeyboardOnScroll()
      if let footer = page.footer {
        footerButton(footer)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 12)
    .foregroundStyle(theme.color("text-primary"))
  }

  private func header(_ page: FormPage) -> some View {
    HStack(spacing: 8) {
      GlassGroup(spacing: 6) {
        if !first {
          CircleButton(symbol: "chevron.left", label: L10n.text("back"), action: back)
        } else if let button = page.leading {
          FormHeaderButton(button: button) { send.press(button.id) }
        }
      }
      .frame(minWidth: 64, maxWidth: .infinity, alignment: .leading)
      Text(page.title)
        .font(.system(size: 17, weight: .semibold))
        .lineLimit(1)
        .truncationMode(.tail)
        .layoutPriority(1)
      GlassGroup(spacing: 6) {
        if let button = page.trailing {
          FormHeaderButton(button: button) { send.press(button.id) }
        }
      }
      .frame(minWidth: 64, maxWidth: .infinity, alignment: .trailing)
    }
    .frame(height: 44)
  }

  private func footerButton(_ button: FormButton) -> some View {
    let destructive = button.role == .destructive
    return Button {
      tapFeedback()
      send.press(button.id)
    } label: {
      Text(button.label)
        .font(.system(size: 15, weight: button.role == .primary ? .semibold : .medium))
        .foregroundStyle(
          destructive
            ? theme.color("del-ink")
            : button.role == .primary ? theme.color("accent-ink") : theme.color("text-primary")
        )
        .lineLimit(1)
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Capsule())
    }
    .buttonStyle(FormFootStyle(plain: destructive, accent: button.role == .primary))
    .disabled(button.disabled ?? false)
    .opacity(button.disabled ?? false ? 0.55 : 1)
    .padding(.vertical, 12)
  }
}

/// A capsule in the header, as `.ny-settings-dialog__button` is on a phone.
struct FormHeaderButton: View {
  @ObservedObject private var theme = Theme.shared
  let button: FormButton
  let press: () -> Void

  var body: some View {
    let disabled = button.disabled ?? false
    Button {
      tapFeedback()
      press()
    } label: {
      Text(button.label)
        .font(.system(size: 15, weight: button.role == .primary ? .semibold : .medium))
        .foregroundStyle(ink)
        .lineLimit(1)
        .padding(.horizontal, 12)
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Capsule())
    }
    .buttonStyle(DialogButtonStyle(accent: button.role == .primary))
    .disabled(disabled)
    .opacity(disabled ? 0.55 : 1)
  }

  private var ink: Color {
    switch button.role {
    case .primary: return theme.color("accent-ink")
    case .destructive: return theme.color("del-ink")
    default: return theme.color("text-primary")
    }
  }
}

/// The button across the foot of a page: a capsule, or bare text for a destructive one.
struct FormFootStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared
  let plain: Bool
  let accent: Bool

  func makeBody(configuration: Configuration) -> some View {
    let fill: Color =
      configuration.isPressed
      ? theme.color("accent-soft")
      : plain ? .clear : accent ? theme.color("accent-soft") : theme.color("fill-soft")
    return configuration.label
      .background(Capsule().fill(fill))
      .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
  }
}

/// The segmented control under the header, as `.ny-settings-tabs` draws it on a phone.
struct FormTabBar: View {
  @ObservedObject private var theme = Theme.shared
  let tabs: FormTabSet
  let select: (String) -> Void

  var body: some View {
    HStack(spacing: 2) {
      ForEach(tabs.options) { option in
        tab(option)
      }
    }
    .padding(3)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous).fill(theme.color("fill-soft"))
    )
    .padding(.top, 12)
    .padding(.bottom, 16)
  }

  private func tab(_ option: FormOption) -> some View {
    let selected = option.value == tabs.value
    let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
    return Button {
      guard !selected else { return }
      tapFeedback()
      select(option.value)
    } label: {
      Text(option.label)
        .font(.system(size: 13, weight: selected ? .semibold : .regular))
        .foregroundStyle(selected ? theme.color("text-primary") : theme.color("text-secondary"))
        .lineLimit(1)
        .frame(maxWidth: .infinity, minHeight: 44)
        .background {
          if selected {
            ZStack {
              shape.fill(theme.color("dock-bg"))
              if theme.dark { shape.fill(theme.color("text-primary").opacity(0.12)) }
            }
            .overlay(shape.stroke(theme.color("line"), lineWidth: 1))
            .shadow(
              color: Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255).opacity(0.08),
              radius: 1.5, y: 1)
          }
        }
        .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

// MARK: Section

/// A card of rows as `.ny-settings__section` draws it, with its title above and its footer below.
struct FormSectionView: View {
  @ObservedObject private var theme = Theme.shared
  let section: FormSection
  let send: FormEmitter

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      VStack(alignment: .leading, spacing: 0) {
        if let title = section.title {
          Text(title)
            .font(.system(size: 13.5, weight: .semibold))
            .padding(.horizontal, 12)
            .padding(.bottom, 5)
        }
        ForEach(Array(section.rows.enumerated()), id: \.element.id) { index, row in
          VStack(spacing: 0) {
            if index > 0 && row.kind != .note {
              Rectangle()
                .fill(theme.color("border-soft"))
                .frame(height: 1)
                .padding(.horizontal, 12)
            }
            FormRowView(row: row, send: send)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, section.title == nil ? 9 : 14)
      .padding(.bottom, 3)
      .background(theme.color("fill-soft"))
      .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
      if let footer = section.footer {
        Text(footer)
          .font(.system(size: 13))
          .foregroundStyle(theme.color("text-muted"))
          .lineSpacing(3)
          .padding(.horizontal, 12)
      }
    }
  }
}

// MARK: Rows

/// Draws a row by its kind; rows that highlight when pressed run to the card's edges and pad themselves.
struct FormRowView: View {
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    switch row.kind {
    case .toggle: padded(FormToggleRow(row: row, send: send))
    case .choice: padded(FormChoiceRow(row: row, send: send))
    case .cards: padded(FormCardsRow(row: row, send: send))
    case .number: padded(FormNumberRow(row: row, send: send))
    case .slider: padded(FormSliderRow(row: row, send: send))
    case .text: padded(FormTextRow(row: row, send: send))
    case .button: padded(FormButtonRow(row: row, send: send))
    case .value: padded(FormValueRow(row: row))
    case .note: padded(FormNoteRow(row: row))
    case .link: FormLinkRow(row: row, send: send)
    case .item: FormItemRow(row: row, send: send)
    }
  }

  private func padded<Content: View>(_ content: Content) -> some View {
    content
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
  }
}

/// A row's label with its detail beneath, for rows that carry their control beside it.
struct FormLabel: View {
  @ObservedObject private var theme = Theme.shared
  let text: String
  var detail: String? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(text)
        .font(.system(size: 14))
        .foregroundStyle(theme.color("text-primary"))
      if let detail {
        Text(detail)
          .font(.system(size: 13))
          .foregroundStyle(theme.color("text-secondary"))
          .lineSpacing(2)
      }
    }
  }
}

/// A field's label above it, as `.ny-settings__field` sets it.
struct FormFieldLabel: View {
  @ObservedObject private var theme = Theme.shared
  let text: String?
  var detail: String? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let text {
        Text(text)
          .font(.system(size: 12.5))
          .foregroundStyle(theme.color("text-secondary"))
      }
      if let detail {
        Text(detail)
          .font(.system(size: 13))
          .foregroundStyle(theme.color("text-muted"))
          .lineSpacing(2)
      }
    }
  }
}

/// The box of a field as `.ny-settings__input` draws it on a phone, with a ring while focused.
struct FormFieldBox: ViewModifier {
  @ObservedObject private var theme = Theme.shared
  var focused = false
  var invalid = false
  var minHeight: CGFloat = 44
  var inset: CGFloat = 0

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
    let edge: Color =
      focused
      ? theme.color("accent").opacity(0.6)
      : invalid ? theme.color("del-ink").opacity(0.6) : theme.color("border-soft")
    content
      .padding(.horizontal, 12)
      .padding(.vertical, inset)
      .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
      .background(shape.fill(theme.color("dock-bg")))
      .overlay(shape.stroke(edge, lineWidth: 1))
      .overlay(
        shape.stroke(theme.color("accent-soft"), lineWidth: 3).padding(-1.5).opacity(
          focused ? 1 : 0))
  }
}

extension View {
  func formField(
    focused: Bool = false, invalid: Bool = false, minHeight: CGFloat = 44, inset: CGFloat = 0
  ) -> some View {
    modifier(FormFieldBox(focused: focused, invalid: invalid, minHeight: minHeight, inset: inset))
  }

  /// Dims a row the page has disabled and takes its touches.
  func formDisabled(_ disabled: Bool) -> some View {
    self.disabled(disabled).opacity(disabled ? 0.55 : 1)
  }
}

struct FormToggleRow: View {
  @ObservedObject private var theme = Theme.shared
  let row: FormRow
  let send: FormEmitter
  @State private var on: Bool

  init(row: FormRow, send: FormEmitter) {
    self.row = row
    self.send = send
    _on = State(initialValue: row.flag)
  }

  var body: some View {
    HStack(spacing: 12) {
      FormLabel(text: row.label ?? "", detail: row.detail)
      Spacer(minLength: 8)
      Toggle(row.label ?? "", isOn: $on)
        .labelsHidden()
        .tint(theme.color("accent"))
    }
    .frame(minHeight: 44)
    .formDisabled(row.isDisabled)
    .onChange(of: on) { value in
      if value != row.flag { send.change(row.id, value) }
    }
    .onChange(of: row.flag) { on = $0 }
  }
}

struct FormChoiceRow: View {
  @ObservedObject private var theme = Theme.shared
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    let options = row.options ?? []
    let chosen = options.first { $0.value == row.string }
    VStack(alignment: .leading, spacing: 6) {
      FormFieldLabel(text: row.label, detail: row.detail)
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
          Text(chosen?.label ?? row.placeholder ?? "")
            .font(.system(size: 16))
            .foregroundStyle(
              chosen == nil ? theme.color("text-muted") : theme.color("text-primary")
            )
            .lineLimit(1)
            .truncationMode(.tail)
          Spacer(minLength: 0)
          Image(systemName: "chevron.down")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.color("text-secondary"))
        }
        .formField()
        .contentShape(Rectangle())
      }
    }
    .formDisabled(row.isDisabled)
  }
}

/// Option cards as `.ny-image-policy-dialog__option` draws them, the chosen one tinted.
struct FormCardsRow: View {
  @ObservedObject private var theme = Theme.shared
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    VStack(spacing: 10) {
      ForEach(row.options ?? []) { option in
        card(option)
      }
    }
  }

  private func card(_ option: FormOption) -> some View {
    let chosen = option.value == row.string
    let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
    return Button {
      guard !chosen else { return }
      tapFeedback()
      send.change(row.id, option.value)
    } label: {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
          .font(.system(size: 18))
          .foregroundStyle(chosen ? theme.color("accent") : theme.color("text-muted"))
        VStack(alignment: .leading, spacing: 3) {
          Text(option.label)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.color("text-primary"))
            .multilineTextAlignment(.leading)
          if let detail = option.detail {
            Text(detail)
              .font(.system(size: 12.5))
              .foregroundStyle(theme.color("text-secondary"))
              .lineSpacing(3)
              .multilineTextAlignment(.leading)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 12)
      .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
      .background(
        shape.fill(chosen ? theme.color("accent").opacity(0.1) : theme.color("fill-soft"))
      )
      .overlay(
        shape.stroke(
          chosen ? theme.color("accent").opacity(0.55) : theme.color("border-soft"), lineWidth: 1)
      )
      .contentShape(shape)
    }
    .buttonStyle(.plain)
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
  @ObservedObject private var theme = Theme.shared
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
    VStack(alignment: .leading, spacing: 6) {
      FormFieldLabel(text: row.label, detail: row.detail)
      HStack(spacing: 10) {
        FormTextField(
          text: $text, focused: $focused, typing: FormTyping(keyboard: .decimalPad), doneBar: true
        )
        .formField(focused: focused)
        if let unit = row.unit {
          Text(unit)
            .font(.system(size: 15))
            .foregroundStyle(theme.color("text-muted"))
        }
      }
    }
    .formDisabled(row.isDisabled)
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
  @ObservedObject private var theme = Theme.shared
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
    VStack(spacing: 2) {
      HStack(spacing: 12) {
        Text(row.label ?? "")
          .font(.system(size: 14))
          .foregroundStyle(theme.color("text-primary"))
        Spacer(minLength: 8)
        Text(row.valueText ?? "")
          .font(.system(size: 13))
          .monospacedDigit()
          .foregroundStyle(row.isDisabled ? theme.color("text-muted") : theme.color("text-primary"))
      }
      slider(low: low, high: high)
        .tint(theme.color("accent"))
        .frame(minHeight: 34)
    }
    .formDisabled(row.isDisabled)
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
  @ObservedObject private var theme = Theme.shared
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
      FormFieldLabel(text: row.label, detail: row.detail)
      field
      if let error = row.error {
        Text(error)
          .font(.system(size: 13))
          .foregroundStyle(theme.color("del-ink"))
          .lineSpacing(2)
      }
    }
    .formDisabled(row.isDisabled)
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
            .font(.system(size: 16))
            .foregroundStyle(theme.color("text-muted"))
            .allowsHitTesting(false)
        }
      }
      .formField(focused: focused, invalid: row.error != nil, minHeight: 88, inset: 10)
    } else {
      FormTextField(
        text: $text, focused: $focused, placeholder: row.placeholder ?? "", typing: typing
      )
      .formField(focused: focused, invalid: row.error != nil)
    }
  }
}

/// A capsule button across the row, as `.ny-settings__button` is on a phone.
struct FormRowButtonStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared
  let role: FormRole?

  func makeBody(configuration: Configuration) -> some View {
    let shape = RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
    let fill: Color =
      configuration.isPressed || role == .primary
      ? theme.color("accent-soft") : theme.color("dock-bg")
    return configuration.label
      .background(shape.fill(fill))
      .overlay(shape.stroke(theme.color("border-soft"), lineWidth: role == .primary ? 0 : 1))
      .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
  }
}

struct FormButtonRow: View {
  @ObservedObject private var theme = Theme.shared
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    let busy = row.busy ?? false
    VStack(spacing: 6) {
      Button {
        guard !busy else { return }
        tapFeedback()
        send.press(row.id)
      } label: {
        Text(row.label ?? "")
          .font(.system(size: 15, weight: row.role == .primary ? .semibold : .medium))
          .foregroundStyle(ink)
          .lineLimit(1)
          .opacity(busy ? 0 : 1)
          .overlay { if busy { ProgressView() } }
          .padding(.horizontal, 16)
          .frame(maxWidth: .infinity, minHeight: 44)
          .contentShape(Rectangle())
      }
      .buttonStyle(FormRowButtonStyle(role: row.role))
      if let detail = row.detail {
        Text(detail)
          .font(.system(size: 13))
          .foregroundStyle(theme.color("text-secondary"))
          .lineSpacing(2)
          .multilineTextAlignment(.center)
          .frame(maxWidth: .infinity)
      }
    }
    .formDisabled(row.isDisabled)
  }

  private var ink: Color {
    switch row.role {
    case .primary: return theme.color("accent-ink")
    case .destructive: return theme.color("del-ink")
    default: return theme.color("text-primary")
    }
  }
}

struct FormValueRow: View {
  @ObservedObject private var theme = Theme.shared
  let row: FormRow

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      FormLabel(text: row.label ?? "", detail: row.detail)
      Spacer(minLength: 8)
      Text(row.string ?? "")
        .font(.system(size: 14))
        .foregroundStyle(theme.color("text-secondary"))
        .multilineTextAlignment(.trailing)
        .textSelection(.enabled)
    }
    .frame(minHeight: 44)
  }
}

struct FormNoteRow: View {
  @ObservedObject private var theme = Theme.shared
  let row: FormRow

  var body: some View {
    Text(row.text ?? "")
      .font(.system(size: 13))
      .foregroundStyle(theme.tone(row.tone))
      .lineSpacing(3)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct FormLinkRow: View {
  @ObservedObject private var theme = Theme.shared
  let row: FormRow
  let send: FormEmitter

  var body: some View {
    Button {
      tapFeedback()
      send.open(row.id)
    } label: {
      HStack(spacing: 8) {
        FormLabel(text: row.label ?? "", detail: row.detail)
        Spacer(minLength: 8)
        if let value = row.string {
          Text(value)
            .font(.system(size: 14))
            .foregroundStyle(theme.color("text-secondary"))
            .lineLimit(1)
        }
        Image(systemName: row.external == true ? "arrow.up.right" : "chevron.right")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.color("text-muted"))
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
      .frame(maxWidth: .infinity, minHeight: 54)
      .contentShape(Rectangle())
    }
    .buttonStyle(RowStyle())
    .formDisabled(row.isDisabled)
  }
}

/// An entry of a list: tapped to open, with a switch and a menu of actions when it has them.
struct FormItemRow: View {
  @ObservedObject private var theme = Theme.shared
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
    HStack(spacing: 0) {
      Button {
        tapFeedback()
        send.open(row.id)
      } label: {
        HStack(spacing: 8) {
          VStack(alignment: .leading, spacing: 1) {
            Text(row.title ?? "")
              .font(.system(size: 16, weight: .medium))
              .foregroundStyle(theme.color("text-primary"))
              .lineLimit(1)
            if let detail = row.detail {
              Text(detail)
                .font(.system(size: 13))
                .foregroundStyle(theme.color("text-secondary"))
                .lineLimit(2)
            }
          }
          Spacer(minLength: 0)
          if let badge = row.badge { badgeView(badge) }
        }
        .padding(.leading, 12)
        .padding(.trailing, row.toggle == nil && actions.isEmpty ? 12 : 4)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(RowStyle())
      if row.toggle != nil {
        Toggle(row.title ?? "", isOn: $on)
          .labelsHidden()
          .tint(theme.color("accent"))
          .padding(.horizontal, 8)
      }
      if !actions.isEmpty {
        Menu {
          actionButtons(actions)
        } label: {
          Image(systemName: "ellipsis")
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(theme.color("text-secondary"))
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .padding(.trailing, 4)
      }
    }
    .contextMenu { actionButtons(actions) }
    .onChange(of: on) { value in
      if value != row.toggle { send.change(row.id, value) }
    }
    .onChange(of: row.toggle) { on = $0 ?? false }
  }

  private func badgeView(_ text: String) -> some View {
    let ink = theme.tone(row.tone)
    return Text(text)
      .font(.system(size: 12, weight: .medium))
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

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  func makeUIView(context: Context) -> UITextField {
    let field = UITextField()
    field.delegate = context.coordinator
    field.addTarget(
      context.coordinator, action: #selector(Coordinator.edited(_:)), for: .editingChanged)
    field.font = .systemFont(ofSize: 16)
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
    let theme = Theme.shared
    if !field.isFirstResponder, field.text != text { field.text = text }
    field.textColor = theme.ui("text-primary")
    field.tintColor = theme.ui("accent")
    field.attributedPlaceholder = NSAttributedString(
      string: placeholder, attributes: [.foregroundColor: theme.ui("text-muted")])
    field.isEnabled = context.environment.isEnabled
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
    view.font = .systemFont(ofSize: 16)
    view.textContainerInset = .zero
    view.textContainer.lineFragmentPadding = 0
    typing.apply(to: view)
    return view
  }

  func updateUIView(_ view: GrowingTextView, context: Context) {
    context.coordinator.parent = self
    let theme = Theme.shared
    if !view.isFirstResponder, view.text != text { view.text = text }
    view.textColor = theme.ui("text-primary")
    view.tintColor = theme.ui("accent")
    view.isEditable = context.environment.isEnabled
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
