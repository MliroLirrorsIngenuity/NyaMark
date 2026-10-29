import Combine
import SwiftUI
import UIKit

/// The system's Liquid Glass in `shape`; a thick material with a hairline before iOS 26.
struct GlassSurface<S: Shape>: ViewModifier {
  @ObservedObject private var theme = Theme.shared
  let shape: S
  var interactive = false
  /// Accent-tinted glass, for the control that is on.
  var lit = false

  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      let glass = lit ? Glass.regular.tint(theme.color("accent")) : Glass.regular
      content.glassEffect(glass.interactive(interactive), in: shape)
    } else {
      content
        .background(lit ? theme.color("accent-soft") : Color.clear, in: shape)
        .background(.thickMaterial, in: shape)
        .overlay(shape.stroke(Color(.separator).opacity(0.4), lineWidth: 0.5))
    }
  }
}

extension View {
  func glass<S: Shape>(_ shape: S, interactive: Bool = false, lit: Bool = false) -> some View {
    modifier(GlassSurface(shape: shape, interactive: interactive, lit: lit))
  }

  /// A floating card of glass with continuous corners.
  func glassCard(radius: CGFloat = Theme.radius) -> some View {
    glass(RoundedRectangle(cornerRadius: radius, style: .continuous))
  }

  /// The system's glass button; a bordered button before iOS 26.
  @ViewBuilder
  func glassButton() -> some View {
    if #available(iOS 26.0, *) {
      buttonStyle(.glass)
    } else {
      buttonStyle(.bordered)
    }
  }

  /// The system's prominent glass button, filled with the accent; a prominent bordered button before iOS 26.
  @ViewBuilder
  func prominentGlassButton() -> some View {
    if #available(iOS 26.0, *) {
      buttonStyle(.glassProminent)
    } else {
      buttonStyle(.borderedProminent)
    }
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

/// The glass behind a UIKit bar.
final class GlassView: UIVisualEffectView {
  private let radius: CGFloat?

  /// A nil `radius` makes a capsule.
  init(radius: CGFloat?, interactive: Bool = false) {
    self.radius = radius
    super.init(effect: nil)
    if #available(iOS 26.0, *) {
      let glass = UIGlassEffect(style: .regular)
      glass.isInteractive = interactive
      effect = glass
      cornerConfiguration = radius.map { .corners(radius: .fixed($0)) } ?? .capsule()
    } else {
      effect = UIBlurEffect(style: .systemThickMaterial)
      layer.cornerCurve = .continuous
      layer.borderWidth = 0.5
      layer.borderColor = UIColor.separator.withAlphaComponent(0.4).cgColor
      clipsToBounds = true
    }
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
}
