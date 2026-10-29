import SwiftUI
import UIKit

final class OutlineModel: ObservableObject {
  struct Item: Identifiable, Equatable {
    let id: String
    let text: String
    let depth: Int
  }

  @Published var title = L10n.text("outline")
  @Published var close = L10n.text("cancel")
  @Published var empty = ""
  @Published var items: [Item] = []
  @Published var active: String?
}

/// The outline as the page's sheet showed it: the document's headings, the one being read marked.
final class OutlinePanelController: NativePanel {
  private unowned let shell: NativeShell
  private let model = OutlineModel()
  private var sheet: UIViewController?

  init(shell: NativeShell) {
    self.shell = shell
  }

  func open(_ body: [String: Any]) {
    guard sheet == nil else { return }
    let view = OutlineView(
      model: model,
      go: { [weak self] id in self?.go(to: id) },
      close: { [weak self] in self?.close() })
    sheet = PanelSheet.present(view, from: shell.presenter, heights: [.outline, .large]) {
      [weak self] in
      self?.sheet = nil
      self?.shell.tell("outline", "close")
    }
    shell.tell("outline", "open")
  }

  func receive(_ op: String, _ body: [String: Any]) {
    switch op {
    case "headings":
      model.title = body["title"] as? String ?? model.title
      model.close = body["close"] as? String ?? model.close
      model.empty = body["empty"] as? String ?? ""
      model.items = (body["headings"] as? [[String: Any]] ?? []).compactMap { heading in
        guard let id = heading["id"] as? String else { return nil }
        return OutlineModel.Item(
          id: id, text: heading["text"] as? String ?? "", depth: heading["depth"] as? Int ?? 0)
      }
    case "active":
      model.active = body["id"] as? String
    default:
      break
    }
  }

  private func go(to id: String) {
    model.active = id
    shell.tell("outline", "go", ["id": id])
    if sheet?.traitCollection.horizontalSizeClass == .compact { close() }
  }

  private func close() {
    guard let sheet else { return }
    PanelSheet.close(sheet)
  }
}

struct OutlineView: View {
  @ObservedObject var model: OutlineModel
  @ObservedObject private var theme = Theme.shared
  let go: (String) -> Void
  let close: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      PanelHeader(title: model.title) {
        CircleButton(symbol: "xmark", label: model.close, action: close)
      }
      ScrollViewReader { scroller in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 6) {
            if model.items.isEmpty {
              Text(model.empty)
                .font(.system(size: 14))
                .foregroundStyle(theme.color("text-muted"))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
            }
            ForEach(model.items) { item in
              row(item).id(item.id)
            }
          }
          .padding(.horizontal, 12)
          .padding(.top, 8)
          .padding(.bottom, 16)
        }
        .onChange(of: model.active) { id in
          guard let id else { return }
          withAnimation(.easeOut(duration: 0.2)) { scroller.scrollTo(id, anchor: nil) }
        }
        .onAppear {
          if let id = model.active { scroller.scrollTo(id, anchor: .center) }
        }
      }
    }
  }

  private func row(_ item: OutlineModel.Item) -> some View {
    let active = item.id == model.active
    let ink =
      active
      ? theme.color("accent-ink")
      : item.depth <= 1 ? theme.color("text-primary") : theme.color("text-secondary")
    return Button {
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      go(item.id)
    } label: {
      Text(item.text)
        .font(.system(size: item.depth >= 2 ? 14 : 15, weight: item.depth == 0 ? .semibold : .regular))
        .foregroundStyle(ink)
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.leading, 10 + CGFloat(item.depth) * 14)
        .padding(.trailing, 10)
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        .contentShape(Rectangle())
    }
    .buttonStyle(OutlineRowStyle(active: active))
    .padding(.top, item.depth == 0 && item.id != model.items.first?.id ? 4 : 0)
    .accessibilityAddTraits(active ? .isSelected : [])
  }
}

struct OutlineRowStyle: ButtonStyle {
  @ObservedObject private var theme = Theme.shared
  let active: Bool

  func makeBody(configuration: Configuration) -> some View {
    let fill =
      active || configuration.isPressed ? theme.color("accent-soft") : Color.clear
    return configuration.label
      .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(fill))
      .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
  }
}
