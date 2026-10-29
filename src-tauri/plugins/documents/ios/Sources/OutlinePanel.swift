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
    PanelPage(title: model.title) {
      PanelCloseButton(label: model.close, action: close)
    } content: {
      ScrollViewReader { scroller in
        List {
          if model.items.isEmpty {
            Text(model.empty)
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
          ForEach(model.items) { item in
            row(item).id(item.id)
          }
        }
        .listStyle(.plain)
        .clearListBackground()
        .onChange(of: model.active) { id in
          guard let id else { return }
          withAnimation(.easeOut(duration: 0.2)) { scroller.scrollTo(id) }
        }
        .onAppear {
          if let id = model.active { scroller.scrollTo(id, anchor: .center) }
        }
      }
    }
  }

  private func row(_ item: OutlineModel.Item) -> some View {
    let active = item.id == model.active
    return Button {
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      go(item.id)
    } label: {
      Text(item.text)
        .font(item.depth == 0 ? .body.weight(.semibold) : item.depth == 1 ? .body : .subheadline)
        .foregroundStyle(active ? theme.color("accent") : item.depth <= 1 ? Color.primary : Color.secondary)
        .lineLimit(1)
        .padding(.leading, CGFloat(item.depth) * 16)
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        .contentShape(Rectangle())
    }
    .listRowBackground(active ? theme.color("accent").opacity(0.12) : Color.clear)
    .accessibilityAddTraits(active ? .isSelected : [])
  }
}
