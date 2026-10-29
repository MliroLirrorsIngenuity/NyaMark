import SwiftUI
import UIKit

final class FindPanelController: NativePanel {
  private unowned let shell: NativeShell

  init(shell: NativeShell) {
    self.shell = shell
  }

  func open(_ body: [String: Any]) {}

  func receive(_ op: String, _ body: [String: Any]) {}
}
