import SwiftUI
import UIKit

struct QuickItem: Identifiable {
  let id: String
  let label: String
}

/// What the page sends for the AI menu: one of its four states and everything it says in it.
struct QuickState {
  let view: String
  let session: Int
  let title: String
  let label: String?
  let note: String?
  let detail: String?
  let placeholder: String?
  let items: [QuickItem]
  let preview: [Any]?
  let hint: String?
  let copied: String
  let buttons: [AiAction]

  init(_ json: AiJSON) {
    view = json.text("view")
    session = json.int("session")
    title = json.text("title")
    label = json.optionalText("label")
    note = json.optionalText("note")
    detail = json.optionalText("detail")
    placeholder = json.optionalText("placeholder")
    items = json.list("items").map { QuickItem(id: $0.text("id"), label: $0.text("label")) }
    preview = json.raw["preview"] as? [Any]
    hint = json.optionalText("hint")
    copied = json.text("copied")
    buttons = json.list("buttons").map(AiAction.init)
  }
}

final class QuickModel: ObservableObject {
  @Published var state: QuickState?
  @Published var copied = false
}

/// The AI menu as a sheet over the document, lowered so the selection and the change proposed stay in view above it.
final class QuickMenuController: NativePanel {
  private unowned let shell: NativeShell
  private let model = QuickModel()
  private var sheet: UIViewController?

  init(shell: NativeShell) {
    self.shell = shell
  }

  func open(_ body: [String: Any]) {
    guard sheet == nil else { return }
    model.state = nil
    model.copied = false
    let view = QuickMenuView(
      model: model,
      tell: { [weak self] op, data in self?.shell.tell("quick", op, data) },
      close: { [weak self] in self?.close() })
    sheet = PanelSheet.present(
      view, from: shell.presenter, heights: [.medium, .large], undimmed: .medium
    ) { [weak self] in
      self?.sheet = nil
      self?.shell.tell("quick", "close")
    }
  }

  func receive(_ op: String, _ body: [String: Any]) {
    switch op {
    case "state":
      let state = QuickState(AiJSON(body))
      if state.view != "problem" { model.copied = false }
      model.state = state
    case "copy":
      UIPasteboard.general.string = body["text"] as? String ?? ""
      model.copied = true
    case "hide":
      close()
    default:
      break
    }
  }

  private func close() {
    guard let sheet else {
      shell.tell("quick", "close")
      return
    }
    PanelSheet.close(sheet)
  }
}

private func quickTap() {
  UIImpactFeedbackGenerator(style: .light).impactOccurred()
}

struct QuickMenuView: View {
  @ObservedObject var model: QuickModel
  @ObservedObject private var theme = Theme.shared
  let tell: (String, [String: Any]) -> Void
  let close: () -> Void
  @State private var typed = ""
  @FocusState private var focused: Bool

  var body: some View {
    if let state = model.state {
      ScrollView {
        VStack(spacing: 8) {
          bar(state)
          card(state)
        }
        .padding(12)
      }
      .onChange(of: state.session) { _ in typed = "" }
    }
  }

  // MARK: The bar

  /// The ringed bar the popover leads with: the mark, then what is asked, run or wrong.
  private func bar(_ state: QuickState) -> some View {
    HStack(spacing: 10) {
      Image(systemName: "sparkles")
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(theme.color("accent"))
      switch state.view {
      case "menu":
        field(state)
      case "running":
        HStack(spacing: 8) {
          label(state.label)
          QuickSpinner()
        }
      case "problem":
        label(state.label)
      default:
        Text(state.note ?? "")
          .font(.system(size: 13))
          .lineSpacing(4)
          .foregroundStyle(theme.color("text-secondary"))
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .padding(.leading, 14)
    .padding(.trailing, 12)
    .frame(minHeight: 44)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(theme.color("dock-bg")))
    .overlay(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .stroke(theme.color("accent-line"), lineWidth: 1.5)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(theme.color("accent-soft"), lineWidth: 4)
        .padding(-2)
    )
    .padding(.horizontal, 2)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(state.title)
  }

  private func label(_ text: String?) -> some View {
    Text(text ?? "")
      .font(.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.color("text-primary"))
      .lineLimit(1)
      .truncationMode(.tail)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func field(_ state: QuickState) -> some View {
    TextField(
      "", text: $typed,
      prompt: Text(state.placeholder ?? "").foregroundColor(theme.color("text-muted"))
    )
    .font(.system(size: 14))
    .foregroundStyle(theme.color("text-primary"))
    .tint(theme.color("accent"))
    .submitLabel(.go)
    .focused($focused)
    .frame(minHeight: 30)
    .accessibilityLabel(state.placeholder ?? "")
    .onChange(of: typed) { text in tell("prompt", ["text": text]) }
    .onSubmit {
      if let first = state.items.first {
        quickTap()
        tell("run", ["id": first.id])
      }
    }
    .onAppear {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { focused = true }
    }
  }

  // MARK: The card

  @ViewBuilder private func card(_ state: QuickState) -> some View {
    if state.view == "menu" {
      VStack(spacing: 0) {
        ForEach(state.items) { item in
          Button {
            quickTap()
            tell("run", ["id": item.id])
          } label: {
            Text(item.label)
              .font(.system(size: 15))
              .foregroundStyle(theme.color("text-primary"))
              .lineLimit(1)
              .truncationMode(.tail)
              .padding(.horizontal, 12)
              .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
              .contentShape(Rectangle())
          }
          .buttonStyle(RowStyle())
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
      }
      .padding(6)
      .background(cardFill)
    } else if hasCard(state) {
      VStack(alignment: .leading, spacing: 6) {
        if let preview = state.preview {
          AiBoundedScroll(maxHeight: 260) {
            MarkdownBlocksView(preview)
              .padding(.vertical, 8)
              .padding(.horizontal, 10)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(theme.color("fill-soft"))
          )
          .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        if state.view == "problem", let note = state.note {
          problem(note, detail: state.detail)
        }
        actions(state)
      }
      .padding(6)
      .background(cardFill)
    }
  }

  private func hasCard(_ state: QuickState) -> Bool {
    !state.buttons.isEmpty || state.preview != nil
  }

  private var cardFill: some View {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
      .fill(theme.color("dock-bg"))
      .overlay(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(theme.color("line"), lineWidth: 1))
  }

  private func problem(_ note: String, detail: String?) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(note)
        .font(.system(size: 13))
        .lineSpacing(4)
        .foregroundStyle(theme.color("text-primary"))
      if let detail {
        Text(detail)
          .font(.system(size: 12))
          .foregroundStyle(theme.color("text-secondary"))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 8)
    .padding(.horizontal, 10)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(theme.color("ai-error").opacity(0.08))
    )
    .overlay(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .stroke(theme.color("ai-error").opacity(0.4), lineWidth: 1))
    .accessibilityElement(children: .combine)
  }

  private func actions(_ state: QuickState) -> some View {
    HStack(spacing: 6) {
      if let hint = state.hint {
        Text(hint)
          .font(.system(size: 11.5))
          .foregroundStyle(theme.color("text-muted"))
          .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        Spacer(minLength: 0)
      }
      ForEach(state.buttons) { button in
        Button {
          quickTap()
          if button.id == "close" { close() } else { tell(button.id, [:]) }
        } label: {
          Text(button.id == "copy" && model.copied ? state.copied : button.label)
            .font(.system(size: 15, weight: button.primary ? .semibold : .regular))
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
        }
        .buttonStyle(AiButtonStyle(kind: button.primary ? .primary : .plain))
      }
    }
    .padding(2)
  }
}

/// The ring beside the command that runs.
private struct QuickSpinner: View {
  @ObservedObject private var theme = Theme.shared
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var turning = false

  var body: some View {
    Circle()
      .trim(from: 0, to: 0.75)
      .stroke(theme.color("accent"), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
      .background(Circle().stroke(theme.color("border-strong"), lineWidth: 1.5))
      .frame(width: 12, height: 12)
      .rotationEffect(.degrees(turning ? 360 : 0))
      .animation(
        reduceMotion ? nil : .linear(duration: 0.8).repeatForever(autoreverses: false), value: turning
      )
      .onAppear { turning = true }
  }
}
