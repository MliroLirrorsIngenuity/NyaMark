import SwiftUI
import UIKit

private let tapHaptics = UIImpactFeedbackGenerator(style: .light)

/// A round 44-point button in the bars, as the page draws `.ny-shell__icon-button`.
struct CircleButton: View {
  @ObservedObject private var theme = Theme.shared
  let symbol: String
  let label: String
  var disabled = false
  let action: () -> Void

  var body: some View {
    Button {
      tapHaptics.impactOccurred()
      action()
    } label: {
      Image(systemName: symbol)
        .font(.system(size: 18, weight: .medium))
        .frame(width: 44, height: 44)
    }
    .buttonStyle(ControlStyle(shape: .circle))
    .disabled(disabled)
    .accessibilityLabel(label)
  }
}

/// NyaMark's round controls as glass, tinted with the accent while pressed.
struct ControlStyle: ButtonStyle {
  enum Shape { case circle }
  @ObservedObject private var theme = Theme.shared
  let shape: Shape

  func makeBody(configuration: Configuration) -> some View {
    let ink = configuration.isPressed ? theme.color("accent-ink") : theme.color("text-primary")
    return configuration.label
      .foregroundStyle(ink)
      .glass(Circle(), interactive: true, lit: configuration.isPressed)
      .scaleEffect(configuration.isPressed ? 0.95 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

/// A row of a card, highlighted while pressed as `.ny-library__row:active` is.
struct RowStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(configuration.isPressed ? theme.color("accent-soft") : Color.clear)
      .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
  }
}

/// A rounded card holding rows with hairlines between them.
struct Card<Content: View>: View {
  @ObservedObject private var theme = Theme.shared
  @ViewBuilder let content: () -> Content

  var body: some View {
    VStack(spacing: 0) {
      content()
    }
    .background(theme.color("fill-soft"))
    .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
        .stroke(theme.color("border-soft"), lineWidth: 1))
  }
}

struct Hairline: View {
  @ObservedObject private var theme = Theme.shared

  var body: some View {
    Rectangle()
      .fill(theme.color("border-soft"))
      .frame(height: 1)
      .padding(.leading, 58)
  }
}

/// Icon, name and detail of a library row.
struct RowLabel: View {
  @ObservedObject private var theme = Theme.shared
  let symbol: String
  let title: String
  var detail: String? = nil
  var current = false
  var dimmed = false

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: symbol)
        .font(.system(size: 20))
        .foregroundStyle(theme.color("accent-ink"))
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
          .font(.system(size: 16, weight: .medium))
          .foregroundStyle(current ? theme.color("accent-ink") : theme.color("text-primary"))
          .lineLimit(1)
        if let detail {
          Text(detail)
            .font(.system(size: 13))
            .foregroundStyle(theme.color("text-secondary"))
            .lineLimit(2)
        }
      }
      Spacer(minLength: 0)
    }
    .opacity(dimmed ? 0.5 : 1)
    .padding(.vertical, 8)
    .padding(.leading, 18)
    .frame(minHeight: 52)
    .contentShape(Rectangle())
  }
}

struct SheetAction: Identifiable {
  let id = UUID()
  let title: String
  var destructive = false
  let run: () -> Void
}

/// Puts a SwiftUI view over everything, its own animations bringing it in and taking it out.
final class OverlayPresenter {
  /// `content` gets the function that takes the view away and then runs what it is given.
  static func present<Content: View>(
    from presenter: UIViewController, _ content: (@escaping ((() -> Void)?) -> Void) -> Content
  ) {
    let host = UIHostingController(rootView: AnyView(EmptyView()))
    let close: ((() -> Void)?) -> Void = { [weak host] then in
      host?.dismiss(animated: false, completion: then)
    }
    host.rootView = AnyView(content(close))
    host.view.backgroundColor = .clear
    host.modalPresentationStyle = .overFullScreen
    presenter.present(host, animated: false)
  }
}

/// The bottom sheet of actions, as `.ny-library-sheet` and the file menu draw it.
struct ActionSheet: View {
  @ObservedObject private var theme = Theme.shared
  var title: String? = nil
  /// The file menu closes from a ✕ beside its title; the other sheets end with Cancel.
  var closeInHeader = false
  let actions: [SheetAction]
  let cancel: String
  let dismiss: ((() -> Void)?) -> Void
  @State private var shown = false

  var body: some View {
    ZStack(alignment: .bottom) {
      Color.black.opacity(shown ? 0.28 : 0)
        .ignoresSafeArea()
        .onTapGesture { leave(then: nil) }
      if shown {
        VStack(spacing: 6) {
          if let title {
            ZStack {
              Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.color("text-primary"))
              if closeInHeader {
                HStack {
                  CircleButton(symbol: "xmark", label: cancel) { leave(then: nil) }
                  Spacer()
                }
              }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
          }
          ForEach(actions) { action in
            sheetButton(
              action.title, color: action.destructive ? .red : theme.color("text-primary")
            ) { leave(then: action.run) }
          }
          if !closeInHeader {
            sheetButton(cancel, color: theme.color("text-primary"), bold: true) { leave(then: nil) }
          }
        }
        .padding(8)
        .glassCard()
        .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
        .transition(.move(edge: .bottom))
      }
    }
    .onAppear { withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) { shown = true } }
  }

  private func sheetButton(
    _ title: String, color: Color, bold: Bool = false, run: @escaping () -> Void
  ) -> some View {
    Button(action: run) {
      Text(title)
        .font(.system(size: 16, weight: bold ? .semibold : .regular))
        .foregroundStyle(color)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: bold ? .center : .leading)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
    }
    .buttonStyle(SheetButtonStyle())
  }

  private func leave(then run: (() -> Void)?) {
    withAnimation(.easeIn(duration: 0.2)) { shown = false }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { dismiss(run) }
  }
}

struct SheetButtonStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .fill(configuration.isPressed ? theme.color("accent-soft") : theme.color("fill-soft")))
      .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
  }
}

/// The rename dialog, as `.ny-library-dialog` draws it: the name field and two buttons.
struct RenameDialog: View {
  @ObservedObject private var theme = Theme.shared
  let initial: String
  /// Renames to the name typed; returns a message to show when it cannot.
  let submit: (String, @escaping (String?) -> Void) -> Void
  let dismiss: ((() -> Void)?) -> Void
  @State private var name = ""
  @State private var error: String?
  @State private var shown = false
  @State private var busy = false
  @FocusState private var focused: Bool

  var body: some View {
    ZStack {
      Color.black.opacity(shown ? 0.28 : 0)
        .ignoresSafeArea()
        .onTapGesture { leave() }
      if shown {
        VStack(alignment: .leading, spacing: 12) {
          Text(L10n.text("rename"))
            .font(.system(size: 17, weight: .semibold))
            .frame(maxWidth: .infinity)
          Text(L10n.text("name"))
            .font(.system(size: 13))
            .foregroundStyle(theme.color("text-secondary"))
          TextField("", text: $name)
            .focused($focused)
            .submitLabel(.done)
            .onSubmit(confirm)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(
              RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                .fill(theme.color("fill-soft")))
            .overlay(
              RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                .stroke(theme.color("border-soft"), lineWidth: 1))
          if let error {
            Text(error)
              .font(.system(size: 13))
              .foregroundStyle(.red)
          }
          HStack(spacing: 8) {
            dialogButton(L10n.text("cancel"), accent: false, run: leave)
            dialogButton(L10n.text("rename"), accent: true, run: confirm)
              .disabled(busy)
          }
        }
        .foregroundStyle(theme.color("text-primary"))
        .padding(18)
        .glassCard()
        .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
        .padding(.horizontal, 24)
        .transition(.scale(scale: 0.94).combined(with: .opacity))
      }
    }
    .onAppear {
      name = initial
      withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) { shown = true }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { focused = true }
    }
  }

  private func dialogButton(_ title: String, accent: Bool, run: @escaping () -> Void) -> some View {
    Button(action: run) {
      Text(title)
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(accent ? theme.color("accent-ink") : theme.color("text-primary"))
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(DialogButtonStyle(accent: accent))
  }

  private func confirm() {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed.contains("/") || trimmed.contains(":") {
      error = L10n.text("invalidName")
      return
    }
    busy = true
    submit(trimmed) { message in
      busy = false
      if let message {
        error = message
      } else {
        leave()
      }
    }
  }

  private func leave() {
    focused = false
    withAnimation(.easeIn(duration: 0.18)) { shown = false }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { dismiss(nil) }
  }
}

struct DialogButtonStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared
  let accent: Bool

  func makeBody(configuration: Configuration) -> some View {
    let fill =
      configuration.isPressed || accent ? theme.color("accent-soft") : theme.color("fill-soft")
    return configuration.label
      .background(Capsule().fill(fill))
      .opacity(configuration.isPressed ? 0.8 : 1)
  }
}
