import UIKit
import WebKit

struct Anchor: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct PdfPage: Decodable {
  let width: Double
  let height: Double
  let margin: Double
}

/// A renderer with a fixed paper; UIPrintPageRenderer otherwise takes it from a printer.
private final class PaperRenderer: UIPrintPageRenderer {
  private let paper: CGRect
  private let printable: CGRect

  init(page: PdfPage) {
    paper = CGRect(x: 0, y: 0, width: page.width, height: page.height)
    printable = paper.insetBy(dx: page.margin, dy: page.margin)
    super.init()
  }

  override var paperRect: CGRect { paper }
  override var printableRect: CGRect { printable }
}

enum Sharing {
  static func topController(from root: UIViewController?) -> UIViewController? {
    var top = root
    while let presented = top?.presentedViewController { top = presented }
    return top
  }

  /// A fresh folder in the temporary directory holding a file named `name`.
  static func temporaryFile(named name: String) throws -> URL {
    let folder = FileManager.default.temporaryDirectory
      .appendingPathComponent("share", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder.appendingPathComponent(name)
  }

  /// Shows the share sheet for `file`, pointing at `anchor` on iPad, and removes the copy after.
  static func present(file: URL, from root: UIViewController?, webView: WKWebView?, anchor: Anchor?) {
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    sheet.completionWithItemsHandler = { _, _, _, _ in
      try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }
    if let popover = sheet.popoverPresentationController, let view = webView {
      popover.sourceView = view
      popover.sourceRect =
        anchor.map { CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height) }
        ?? CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
    }
    topController(from: root)?.present(sheet, animated: true)
  }

  /// The page as WebKit prints it, cut into pages of `page`'s size.
  static func pdf(of webView: WKWebView, page: PdfPage) -> Data {
    let renderer = PaperRenderer(page: page)
    renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
    let bounds = renderer.paperRect
    return UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
      let count = renderer.numberOfPages
      renderer.prepare(forDrawingPages: NSRange(location: 0, length: count))
      for index in 0..<count {
        context.beginPage()
        renderer.drawPage(at: index, in: context.pdfContextBounds)
      }
    }
  }

  static func print(_ webView: WKWebView, name: String, completion: @escaping () -> Void) {
    let info = UIPrintInfo(dictionary: nil)
    info.jobName = name
    info.outputType = .general
    let controller = UIPrintInteractionController.shared
    controller.printInfo = info
    controller.printFormatter = webView.viewPrintFormatter()
    controller.present(animated: true) { _, _, _ in completion() }
  }
}
