import Combine
import SwiftUI
import UIKit

/// How strongly the bar colour tints the glass; NyaMark's glass is a dense, coloured frost.
private let glassDensity: CGFloat = 0.5

extension Theme {
  /// The colour laid into the glass: the page's bar colour, thinned to `glassDensity`.
  var glassTint: UIColor {
    let bar = ui("statusbar-bg")
    var alpha: CGFloat = 0
    bar.getRed(nil, green: nil, blue: nil, alpha: &alpha)
    return bar.withAlphaComponent(alpha * glassDensity)
  }
}

/// Liquid Glass in `shape`, tinted with NyaMark's bar colour; a thick material with the bar's border before iOS 26.
struct GlassSurface<S: Shape>: ViewModifier {
  @ObservedObject private var theme = Theme.shared
  let shape: S
  var interactive = false
  /// Accent-tinted glass, for the one control that is on or pressed.
  var lit = false

  func body(content: Content) -> some View {
    let tint = lit ? theme.color("accent-soft") : Color(theme.glassTint)
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular.tint(tint).interactive(interactive), in: shape)
    } else {
      content
        .background(tint, in: shape)
        .background(.thickMaterial, in: shape)
        .overlay(shape.stroke(theme.color("border-soft"), lineWidth: 1))
    }
  }
}

extension View {
  func glass<S: Shape>(_ shape: S, interactive: Bool = false, lit: Bool = false) -> some View {
    modifier(GlassSurface(shape: shape, interactive: interactive, lit: lit))
  }

  /// The glass of a floating card: NyaMark's 28-point continuous rounded rectangle.
  func glassCard(radius: CGFloat = Theme.radius) -> some View {
    glass(RoundedRectangle(cornerRadius: radius, style: .continuous))
  }
}

/// Lets neighbouring glass shapes blend and morph into one another on iOS 26.
struct GlassGroup<Content: View>: View {
  var spacing: CGFloat = 12
  @ViewBuilder let content: () -> Content

  var body: some View {
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: spacing) { content() }
    } else {
      content()
    }
  }
}

/// The glass behind a UIKit bar; it follows the theme by itself.
final class GlassView: UIVisualEffectView {
  private let radius: CGFloat?
  private let interactive: Bool
  private var themeWatch: AnyCancellable?

  /// A nil `radius` makes a capsule.
  init(radius: CGFloat?, interactive: Bool = false) {
    self.radius = radius
    self.interactive = interactive
    super.init(effect: nil)
    if #available(iOS 26.0, *) {
      cornerConfiguration =
        radius.map { .corners(radius: .fixed($0)) } ?? .capsule()
    } else {
      layer.cornerCurve = .continuous
      layer.borderWidth = 1
      clipsToBounds = true
    }
    themeWatch = Theme.shared.$colors.sink { [weak self] _ in
      DispatchQueue.main.async { self?.paint() }
    }
    paint()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if #unavailable(iOS 26.0) {
      layer.cornerRadius = radius ?? bounds.height / 2
    }
  }

  private func paint() {
    let theme = Theme.shared
    if #available(iOS 26.0, *) {
      let glass = UIGlassEffect(style: .regular)
      glass.tintColor = theme.glassTint
      glass.isInteractive = interactive
      effect = glass
    } else {
      effect = UIBlurEffect(style: .systemThickMaterial)
      contentView.backgroundColor = theme.glassTint
      layer.borderColor = theme.ui("border-soft").cgColor
    }
  }
}
