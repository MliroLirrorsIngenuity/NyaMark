import SwiftUI
import UIKit

/// How tall a panel's sheet stands.
enum PanelHeight {
  /// The outline's 72% of the screen, as the page's sheet stood.
  case outline
  case medium
  case large
}

/// Shows a native panel as the system's sheet, rounded as NyaMark's sheets are, the document kept usable above it when it is low.
final class PanelSheet: NSObject, UISheetPresentationControllerDelegate {
  private static var open: [ObjectIdentifier: PanelSheet] = [:]
  private let dismissed: () -> Void

  private init(dismissed: @escaping () -> Void) {
    self.dismissed = dismissed
  }

  /// Presents `content` from `presenter`; `dismissed` runs however the sheet goes away.
  @discardableResult
  static func present<Content: View>(
    _ content: Content, from presenter: UIViewController, heights: [PanelHeight],
    undimmed: PanelHeight? = nil, dismissed: @escaping () -> Void = {}
  ) -> UIViewController {
    let host = UIHostingController(rootView: content)
    host.view.backgroundColor = .clear
    host.modalPresentationStyle = .pageSheet
    let watcher = PanelSheet(dismissed: dismissed)
    open[ObjectIdentifier(host)] = watcher
    if let sheet = host.sheetPresentationController {
      sheet.delegate = watcher
      sheet.detents = heights.map(detent)
      sheet.largestUndimmedDetentIdentifier = undimmed.map(identifier)
      sheet.prefersGrabberVisible = true
      sheet.preferredCornerRadius = Theme.radius
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    }
    presenter.present(host, animated: true)
    return host
  }

  /// Takes the sheet holding `controller` away, then runs `then`.
  static func close(_ controller: UIViewController, then: (() -> Void)? = nil) {
    controller.dismiss(animated: true) {
      open.removeValue(forKey: ObjectIdentifier(controller))?.dismissed()
      then?()
    }
  }

  func presentationControllerDidDismiss(_ controller: UIPresentationController) {
    Self.open.removeValue(forKey: ObjectIdentifier(controller.presentedViewController))?.dismissed()
  }

  private static let outlineIdentifier = UISheetPresentationController.Detent.Identifier(
    "nyamark.outline")

  private static func identifier(_ height: PanelHeight)
    -> UISheetPresentationController.Detent.Identifier
  {
    switch height {
    case .medium: return .medium
    case .large: return .large
    case .outline:
      if #available(iOS 16.0, *) { return outlineIdentifier }
      return .medium
    }
  }

  private static func detent(_ height: PanelHeight) -> UISheetPresentationController.Detent {
    switch height {
    case .medium: return .medium()
    case .large: return .large()
    case .outline:
      if #available(iOS 16.0, *) {
        return .custom(identifier: outlineIdentifier) { $0.maximumDetentValue * 0.72 }
      }
      return .medium()
    }
  }
}

/// A panel's 60-point header, as `.ny-dock__header` draws it: the title on the left and round buttons on the right.
struct PanelHeader<Trailing: View>: View {
  @ObservedObject private var theme = Theme.shared
  let title: String
  @ViewBuilder let trailing: () -> Trailing

  var body: some View {
    HStack(spacing: 6) {
      Text(title)
        .font(.system(size: 17, weight: .semibold))
        .foregroundStyle(theme.color("text-primary"))
        .lineLimit(1)
      Spacer(minLength: 8)
      GlassGroup(spacing: 6) {
        HStack(spacing: 6) { trailing() }
      }
    }
    .padding(.leading, 20)
    .padding(.trailing, 12)
    .frame(height: 60)
    .overlay(alignment: .bottom) {
      Rectangle().fill(theme.color("border-soft")).frame(height: 1)
    }
  }
}

/// A native panel and the page's side of it, which sends it what to show.
protocol NativePanel: AnyObject {
  /// Opens the panel, as the editor page's bottom bar asks.
  func open(_ body: [String: Any])
  /// A message from the page's side of the panel.
  func receive(_ op: String, _ body: [String: Any])
}

extension NativeShell {
  /// Sends `op` to the page's side of the panel named `panel`.
  func tell(_ panel: String, _ op: String, _ data: [String: Any] = [:]) {
    var message = data
    message["type"] = "panel"
    message["panel"] = panel
    message["op"] = op
    send(message)
  }
}
