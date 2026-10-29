import SwiftUI

/// A reply's Markdown, as `markdownBlocks` on the page sends it: an array of block objects.
struct MarkdownBlocksView: View {
  let blocks: [Any]

  init(_ blocks: [Any]) {
    self.blocks = blocks
  }

  var body: some View {
    EmptyView()
  }
}
