import Combine
import SwiftUI
import UIKit

/// A note of the page: a glass capsule over everything that goes away by itself.
final class ToastController: NativePanel {
  private unowned let shell: NativeShell
  private var showing: ToastNote?

  init(shell: NativeShell) {
    self.shell = shell
  }

  func open(_ body: [String: Any]) {}

  func receive(_ op: String, _ body: [String: Any]) {
    guard op == "show", let window = shell.presenter.view.window else { return }
    showing?.remove()
    let note = ToastNote(
      window: window, title: body["title"] as? String ?? "",
      detail: body["detail"] as? String ?? "", warning: body["kind"] as? String == "warning",
      duration: (body["duration"] as? Double ?? 3200) / 1000
    ) { [weak self] note in
      if self?.showing === note { self?.showing = nil }
    }
    showing = note
    note.present()
  }
}

/// What a note says and where it is in coming and going.
final class ToastModel: ObservableObject {
  let title: String
  let detail: String
  let warning: Bool
  @Published var shown = false
  @Published var leaving = false
  var tap: () -> Void = {}

  init(title: String, detail: String, warning: Bool) {
    self.title = title
    self.detail = detail
    self.warning = warning
  }
}

/// One note on the window, 8 points under the top of the safe area.
private final class ToastNote {
  private static let belowTop: CGFloat = 8
  private static let fadeOut = 0.2

  private weak var window: UIWindow?
  private let model: ToastModel
  private let host: UIHostingController<ToastView>
  private let duration: TimeInterval
  private let finished: (ToastNote) -> Void
  private var timeout: DispatchWorkItem?
  private var removed = false

  init(
    window: UIWindow, title: String, detail: String, warning: Bool,
    duration: TimeInterval, finished: @escaping (ToastNote) -> Void
  ) {
    self.window = window
    self.duration = duration
    self.finished = finished
    model = ToastModel(title: title, detail: detail, warning: warning)
    host = UIHostingController(rootView: ToastView(model: model))
    model.tap = { [weak self] in self?.leave() }
  }

  func present() {
    guard let window else { return }
    let view = host.view!
    view.backgroundColor = .clear
    view.translatesAutoresizingMaskIntoConstraints = false
    let widest = min(420, window.bounds.width - 32)
    let size = host.sizeThatFits(in: CGSize(width: widest, height: .greatestFiniteMagnitude))
    window.addSubview(view)
    NSLayoutConstraint.activate([
      view.centerXAnchor.constraint(equalTo: window.centerXAnchor),
      view.widthAnchor.constraint(equalToConstant: ceil(size.width)),
      view.heightAnchor.constraint(equalToConstant: ceil(size.height)),
      view.topAnchor.constraint(
        equalTo: window.safeAreaLayoutGuide.topAnchor, constant: Self.belowTop),
    ])
    window.layoutIfNeeded()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { [weak self] in
      self?.model.shown = true
    }
    let leaving = DispatchWorkItem { [weak self] in self?.leave() }
    timeout = leaving
    DispatchQueue.main.asyncAfter(deadline: .now() + duration, execute: leaving)
    let spoken = model.detail.isEmpty ? model.title : "\(model.title). \(model.detail)"
    UIAccessibility.post(notification: .announcement, argument: spoken)
  }

  /// Fades out, then goes.
  private func leave() {
    guard !removed, !model.leaving else { return }
    timeout?.cancel()
    model.leaving = true
    model.shown = false
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.fadeOut) { [weak self] in
      self?.remove()
    }
  }

  /// Takes the note away at once.
  func remove() {
    guard !removed else { return }
    removed = true
    timeout?.cancel()
    host.view.removeFromSuperview()
    finished(self)
  }
}

/// The capsule of a note: the kind's icon, the title and the detail.
struct ToastView: View {
  @ObservedObject var model: ToastModel
  @ObservedObject private var theme = Theme.shared

  var body: some View {
    let lit = model.shown || model.leaving
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: model.warning ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(model.warning ? Color.orange : theme.color("accent"))
      VStack(alignment: .leading, spacing: 2) {
        Text(model.title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)
        if !model.detail.isEmpty {
          Text(model.detail)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 12)
    .glass(Capsule())
    .opacity(model.shown ? 1 : 0)
    .offset(y: lit ? 0 : -8)
    .scaleEffect(lit ? 1 : 0.98)
    .animation(
      model.shown ? .timingCurve(0.16, 1, 0.3, 1, duration: 0.22) : .easeIn(duration: 0.2),
      value: model.shown
    )
    .contentShape(Capsule())
    .onTapGesture { model.tap() }
    .accessibilityElement(children: .combine)
  }
}
