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
    PanelPage(title: model.state?.title ?? "") {
      PanelCloseButton(label: L10n.text("cancel"), action: close)
    } content: {
      Group {
        if let state = model.state {
          if state.view == "menu" {
            menu(state)
          } else {
            answer(state)
          }
        } else {
          Color.clear
        }
      }
      .onChange(of: model.state?.session) { _ in typed = "" }
    }
  }

  // MARK: The menu

  private func menu(_ state: QuickState) -> some View {
    VStack(spacing: 0) {
      field(state)
      List {
        ForEach(state.items) { item in
          Button {
            quickTap()
            tell("run", ["id": item.id])
          } label: {
            Text(item.label)
              .font(.body)
              .foregroundStyle(Color.primary)
              .lineLimit(1)
              .truncationMode(.tail)
              .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
              .contentShape(Rectangle())
          }
        }
      }
      .listStyle(.plain)
    }
  }

  private func field(_ state: QuickState) -> some View {
    HStack(spacing: 8) {
      Image(systemName: "sparkles")
        .foregroundStyle(theme.color("accent"))
      TextField("", text: $typed, prompt: Text(state.placeholder ?? ""))
        .submitLabel(.go)
        .focused($focused)
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
    .padding(.horizontal, 12)
    .frame(minHeight: 44)
    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
  }

  // MARK: The other states

  /// The states after the menu: no model, a command running, or a problem, each with the reply so far and its buttons.
  private func answer(_ state: QuickState) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        if state.view == "running" {
          HStack(spacing: 10) {
            ProgressView()
            label(state.label)
          }
        } else if state.view == "problem" {
          label(state.label)
        }
        if let preview = state.preview {
          AiBoundedScroll(maxHeight: 260) {
            MarkdownBlocksView(preview)
              .padding(12)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        if let note = state.note {
          noteView(note, detail: state.detail, failed: state.view == "problem")
        }
        if let hint = state.hint {
          Text(hint)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        actions(state)
      }
      .padding(16)
    }
  }

  private func label(_ text: String?) -> some View {
    Text(text ?? "")
      .font(.subheadline.weight(.semibold))
      .lineLimit(1)
      .truncationMode(.tail)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func noteView(_ text: String, detail: String?, failed: Bool) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(text)
        .font(failed ? .footnote : .subheadline)
        .foregroundStyle(failed ? Color.red : Color.primary)
      if let detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private func actions(_ state: QuickState) -> some View {
    if !state.buttons.isEmpty {
      AiAdaptive {
        HStack(spacing: 8) { buttons(state) }
      } stacked: {
        VStack(spacing: 8) { buttons(state) }
      }
    }
  }

  @ViewBuilder private func buttons(_ state: QuickState) -> some View {
    ForEach(state.buttons) { button in
      Button {
        quickTap()
        if button.id == "close" { close() } else { tell(button.id, [:]) }
      } label: {
        Text(button.id == "copy" && model.copied ? state.copied : button.label)
          .frame(maxWidth: .infinity)
      }
      .aiAction(prominent: button.primary)
    }
  }
}
