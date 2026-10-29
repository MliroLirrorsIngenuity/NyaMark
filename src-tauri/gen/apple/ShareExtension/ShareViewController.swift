import Social
import UIKit
import UniformTypeIdentifiers

/// Leaves what was shared in the app group's inbox; NyaMark appends it to the inbox document.
final class ShareViewController: SLComposeServiceViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    title = NSLocalizedString("share.title", comment: "Title of the share sheet")
    placeholder = NSLocalizedString("share.placeholder", comment: "Placeholder of the text")
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    navigationController?.navigationBar.topItem?.rightBarButtonItem?.title =
      NSLocalizedString("share.add", comment: "Button that adds the text")
  }

  override func isContentValid() -> Bool {
    true
  }

  override func configurationItems() -> [Any]! {
    []
  }

  override func didSelectPost() {
    let text = (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    sharedURL { url in
      var blocks: [String] = []
      if !text.isEmpty { blocks.append(text) }
      if let url, ["http", "https"].contains(url.scheme?.lowercased()),
        !text.contains(url.absoluteString)
      {
        blocks.append("<\(url.absoluteString)>")
      }
      if !blocks.isEmpty { Self.save(blocks) }
      self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }

  private func sharedURL(_ completion: @escaping (URL?) -> Void) {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
    guard
      let provider = providers.first(where: {
        $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
      })
    else {
      completion(nil)
      return
    }
    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
      DispatchQueue.main.async { completion(item as? URL) }
    }
  }

  private static func save(_ blocks: [String]) {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "NyaMarkAppGroup") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else { return }
    let folder = container.appendingPathComponent("Inbox", isDirectory: true)
    let stamp = DateFormatter()
    stamp.locale = Locale(identifier: "en_US_POSIX")
    stamp.dateFormat = "yyyy-MM-dd HH:mm"
    let order = DateFormatter()
    order.locale = Locale(identifier: "en_US_POSIX")
    order.dateFormat = "yyyyMMdd-HHmmss-SSS"
    let now = Date()
    let entry = (["### \(stamp.string(from: now))"] + blocks).joined(separator: "\n\n")
    let file = folder.appendingPathComponent("\(order.string(from: now))-\(UUID().uuidString).md")
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try? Data((entry + "\n").utf8).write(to: file, options: .atomic)
  }
}
