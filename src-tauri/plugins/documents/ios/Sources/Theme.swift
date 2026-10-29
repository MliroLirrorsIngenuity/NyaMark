import SwiftUI
import UIKit

/// NyaMark's colours, as the page's stylesheet resolves them; the native screens draw with these.
final class Theme: ObservableObject {
  static let shared = Theme()

  /// Colour names as the page reports them: its CSS custom properties without `--ny-`.
  @Published private(set) var colors: [String: UIColor] = [:]
  @Published private(set) var dark = false

  static let radius: CGFloat = 28
  static let controlRadius: CGFloat = 22

  private static let light: [String: UIColor] = [
    "app-bg-start": UIColor(rgb: 0xfffefb),
    "app-bg-end": UIColor(rgb: 0xffffff),
    "statusbar-bg": UIColor(white: 1, alpha: 0.94),
    "border-soft": UIColor(red: 226 / 255, green: 232 / 255, blue: 240 / 255, alpha: 0.5),
    "border-button": UIColor(red: 214 / 255, green: 220 / 255, blue: 229 / 255, alpha: 0.88),
    "fill-soft": UIColor(rgb: 0x17212b, alpha: 0.05),
    "text-primary": UIColor(rgb: 0x17212b),
    "text-secondary": UIColor(rgb: 0x6b7280),
    "text-muted": UIColor(rgb: 0x8b95a3),
    "accent": UIColor(rgb: 0x4d7a8f),
    "accent-soft": UIColor(rgb: 0xecf4f7),
    "accent-ink": UIColor(rgb: 0x2d4753),
    "dock-bg": UIColor(rgb: 0xffffff),
  ]

  private static let night: [String: UIColor] = [
    "app-bg-start": UIColor(rgb: 0x10151b),
    "app-bg-end": UIColor(rgb: 0x131a22),
    "statusbar-bg": UIColor(red: 17 / 255, green: 23 / 255, blue: 31 / 255, alpha: 0.94),
    "border-soft": UIColor(red: 119 / 255, green: 134 / 255, blue: 155 / 255, alpha: 0.16),
    "border-button": UIColor(red: 101 / 255, green: 117 / 255, blue: 139 / 255, alpha: 0.28),
    "fill-soft": UIColor(rgb: 0xedf3f8, alpha: 0.05),
    "text-primary": UIColor(rgb: 0xedf3f8),
    "text-secondary": UIColor(rgb: 0xc7d0db),
    "text-muted": UIColor(rgb: 0x91a0b2),
    "accent": UIColor(rgb: 0x8db4c8),
    "accent-soft": UIColor(red: 96 / 255, green: 135 / 255, blue: 158 / 255, alpha: 0.18),
    "accent-ink": UIColor(rgb: 0x8db4c8),
    "dock-bg": UIColor(rgb: 0x18202a),
  ]

  private init() {
    dark = UITraitCollection.current.userInterfaceStyle == .dark
    colors = dark ? Self.night : Self.light
  }

  /// Takes the colours the page reports: `[r, g, b, a]` bytes by name.
  func update(dark: Bool, reported: [String: [Double]]) {
    var next = dark ? Self.night : Self.light
    for (name, rgba) in reported where rgba.count == 4 {
      next[name] = UIColor(
        red: rgba[0] / 255, green: rgba[1] / 255, blue: rgba[2] / 255, alpha: rgba[3] / 255)
    }
    self.dark = dark
    colors = next
  }

  func ui(_ name: String) -> UIColor {
    colors[name] ?? Self.light[name] ?? .label
  }

  func color(_ name: String) -> Color {
    Color(ui(name))
  }
}

extension UIColor {
  convenience init(rgb: Int, alpha: CGFloat = 1) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255, alpha: alpha)
  }
}

/// The light shadow under NyaMark's floating bars.
extension View {
  func barShadow() -> some View {
    shadow(color: .black.opacity(0.06), radius: 7, x: 0, y: 3)
  }
}
