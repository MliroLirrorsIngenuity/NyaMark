import Foundation
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

private struct PathArgs: Decodable { let path: String }
private struct OptionalPathArgs: Decodable { let path: String? }
private struct IdArgs: Decodable { let id: String }
private struct ExtensionsArgs: Decodable { let extensions: [String] }
private struct ListArgs: Decodable {
  let path: String
  let extensions: [String]
}
private struct CreateArgs: Decodable {
  let folder: String
  let baseName: String
  let ext: String

  enum CodingKeys: String, CodingKey {
    case folder, baseName
    case ext = "extension"
  }
}
private struct RenameArgs: Decodable {
  let path: String
  let stem: String
}
private struct ReadArgs: Decodable {
  let path: String
  let limit: UInt64
}
private struct WriteArgs: Decodable {
  let path: String
  let data: String
}
private struct ShareArgs: Decodable {
  let path: String
  let name: String
  let anchor: Anchor?
}
private struct SharePdfArgs: Decodable {
  let name: String
  let page: PdfPage
  let anchor: Anchor?
}
private struct NameArgs: Decodable { let name: String }
private struct InboxArgs: Decodable { let fileName: String }

private struct PathResult: Encodable {
  let path: String?

  enum CodingKeys: String, CodingKey { case path }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(path, forKey: .path)
  }
}

private struct Contents: Encodable { let data: String }

/// Keeps a document picker's delegate alive until the picker is done.
private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let completion: (URL?) -> Void

  init(completion: @escaping (URL?) -> Void) {
    self.completion = completion
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    completion(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    completion(nil)
  }
}

class DocumentsPlugin: Plugin {
  private let queue = DispatchQueue(label: "best.lolicon.nyamark.documents", qos: .userInitiated)
  private let library = Library()
  private weak var webView: WKWebView?
  private var picker: PickerDelegate?
  private var deviceName = "iPhone"
  private var coverView: UIView?

  @objc public override func load(webview: WKWebView) {
    webView = webview
    deviceName = UIDevice.current.localizedModel
    // The page is the app's screen: only its panes scroll, and a long press on a link opens no web preview.
    webview.scrollView.isScrollEnabled = false
    webview.scrollView.bounces = false
    webview.allowsLinkPreview = false
  }

  // MARK: Covering a reload

  /// Holds a picture of the page over it while the page loads another document.
  @objc public func cover(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      guard let webView = self.webView, let container = webView.superview else {
        invoke.resolve()
        return
      }
      webView.takeSnapshot(with: nil) { image, _ in
        self.removeCover(animated: false)
        if let image {
          let picture = UIImageView(image: image)
          picture.frame = webView.frame
          container.insertSubview(picture, aboveSubview: webView)
          self.coverView = picture
          DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self, weak picture] in
            if let picture, self?.coverView === picture { self?.removeCover(animated: true) }
          }
        }
        invoke.resolve()
      }
    }
  }

  @objc public func uncover(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      self.removeCover(animated: true)
      invoke.resolve()
    }
  }

  private func removeCover(animated: Bool) {
    guard let picture = coverView else { return }
    coverView = nil
    UIView.animate(withDuration: animated ? 0.18 : 0) {
      picture.alpha = 0
    } completion: { _ in
      picture.removeFromSuperview()
    }
  }

  /// Runs `body` on the plugin's queue and answers the page with its result or failure.
  private func respond<T: Encodable>(_ invoke: Invoke, _ body: @escaping () throws -> T) {
    queue.async {
      do {
        invoke.resolve(try body())
      } catch {
        let failure = Failure.from(error)
        invoke.reject(failure.message, code: failure.code)
      }
    }
  }

  private func respondEmpty(_ invoke: Invoke, _ body: @escaping () throws -> Void) {
    queue.async {
      do {
        try body()
        invoke.resolve()
      } catch {
        let failure = Failure.from(error)
        invoke.reject(failure.message, code: failure.code)
      }
    }
  }

  private func reject(_ invoke: Invoke, _ error: Error) {
    let failure = Failure.from(error)
    invoke.reject(failure.message, code: failure.code)
  }

  private func present(_ controller: UIViewController) {
    Sharing.topController(from: manager.viewController)?.present(controller, animated: true)
  }

  private func pick(types: [UTType], completion: @escaping (URL?) -> Void) {
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
      picker.allowsMultipleSelection = false
      picker.shouldShowFileExtensions = true
      let delegate = PickerDelegate { [weak self] url in
        self?.picker = nil
        completion(url)
      }
      self.picker = delegate
      picker.delegate = delegate
      self.present(picker)
    }
  }

  // MARK: Library

  @objc public func locations(_ invoke: Invoke) throws {
    let device = deviceName
    respond(invoke) { self.library.locations(deviceName: device) }
  }

  @objc public func pickFolder(_ invoke: Invoke) throws {
    pick(types: [.folder]) { url in
      guard let url else {
        invoke.resolve()
        return
      }
      self.respond(invoke) { try self.library.addFolder(url) }
    }
  }

  @objc public func removeFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(IdArgs.self)
    respondEmpty(invoke) { self.library.removeFolder(id: args.id) }
  }

  @objc public func list(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ListArgs.self)
    let extensions = Set(args.extensions.map { $0.lowercased() })
    queue.async {
      FileAccess.list(URL(fileURLWithPath: args.path, isDirectory: true), extensions: extensions) {
        result in
        switch result {
        case .success(let entries): invoke.resolve(entries)
        case .failure(let error): self.reject(invoke, error)
        }
      }
    }
  }

  @objc public func createDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CreateArgs.self)
    respond(invoke) {
      let url = try FileAccess.createDocument(
        in: URL(fileURLWithPath: args.folder, isDirectory: true), baseName: args.baseName,
        extension: args.ext)
      return PathResult(path: canonicalPath(url))
    }
  }

  @objc public func rename(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(RenameArgs.self)
    respond(invoke) {
      let url = try FileAccess.rename(URL(fileURLWithPath: args.path), to: args.stem)
      return PathResult(path: canonicalPath(url))
    }
  }

  @objc public func delete(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    respondEmpty(invoke) {
      let url = URL(fileURLWithPath: args.path)
      let recent = self.library.recentIDs(at: canonicalPath(url))
      try FileAccess.delete(url)
      self.library.forget(ids: recent)
    }
  }

  @objc public func pickDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ExtensionsArgs.self)
    var types: [UTType] = []
    for ext in args.extensions {
      if let type = UTType(filenameExtension: ext), !types.contains(type) { types.append(type) }
    }
    pick(types: types.isEmpty ? [.plainText] : types) { url in
      guard let url else {
        invoke.resolve(PathResult(path: nil))
        return
      }
      self.respond(invoke) {
        try self.library.noteOpened(url)
        return PathResult(path: canonicalPath(url))
      }
    }
  }

  @objc public func recents(_ invoke: Invoke) throws {
    respond(invoke) { self.library.recents() }
  }

  @objc public func removeRecent(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(IdArgs.self)
    respondEmpty(invoke) { self.library.removeRecent(id: args.id) }
  }

  @objc public func opened(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    respondEmpty(invoke) { try self.library.noteOpened(URL(fileURLWithPath: args.path)) }
  }

  @objc public func setCurrent(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OptionalPathArgs.self)
    respondEmpty(invoke) { try self.library.setCurrent(path: args.path) }
  }

  @objc public func current(_ invoke: Invoke) throws {
    respond(invoke) { PathResult(path: self.library.current()) }
  }

  // MARK: Reads and writes of the open document, from Rust

  @objc public func read(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ReadArgs.self)
    respond(invoke) {
      let data = try FileAccess.read(URL(fileURLWithPath: args.path), limit: args.limit)
      return Contents(data: data.base64EncodedString())
    }
  }

  @objc public func write(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WriteArgs.self)
    guard let data = Data(base64Encoded: args.data) else {
      throw Failure.io("The document's contents could not be decoded.")
    }
    respondEmpty(invoke) { try FileAccess.write(data, to: URL(fileURLWithPath: args.path)) }
  }

  /// Waits until iCloud has the file on the device, so it can be opened by its path.
  @objc public func download(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    respondEmpty(invoke) {
      _ = try FileAccess.read(URL(fileURLWithPath: args.path), limit: .max)
    }
  }

  // MARK: Sharing

  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    queue.async {
      do {
        let data = try FileAccess.read(URL(fileURLWithPath: args.path), limit: .max)
        let copy = try Sharing.temporaryFile(named: try validName(args.name))
        try data.write(to: copy)
        DispatchQueue.main.async {
          Sharing.present(
            file: copy, from: self.manager.viewController, webView: self.webView,
            anchor: args.anchor)
          invoke.resolve()
        }
      } catch {
        self.reject(invoke, error)
      }
    }
  }

  @objc public func sharePdf(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SharePdfArgs.self)
    DispatchQueue.main.async {
      guard let webView = self.webView else {
        invoke.reject("The page is not available.", code: "unavailable")
        return
      }
      do {
        let copy = try Sharing.temporaryFile(named: try validName(args.name))
        try Sharing.pdf(of: webView, page: args.page).write(to: copy)
        Sharing.present(
          file: copy, from: self.manager.viewController, webView: webView, anchor: args.anchor)
        invoke.resolve()
      } catch {
        self.reject(invoke, error)
      }
    }
  }

  @objc public func print(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(NameArgs.self)
    DispatchQueue.main.async {
      guard let webView = self.webView else {
        invoke.reject("The page is not available.", code: "unavailable")
        return
      }
      Sharing.print(webView, name: args.name) { invoke.resolve() }
    }
  }

  // MARK: Inbox

  @objc public func drainInbox(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(InboxArgs.self)
    respond(invoke) {
      let name = try validName(args.fileName)
      let target = self.library.primaryFolder().appendingPathComponent(name)
      return PathResult(path: try Inbox.drain(into: target).map(canonicalPath))
    }
  }
}

@_cdecl("init_plugin_documents")
func initPlugin() -> Plugin {
  return DocumentsPlugin()
}
