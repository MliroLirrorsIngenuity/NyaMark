import SwiftUI
import UIKit

/// A run of a paragraph, heading or table cell, with the marks on it.
private struct MdRun {
  var text: String
  var bold = false
  var italic = false
  var strike = false
  var code = false
  var math = false
  var link: URL?
}

private enum MdAlign: String {
  case left, center, right

  var text: TextAlignment {
    switch self {
    case .left: return .leading
    case .center: return .center
    case .right: return .trailing
    }
  }

  var frame: Alignment {
    switch self {
    case .left: return .leading
    case .center: return .center
    case .right: return .trailing
    }
  }
}

private struct MdItem {
  let checked: Bool?
  let blocks: [MdBlock]
}

private enum MdBlock {
  case paragraph([MdRun])
  case heading(Int, [MdRun])
  case code(String)
  case math(String)
  case quote([MdBlock])
  case list(ordered: Bool, start: Int, items: [MdItem])
  case table(align: [MdAlign?], head: [[MdRun]], rows: [[[MdRun]]])
  case rule
}

/// Reads the JSON the page sends for `MdBlock[]`; what it does not know is left out.
private enum MdParser {
  static func blocks(_ raw: Any?) -> [MdBlock] {
    (raw as? [Any] ?? []).compactMap { ($0 as? [String: Any]).flatMap(block) }
  }

  static func block(_ json: [String: Any]) -> MdBlock? {
    switch json["kind"] as? String {
    case "paragraph":
      return .paragraph(runs(json["inlines"]))
    case "heading":
      let level = json["level"] as? Int ?? 1
      return .heading(min(max(level, 1), 6), runs(json["inlines"]))
    case "code":
      return .code(json["text"] as? String ?? "")
    case "math":
      return .math(json["text"] as? String ?? "")
    case "quote":
      return .quote(blocks(json["blocks"]))
    case "list":
      let items = (json["items"] as? [[String: Any]] ?? []).map {
        MdItem(checked: $0["checked"] as? Bool, blocks: blocks($0["blocks"]))
      }
      return .list(
        ordered: json["ordered"] as? Bool ?? false, start: json["start"] as? Int ?? 1, items: items)
    case "table":
      return .table(
        align: (json["align"] as? [Any] ?? []).map { ($0 as? String).flatMap(MdAlign.init) },
        head: cells(json["head"]),
        rows: (json["rows"] as? [Any] ?? []).map(cells))
    case "rule":
      return .rule
    default:
      return nil
    }
  }

  private static func cells(_ raw: Any?) -> [[MdRun]] {
    (raw as? [Any] ?? []).map(runs)
  }

  private static func runs(_ raw: Any?) -> [MdRun] {
    (raw as? [[String: Any]] ?? []).map { run in
      MdRun(
        text: run["text"] as? String ?? "",
        bold: run["bold"] as? Bool ?? false,
        italic: run["italic"] as? Bool ?? false,
        strike: run["strike"] as? Bool ?? false,
        code: run["code"] as? Bool ?? false,
        math: run["math"] as? Bool ?? false,
        link: (run["link"] as? String).flatMap { URL(string: $0) })
    }
  }
}

/// The reply's sizes and spacing, in points as the CSS gives them in pixels.
private enum MdMetrics {
  static let body: CGFloat = 14

  /// The `line-spacing` that makes lines `lineHeight` times `size` tall.
  static func leading(_ size: CGFloat, _ lineHeight: CGFloat, mono: Bool = false) -> CGFloat {
    let font = mono ? UIFont.monospacedSystemFont(ofSize: size, weight: .regular) : .systemFont(ofSize: size)
    return max(0, size * lineHeight - font.lineHeight)
  }

  /// Blocks stand apart by the larger of the margins they meet, as in CSS.
  static func gap(_ previous: MdBlock, _ next: MdBlock, inItem: Bool) -> CGFloat {
    max(bottom(previous, inItem: inItem), top(next))
  }

  static func top(_ block: MdBlock) -> CGFloat {
    switch block {
    case .heading: return 16
    case .rule: return 14
    case .math: return 8
    default: return 0
    }
  }

  static func bottom(_ block: MdBlock, inItem: Bool) -> CGFloat {
    switch block {
    case .paragraph: return inItem ? 0 : 10
    case .heading: return 6
    case .rule: return 14
    case .math: return 8
    default: return 10
    }
  }
}

/// A reply's Markdown, as `markdownBlocks` on the page sends it: an array of block objects.
struct MarkdownBlocksView: View {
  @ObservedObject private var theme = Theme.shared
  private let blocks: [MdBlock]

  init(_ blocks: [Any]) {
    self.blocks = MdParser.blocks(blocks)
  }

  var body: some View {
    MdStack(blocks: blocks, ink: theme.color("text-primary"), inItem: false, depth: 0)
      .frame(maxWidth: .infinity, alignment: .leading)
      .tint(theme.color("accent-ink"))
      .textSelection(.enabled)
  }
}

/// Blocks one under another, as `.ny-ai-md` spaces them.
private struct MdStack: View {
  let blocks: [MdBlock]
  let ink: Color
  let inItem: Bool
  /// How many lists the blocks are in, for the bullets.
  let depth: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(blocks.indices, id: \.self) { index in
        MdBlockView(block: blocks[index], ink: ink, inItem: inItem, depth: depth)
          .padding(.top, index == 0 ? 0 : MdMetrics.gap(blocks[index - 1], blocks[index], inItem: inItem))
      }
    }
  }
}

private struct MdBlockView: View {
  @ObservedObject private var theme = Theme.shared
  let block: MdBlock
  let ink: Color
  let inItem: Bool
  let depth: Int

  var body: some View {
    switch block {
    case .paragraph(let runs):
      MdText(runs: runs, ink: ink)
    case .heading(let level, let runs):
      MdText(
        runs: runs, size: level == 1 ? 16.5 : level == 2 ? 15.5 : 14,
        weight: .semibold, lineHeight: 1.4, ink: ink
      )
      .accessibilityAddTraits(.isHeader)
    case .code(let text):
      MdCodeBlock(text: text, ink: ink)
    case .math(let text):
      MdMathBlock(text: text, ink: ink)
    case .quote(let blocks):
      MdStack(blocks: blocks, ink: theme.color("text-secondary"), inItem: false, depth: depth)
        .padding(.leading, 15)
        .overlay(alignment: .leading) {
          Rectangle().fill(theme.color("line")).frame(width: 3)
        }
    case .list(let ordered, let start, let items):
      MdList(ordered: ordered, start: start, items: items, ink: ink, depth: depth)
    case .table(let align, let head, let rows):
      MdTable(align: align, head: head, rows: rows, ink: ink)
    case .rule:
      Rectangle().fill(theme.color("line")).frame(height: 1)
    }
  }
}

/// Runs as one `Text`, the marks as attributes so links stay tappable.
private struct MdText: View {
  @ObservedObject private var theme = Theme.shared
  let runs: [MdRun]
  var size = MdMetrics.body
  var weight = Font.Weight.regular
  var lineHeight: CGFloat = 1.65
  let ink: Color

  var body: some View {
    Text(attributed)
      .foregroundColor(ink)
      .lineSpacing(MdMetrics.leading(size, lineHeight))
      .fixedSize(horizontal: false, vertical: true)
  }

  private var attributed: AttributedString {
    var result = AttributedString()
    for run in runs {
      var piece = AttributedString(run.text)
      let mono = run.code || run.math
      var font = Font.system(
        size: mono ? size * 0.88 : size, weight: run.bold ? .bold : weight,
        design: mono ? .monospaced : .default)
      if run.italic { font = font.italic() }
      piece.font = font
      if run.strike { piece.strikethroughStyle = Text.LineStyle.single }
      if run.code { piece.foregroundColor = theme.color("accent-ink") }
      if let link = run.link {
        piece.link = link
        piece.underlineStyle = Text.LineStyle.single
      }
      result.append(piece)
    }
    return result
  }
}

/// A fenced block as `pre` draws it, with the button that copies its text.
private struct MdCodeBlock: View {
  @ObservedObject private var theme = Theme.shared
  let text: String
  let ink: Color
  @State private var copied = false

  private static let size: CGFloat = 12

  private var shown: String {
    text.hasSuffix("\n") ? String(text.dropLast()) : text
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    ScrollView(.horizontal, showsIndicators: false) {
      Text(shown)
        .font(.system(size: Self.size, design: .monospaced))
        .lineSpacing(MdMetrics.leading(Self.size, 1.55, mono: true))
        .foregroundColor(ink)
        .fixedSize()
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
    .background(shape.fill(theme.color("text-primary").opacity(0.03)))
    .background(shape.fill(theme.color("dock-bg")))
    .overlay(shape.stroke(theme.color("line"), lineWidth: 1))
    .overlay(alignment: .topTrailing) { copyButton.offset(x: 1, y: -4) }
  }

  private var copyButton: some View {
    Button {
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      UIPasteboard.general.string = text
      copied = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
    } label: {
      let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
      Image(systemName: copied ? "checkmark" : "doc.on.doc")
        .font(.system(size: 12, weight: .medium))
        .foregroundColor(theme.color("text-secondary"))
        .frame(width: 30, height: 24)
        .background(shape.fill(theme.color("dock-bg")))
        .overlay(shape.stroke(theme.color("line"), lineWidth: 1))
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

/// Display math as its TeX source in a quiet box.
private struct MdMathBlock: View {
  @ObservedObject private var theme = Theme.shared
  let text: String
  let ink: Color

  private static let size: CGFloat = 12

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      Text(text)
        .font(.system(size: Self.size, design: .monospaced))
        .lineSpacing(MdMetrics.leading(Self.size, 1.55, mono: true))
        .foregroundColor(ink)
        .fixedSize()
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(theme.color("fill-soft")))
  }
}

/// A list with its markers in the 20 pt its items are indented by.
private struct MdList: View {
  @ObservedObject private var theme = Theme.shared
  let ordered: Bool
  let start: Int
  let items: [MdItem]
  let ink: Color
  let depth: Int

  private static let bullets = ["•", "◦", "▪"]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(items.indices, id: \.self) { index in
        HStack(alignment: .firstTextBaseline, spacing: 0) {
          marker(items[index], index)
          MdStack(blocks: items[index].blocks, ink: ink, inItem: true, depth: depth + 1)
        }
        .padding(.top, index == 0 ? 0 : gap(after: items[index - 1]))
      }
    }
  }

  /// Items stand 3 pt apart, or by the margin their last block ends in.
  private func gap(after item: MdItem) -> CGFloat {
    max(3, item.blocks.last.map { MdMetrics.bottom($0, inItem: true) } ?? 0)
  }

  private func marker(_ item: MdItem, _ index: Int) -> some View {
    let size = MdMetrics.body
    return Group {
      if let checked = item.checked {
        Image(systemName: checked ? "checkmark.square" : "square")
          .font(.system(size: size * 0.9))
          .foregroundColor(checked ? theme.color("accent") : theme.color("text-muted"))
      } else if ordered {
        Text("\(start + index).")
          .font(.system(size: size).monospacedDigit())
          .foregroundColor(ink)
      } else {
        Text(Self.bullets[min(depth, Self.bullets.count - 1)])
          .font(.system(size: size))
          .foregroundColor(ink)
      }
    }
    .fixedSize()
    .padding(.trailing, 5)
    .frame(width: 20, alignment: .trailing)
  }
}

private struct MdColumnWidths: PreferenceKey {
  static var defaultValue: [Int: CGFloat] = [:]

  static func reduce(value: inout [Int: CGFloat], nextValue: () -> [Int: CGFloat]) {
    value.merge(nextValue()) { max($0, $1) }
  }
}

private struct MdRoom: PreferenceKey {
  static var defaultValue: CGFloat = 0

  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

/// A table as `.ny-ai-md table` draws it: scrolling sideways, its columns narrowed to fit before they scroll.
private struct MdTable: View {
  @ObservedObject private var theme = Theme.shared
  let align: [MdAlign?]
  let head: [[MdRun]]
  let rows: [[[MdRun]]]
  let ink: Color
  @State private var natural: [Int: CGFloat] = [:]
  @State private var room: CGFloat = 0

  private static let size: CGFloat = 12.5

  private var columns: Int {
    max(head.count, rows.map(\.count).max() ?? 0)
  }

  private var widths: [CGFloat]? {
    guard room > 0, natural.count == columns else { return nil }
    let borders = CGFloat(columns + 1)
    return Self.fit((0..<columns).map { natural[$0] ?? 0 }, into: room - borders)
  }

  var body: some View {
    let widths = widths
    ScrollView(.horizontal, showsIndicators: false) {
      VStack(spacing: 0) {
        row(head, header: true, widths: widths)
        ForEach(rows.indices, id: \.self) { index in
          Rectangle().fill(theme.color("line")).frame(height: 1)
          row(rows[index], header: false, widths: widths)
        }
      }
      .overlay(Rectangle().strokeBorder(theme.color("line"), lineWidth: 1))
      .onPreferenceChange(MdColumnWidths.self) { natural = $0 }
    }
    .background(
      GeometryReader { proxy in
        Color.clear.preference(key: MdRoom.self, value: proxy.size.width)
      }
    )
    .onPreferenceChange(MdRoom.self) { room = $0 }
  }

  private func row(_ cells: [[MdRun]], header: Bool, widths: [CGFloat]?) -> some View {
    HStack(alignment: .top, spacing: 0) {
      ForEach(0..<columns, id: \.self) { column in
        if column > 0 {
          Rectangle().fill(theme.color("line")).frame(width: 1)
        }
        cell(column < cells.count ? cells[column] : [], column: column, header: header, width: widths?[column])
      }
    }
    .background(header ? theme.color("fill-soft") : Color.clear)
  }

  private func cell(_ runs: [MdRun], column: Int, header: Bool, width: CGFloat?) -> some View {
    let cellAlign = column < align.count ? align[column] : nil
    let weight = header ? Font.Weight.semibold : .regular
    let content = MdText(runs: runs, size: Self.size, weight: weight, ink: ink)
    return content
      .multilineTextAlignment(cellAlign?.text ?? (header ? .center : .leading))
      .padding(.horizontal, 9)
      .padding(.vertical, 5)
      .frame(width: width, alignment: cellAlign?.frame ?? (header ? .center : .leading))
      .frame(maxHeight: .infinity, alignment: .top)
      .background(
        content.fixedSize()
          .padding(.horizontal, 9)
          .background(
            GeometryReader { proxy in
              Color.clear.preference(
                key: MdColumnWidths.self, value: [column: proxy.size.width.rounded(.up)])
            }
          )
          .opacity(0)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      )
  }

  /// Column widths that fit `room`: columns narrower than their share keep their width, the rest share what is left.
  private static func fit(_ natural: [CGFloat], into room: CGFloat) -> [CGFloat] {
    guard natural.reduce(0, +) > room else { return natural }
    var widths = natural
    var open = Array(natural.indices)
    var left = room
    while !open.isEmpty {
      let share = left / CGFloat(open.count)
      let narrow = open.filter { natural[$0] <= share }
      if narrow.isEmpty {
        for index in open { widths[index] = share }
        break
      }
      for index in narrow { left -= natural[index] }
      open.removeAll { narrow.contains($0) }
    }
    return widths
  }
}
