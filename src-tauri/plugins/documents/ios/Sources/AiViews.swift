import SwiftUI
import UIKit

extension View {
  /// Lets a drag on the conversation take the keyboard down.
  @ViewBuilder func aiDismissingKeyboard() -> some View {
    if #available(iOS 16.0, *) {
      scrollDismissesKeyboard(.interactively)
    } else {
      self
    }
  }

  /// The glass button of an action; the prominent one for the action that goes ahead.
  @ViewBuilder func aiAction(prominent: Bool) -> some View {
    if prominent {
      prominentGlassButton()
    } else {
      glassButton()
    }
  }

  /// Rounds a glass button into a circle; iOS 17 is the first to have one.
  @ViewBuilder func aiCircle() -> some View {
    if #available(iOS 17.0, *) {
      buttonBorderShape(.circle)
    } else {
      buttonBorderShape(.capsule)
    }
  }
}

/// One layout when it fits the width, the other when it does not.
struct AiAdaptive<Row: View, Stacked: View>: View {
  @ViewBuilder let row: () -> Row
  @ViewBuilder let stacked: () -> Stacked

  var body: some View {
    if #available(iOS 16.0, *) {
      ViewThatFits(in: .horizontal) {
        row()
        stacked()
      }
    } else {
      stacked()
    }
  }
}

private let aiCardShape = RoundedRectangle(cornerRadius: 12, style: .continuous)

/// The sheet: the conversation under a navigation bar, the kept conversations a page pushed onto it.
struct AiPanelView: View {
  @ObservedObject var model: AiModel
  let bridge: AiBridge
  @State private var draft = ""

  var body: some View {
    PanelPage(title: model.state?.title ?? "") {
      barButtons
    } content: {
      Group {
        if let state = model.state {
          AiConversation(model: model, state: state, bridge: bridge, draft: $draft)
        } else {
          Color.clear
        }
      }
      .background(history)
    }
    .onChange(of: model.insertion) { insertion in
      guard let insertion else { return }
      let kept = draft.trimmingCharacters(in: .whitespacesAndNewlines)
      draft = kept.isEmpty ? insertion.text : kept + "\n" + insertion.text
    }
  }

  @ViewBuilder private var barButtons: some View {
    if let state = model.state {
      if state.history.visible {
        Button {
          bridge.history()
        } label: {
          Image(systemName: "clock.arrow.circlepath")
        }
        .accessibilityLabel(state.history.label)
      }
      Button {
        bridge.newChat()
      } label: {
        Image(systemName: "square.and.pencil")
      }
      .disabled(state.empty)
      .accessibilityLabel(state.newChat)
    }
    PanelCloseButton(label: model.state?.close ?? L10n.text("cancel")) { bridge.closeSheet() }
  }

  private var history: some View {
    NavigationLink(isActive: $model.historyShown) {
      if let state = model.state {
        AiHistoryPage(model: model, state: state, bridge: bridge)
      }
    } label: {
      EmptyView()
    }
    .hidden()
  }
}

private struct AiFootHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// The messages with the composer floating over their end.
private struct AiConversation: View {
  @ObservedObject var model: AiModel
  let state: AiState
  let bridge: AiBridge
  @Binding var draft: String
  @State private var footHeight: CGFloat = 0

  var body: some View {
    AiBodyView(model: model, state: state, bridge: bridge, inset: footHeight)
      .overlay(alignment: .bottom) {
        AiFootView(state: state, bridge: bridge, draft: $draft)
          .background(
            GeometryReader { Color.clear.preference(key: AiFootHeightKey.self, value: $0.size.height) })
      }
      .onPreferenceChange(AiFootHeightKey.self) { footHeight = $0 }
  }
}

// MARK: The scrolling body

private struct AiScrollMetrics: Equatable {
  var height: CGFloat = 0
  var bottom: CGFloat = 0
}

private struct AiScrollKey: PreferenceKey {
  static var defaultValue = AiScrollMetrics()
  static func reduce(value: inout AiScrollMetrics, nextValue: () -> AiScrollMetrics) {
    value = nextValue()
  }
}

/// The setup or the empty state, then the messages; it keeps to the end of a reply as it grows unless the user scrolled up.
struct AiBodyView: View {
  @ObservedObject var model: AiModel
  let state: AiState
  let bridge: AiBridge
  /// The height at the bottom that the composer covers.
  let inset: CGFloat
  @State private var following = true
  @State private var settling = false
  @State private var contentHeight: CGFloat = 0
  private let space = "ai-scroll"
  private let end = "ai-end"
  /// Within this of the end, the list keeps following a reply as it grows.
  private let nearEnd: CGFloat = 32

  var body: some View {
    GeometryReader { geometry in
      ScrollViewReader { scroller in
        ScrollView {
          VStack(spacing: 0) {
            if state.empty {
              if let setup = state.setup {
                AiSetupCard(setup: setup, bridge: bridge)
                  .frame(minHeight: max(0, geometry.size.height - inset - 1))
              } else if let intro = state.intro {
                AiIntroCard(intro: intro, bridge: bridge)
                  .frame(minHeight: max(0, geometry.size.height - inset - 1))
              }
            }
            if !model.boxes.isEmpty {
              LazyVStack(alignment: .leading, spacing: 20) {
                ForEach(model.boxes) { box in
                  AiMessageRow(
                    box: box, state: state, bridge: bridge, width: geometry.size.width - 32,
                    isLast: box.id == model.boxes.last?.id, copied: model.copied == box.id)
                }
              }
              .padding(.top, 8)
              .padding(.horizontal, 16)
              .padding(.bottom, 16)
            }
            Color.clear.frame(height: inset)
            Color.clear.frame(height: 1).id(end)
          }
          .background(
            GeometryReader { inner in
              Color.clear.preference(
                key: AiScrollKey.self,
                value: AiScrollMetrics(
                  height: inner.size.height, bottom: inner.frame(in: .named(space)).maxY))
            })
        }
        .aiDismissingKeyboard()
        .coordinateSpace(name: space)
        .onPreferenceChange(AiScrollKey.self) { metrics in
          if metrics.height != contentHeight {
            contentHeight = metrics.height
            if following && !model.boxes.isEmpty { scroller.scrollTo(end, anchor: .bottom) }
            return
          }
          guard !settling else { return }
          following = metrics.bottom - geometry.size.height <= nearEnd
        }
        .onChange(of: model.pinned) { _ in
          following = true
          DispatchQueue.main.async { scroller.scrollTo(end, anchor: .bottom) }
        }
        .overlay(alignment: .bottom) {
          if !following {
            Button {
              following = true
              settling = true
              withAnimation(.easeOut(duration: 0.25)) { scroller.scrollTo(end, anchor: .bottom) }
              DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { settling = false }
            } label: {
              Image(systemName: "arrow.down")
            }
            .glassButton()
            .aiCircle()
            .accessibilityLabel(state.jump)
            .padding(.bottom, inset + 8)
            .transition(.opacity)
          }
        }
      }
    }
  }
}

// MARK: Before a conversation

/// The mark, the title and the line under it that open the setup and the empty state.
private struct AiHeader: View {
  @ObservedObject private var theme = Theme.shared
  let title: String
  let text: String

  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "sparkles")
        .font(.system(size: 40, weight: .regular))
        .foregroundStyle(theme.color("accent"))
        .padding(.bottom, 8)
        .accessibilityHidden(true)
      Text(title)
        .font(.title3.weight(.semibold))
        .multilineTextAlignment(.center)
      Text(text)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
  }
}

/// Before any model is set up: where to set one up.
struct AiSetupCard: View {
  let setup: AiState.Setup
  let bridge: AiBridge

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 0)
      AiHeader(title: setup.title, text: setup.body)
      VStack(spacing: 10) {
        ForEach(setup.services) { service in
          Button {
            bridge.service(service.id)
          } label: {
            HStack(spacing: 6) {
              Text(service.name)
                .lineLimit(1)
                .truncationMode(.tail)
              Spacer(minLength: 0)
              Image(systemName: "plus")
                .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity)
          }
          .glassButton()
        }
      }
      .padding(.top, 24)
      Button {
        bridge.settings()
      } label: {
        Text(setup.action)
          .frame(maxWidth: .infinity)
      }
      .prominentGlassButton()
      .controlSize(.large)
      .padding(.top, 16)
      Text(setup.note)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(.top, 12)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 24)
  }
}

/// An empty conversation: what to ask, with a few things to ask at once.
struct AiIntroCard: View {
  let intro: AiState.Intro
  let bridge: AiBridge

  private func symbol(_ icon: String) -> String {
    switch icon {
    case "summary": return "text.alignleft"
    case "proofread": return "text.badge.checkmark"
    case "pen": return "pencil"
    default: return "number"
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 0)
      AiHeader(title: intro.title, text: intro.body)
      VStack(spacing: 10) {
        ForEach(Array(intro.suggestions.enumerated()), id: \.offset) { index, suggestion in
          Button {
            bridge.suggestion(index)
          } label: {
            HStack(spacing: 12) {
              Image(systemName: symbol(suggestion.icon))
                .frame(width: 22)
              Text(suggestion.label)
                .multilineTextAlignment(.leading)
              Spacer(minLength: 0)
            }
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .glassButton()
          .buttonBorderShape(.roundedRectangle(radius: 22))
        }
      }
      .padding(.top, 24)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 24)
  }
}

// MARK: Messages

/// One message; only its own row redraws as a reply streams in.
struct AiMessageRow: View {
  @ObservedObject var box: AiEntryBox
  let state: AiState
  let bridge: AiBridge
  let width: CGFloat
  let isLast: Bool
  let copied: Bool

  var body: some View {
    if box.entry.role == .user {
      AiUserMessage(entry: box.entry, width: width)
    } else {
      AiAssistantMessage(
        entry: box.entry, state: state, bridge: bridge, isLast: isLast, copied: copied)
    }
  }
}

struct AiUserMessage: View {
  @ObservedObject private var theme = Theme.shared
  let entry: AiEntry
  let width: CGFloat

  var body: some View {
    let limit = max(0, width * 0.85)
    HStack(spacing: 0) {
      Spacer(minLength: 0)
      VStack(alignment: .trailing, spacing: 6) {
        ForEach(Array(imageRows(limit: limit).enumerated()), id: \.offset) { _, row in
          HStack(spacing: 6) {
            ForEach(row, id: \.index) { image in
              AiThumbnail(picture: image.picture, side: 72, radius: 12)
            }
          }
        }
        if !entry.text.isEmpty {
          Text(entry.text)
            .foregroundStyle(theme.dark ? theme.color("on-accent") : Color.white)
            .multilineTextAlignment(.leading)
            .padding(.vertical, 9)
            .padding(.horizontal, 14)
            .background(
              RoundedRectangle(cornerRadius: 18, style: .continuous).fill(theme.color("accent"))
            )
            .textSelection(.enabled)
        }
      }
      .frame(maxWidth: limit, alignment: .trailing)
    }
  }

  /// The pictures in rows as wide as the bubble, as a wrapping row would lay them out.
  private func imageRows(limit: CGFloat) -> [[(index: Int, picture: UIImage?)]] {
    let perRow = max(1, Int((limit + 6) / 78))
    let numbered = entry.images.enumerated().map { (index: $0.offset, picture: $0.element) }
    return stride(from: 0, to: numbered.count, by: perRow).map {
      Array(numbered[$0..<min($0 + perRow, numbered.count)])
    }
  }
}

private struct AiThumbnail: View {
  let picture: UIImage?
  let side: CGFloat
  let radius: CGFloat

  var body: some View {
    ZStack {
      Color(.secondarySystemBackground)
      if let picture {
        Image(uiImage: picture).resizable().scaledToFill()
      }
    }
    .frame(width: side, height: side)
    .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: radius, style: .continuous)
        .stroke(Color(.separator), lineWidth: 0.5))
  }
}

/// The assistant's reply at full width: text, folds of steps, notes, errors and its foot.
struct AiAssistantMessage: View {
  let entry: AiEntry
  let state: AiState
  let bridge: AiBridge
  let isLast: Bool
  let copied: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 10) {
        ForEach(Array(entry.parts.enumerated()), id: \.offset) { _, part in
          AiPartView(part: part, bridge: bridge)
        }
        if entry.waiting {
          ProgressView().accessibilityLabel(state.waiting)
        }
      }
      if let status = entry.status {
        Text(status)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if let failure = entry.failure {
        AiFailureNote(failure: failure, isLast: isLast, bridge: bridge)
      }
      if let foot = entry.foot {
        AiFootLine(entry: entry, foot: foot, isLast: isLast, copied: copied, bridge: bridge)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contextMenu {
      if let copy = entry.foot?.actions.first(where: { $0.id == "copy" }) {
        Button {
          bridge.copy(entry.id)
        } label: {
          Label(copy.label, systemImage: "doc.on.doc")
        }
      }
    }
  }
}

private struct AiPartView: View {
  let part: AiPart
  let bridge: AiBridge

  var body: some View {
    switch part {
    case .text(let blocks):
      MarkdownBlocksView(blocks)
        .frame(maxWidth: .infinity, alignment: .leading)
    case .group(let group):
      AiGroupView(group: group, bridge: bridge)
    default:
      EmptyView()
    }
  }
}

// MARK: Steps

/// The steps between two runs of text, folded into one row; the questions and edits they raise sit under it.
private struct AiGroupView: View {
  @ObservedObject private var theme = Theme.shared
  let group: AiGroup
  let bridge: AiBridge
  @State private var open = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if group.flat {
        head
      } else {
        DisclosureGroup(isExpanded: $open) {
          steps
        } label: {
          head
        }
      }
      ForEach(Array(group.cards.enumerated()), id: \.offset) { _, card in
        switch card {
        case .approval(let approval): AiApprovalCard(approval: approval, bridge: bridge)
        case .edit(let edit): AiEditCard(edit: edit, bridge: bridge)
        default: EmptyView()
        }
      }
    }
  }

  private var head: some View {
    Label {
      Text(group.label)
        .font(.footnote)
        .foregroundStyle(group.state == "live" ? Color.primary : Color.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
    } icon: {
      icon
    }
  }

  @ViewBuilder private var icon: some View {
    switch group.state {
    case "live":
      ProgressView().controlSize(.mini)
    case "error":
      Image(systemName: "exclamationmark.circle").foregroundStyle(.red)
    case "stopped":
      Image(systemName: "minus.circle").foregroundStyle(.secondary)
    case "thought":
      Image(systemName: "sparkles").foregroundStyle(theme.color("accent"))
    default:
      Image(systemName: "checkmark.circle").foregroundStyle(.secondary)
    }
  }

  private var steps: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(group.parts.enumerated()), id: \.offset) { _, part in
        AiStepView(part: part, single: group.single, bridge: bridge)
      }
    }
    .padding(.leading, 12)
    .overlay(alignment: .leading) {
      Rectangle().fill(Color(.separator)).frame(width: 1.5)
    }
    .padding(.vertical, 4)
  }
}

private struct AiStepView: View {
  @ObservedObject private var theme = Theme.shared
  let part: AiPart
  let single: Bool
  let bridge: AiBridge

  var body: some View {
    switch part {
    case .reasoning(let label, let text):
      VStack(alignment: .leading, spacing: 4) {
        if !single {
          Text(label)
            .font(.caption.weight(.semibold))
        }
        Text(text)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
      }
    case .tool(let label, let state):
      if !single {
        Label {
          Text(label)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
        } icon: {
          toolIcon(state)
        }
      }
    case .sources(let label, let items):
      VStack(alignment: .leading, spacing: 0) {
        ForEach(items) { source in
          Button {
            bridge.link(source.href)
          } label: {
            VStack(alignment: .leading, spacing: 1) {
              Text(source.title)
                .font(.footnote)
                .foregroundStyle(theme.color("accent"))
                .lineLimit(1)
              Text(source.host)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(label)
    case .image(let picture, let caption):
      Group {
        if let picture {
          Image(uiImage: picture)
            .resizable()
            .scaledToFit()
            .frame(maxHeight: 120)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(.separator), lineWidth: 0.5))
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityLabel(caption)
    default:
      EmptyView()
    }
  }

  @ViewBuilder private func toolIcon(_ state: String) -> some View {
    switch state {
    case "running":
      ProgressView().controlSize(.mini)
    case "error", "denied":
      Image(systemName: "exclamationmark.circle").foregroundStyle(.red)
    case "stopped":
      Image(systemName: "minus.circle").foregroundStyle(.secondary)
    default:
      Image(systemName: "checkmark.circle").foregroundStyle(.secondary)
    }
  }
}

// MARK: Cards

private struct AiHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// A scroll view as tall as its content, up to `maxHeight`.
struct AiBoundedScroll<Content: View>: View {
  let maxHeight: CGFloat
  @ViewBuilder let content: () -> Content
  @State private var height: CGFloat = 0

  var body: some View {
    ScrollView {
      content().background(
        GeometryReader { Color.clear.preference(key: AiHeightKey.self, value: $0.size.height) })
    }
    .frame(height: height == 0 ? maxHeight : min(height, maxHeight))
    .onPreferenceChange(AiHeightKey.self) { height = $0 }
  }
}

/// A question a tool waits on: what it would do, and the answers.
private struct AiApprovalCard: View {
  @ObservedObject private var theme = Theme.shared
  let approval: AiApproval
  let bridge: AiBridge

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(approval.title)
          .font(.subheadline.weight(.semibold))
        if let note = approval.note {
          Text(note)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        if let path = approval.path {
          HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(path).lineLimit(1).truncationMode(.head)
            Text("+\(approval.added)")
              .fontWeight(.semibold)
              .foregroundStyle(theme.color("accent-ink"))
            Text("−\(approval.removed)")
              .fontWeight(.semibold)
              .foregroundStyle(theme.color("del-ink"))
          }
          .font(.caption)
          .foregroundStyle(.secondary)
          .padding(.top, 2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      box
      AiAdaptive {
        HStack(spacing: 8) { buttons(wrapping: false) }
      } stacked: {
        VStack(spacing: 8) { buttons(wrapping: true) }
      }
    }
    .padding(12)
    .background(Color(.secondarySystemBackground), in: aiCardShape)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(approval.title)
  }

  @ViewBuilder private var box: some View {
    if let text = approval.text {
      AiBoundedScroll(maxHeight: 160) {
        Text(text)
          .font(.caption.monospaced())
          .foregroundStyle(.primary)
          .padding(10)
          .frame(maxWidth: .infinity, alignment: .leading)
          .textSelection(.enabled)
      }
      .background(Color(.tertiarySystemBackground), in: aiCardShape)
      .clipShape(aiCardShape)
    } else if !approval.rows.isEmpty {
      AiBoundedScroll(maxHeight: 220) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(approval.rows) { row in
            diffRow(row)
          }
        }
        .padding(.vertical, 6)
      }
      .background(Color(.tertiarySystemBackground), in: aiCardShape)
      .clipShape(aiCardShape)
    }
  }

  private func diffRow(_ row: AiDiffRow) -> some View {
    let ink =
      row.kind == "added"
      ? theme.color("accent-ink")
      : row.kind == "removed"
        ? theme.color("del-ink")
        : row.kind == "gap" ? Color.secondary : Color.primary
    return HStack(alignment: .top, spacing: 0) {
      if row.kind != "gap" {
        Text(row.mark).frame(width: 16, alignment: .leading)
      }
      Text(row.text)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(row.kind == "gap" ? .caption : .caption.monospaced())
    .foregroundStyle(ink)
    .padding(.horizontal, 10)
    .textSelection(.enabled)
  }

  @ViewBuilder private func buttons(wrapping: Bool) -> some View {
    ForEach(approval.answers) { answer in
      Button {
        bridge.approval(approval.id, answer.id)
      } label: {
        Text(answer.label)
          .font(.subheadline)
          .multilineTextAlignment(.center)
          .lineLimit(wrapping ? nil : 1)
          .fixedSize(horizontal: false, vertical: wrapping)
          .frame(maxWidth: .infinity)
      }
      .aiAction(prominent: answer.primary)
    }
  }
}

/// An edit to the document: the file, what is pending or became of it, and buttons for its changes while any are pending.
private struct AiEditCard: View {
  let edit: AiEdit
  let bridge: AiBridge

  var body: some View {
    AiAdaptive {
      HStack(spacing: 8) {
        summaryButton
        if edit.pending {
          Spacer(minLength: 0)
          decisions
        }
      }
    } stacked: {
      VStack(alignment: .leading, spacing: 8) {
        summaryButton
        if edit.pending {
          HStack(spacing: 8) {
            Spacer(minLength: 0)
            decisions
          }
        }
      }
    }
    .padding(12)
    .background(Color(.secondarySystemBackground), in: aiCardShape)
  }

  @ViewBuilder private var summaryButton: some View {
    if edit.pending {
      Button {
        bridge.edit("reveal", edit.edit)
      } label: {
        summary.contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(edit.reveal)
    } else {
      summary
    }
  }

  private var decisions: some View {
    HStack(spacing: 8) {
      Button {
        bridge.edit("reject", edit.edit)
      } label: {
        Text(edit.reject)
      }
      .glassButton()
      Button {
        bridge.edit("accept", edit.edit)
      } label: {
        Text(edit.accept)
      }
      .prominentGlassButton()
    }
    .controlSize(.small)
  }

  private var summary: some View {
    HStack(spacing: 10) {
      Image(systemName: "doc.text")
        .foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 1) {
        Text(edit.title)
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
        Text(edit.meta)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct AiFailureNote: View {
  let failure: AiEntry.Failure
  let isLast: Bool
  let bridge: AiBridge

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(failure.text)
        .font(.footnote)
        .foregroundStyle(.red)
      if let detail = failure.detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      HStack(spacing: 8) {
        ForEach(failure.actions.filter { $0.id != "retry" || isLast }) { action in
          Button {
            run(action.id)
          } label: {
            Text(action.label)
          }
          .glassButton()
        }
      }
      .controlSize(.small)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
  }

  private func run(_ id: String) {
    switch id {
    case "settings": bridge.settings()
    case "plan": bridge.plan()
    default: bridge.retry()
    }
  }
}

/// A reply's foot: the model and what it cost, with copy and retry.
private struct AiFootLine: View {
  let entry: AiEntry
  let foot: AiEntry.Foot
  let isLast: Bool
  let copied: Bool
  let bridge: AiBridge

  var body: some View {
    HStack(spacing: 0) {
      Text(foot.text)
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 0)
      ForEach(foot.actions.filter { $0.id != "retry" || isLast }) { action in
        Button {
          if action.id == "copy" { bridge.copy(entry.id) } else { bridge.retry() }
        } label: {
          Image(systemName: action.id == "copy" ? (copied ? "checkmark" : "doc.on.doc") : "arrow.clockwise")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(width: 36, height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(action.label)
      }
    }
  }
}

// MARK: The foot: review bar, plan note and composer

struct AiFootView: View {
  let state: AiState
  let bridge: AiBridge
  @Binding var draft: String

  var body: some View {
    VStack(spacing: 8) {
      if let review = state.review {
        AiReviewBar(review: review, bridge: bridge)
      }
      if let plan = state.plan {
        AiPlanNote(plan: plan, bridge: bridge)
      }
      if let composer = state.composer {
        AiComposerView(state: state, composer: composer, bridge: bridge, draft: $draft)
      }
    }
    .padding(.horizontal, 12)
    .padding(.bottom, 8)
  }
}

/// The bar over the composer for the changes still waiting.
private struct AiReviewBar: View {
  @ObservedObject private var theme = Theme.shared
  let review: AiState.Review
  let bridge: AiBridge

  var body: some View {
    AiAdaptive {
      HStack(spacing: 8) {
        title
        Spacer(minLength: 0)
        steppers
        actions
      }
    } stacked: {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          title
          Spacer(minLength: 0)
          steppers
        }
        HStack(spacing: 8) {
          Spacer(minLength: 0)
          actions
        }
      }
    }
    .controlSize(.small)
    .padding(.vertical, 8)
    .padding(.horizontal, 14)
    .glass(RoundedRectangle(cornerRadius: 22, style: .continuous))
  }

  private var title: some View {
    HStack(spacing: 8) {
      Circle().fill(theme.color("accent")).frame(width: 7, height: 7)
      Text(review.text)
        .font(.footnote.weight(.semibold))
        .lineLimit(1)
        .truncationMode(.tail)
    }
  }

  private var steppers: some View {
    HStack(spacing: 6) {
      Button {
        bridge.review("prev")
      } label: {
        Image(systemName: "chevron.up")
      }
      .glassButton()
      .aiCircle()
      .accessibilityLabel(review.prev)
      Button {
        bridge.review("next")
      } label: {
        Image(systemName: "chevron.down")
      }
      .glassButton()
      .aiCircle()
      .accessibilityLabel(review.next)
    }
  }

  private var actions: some View {
    HStack(spacing: 6) {
      Button {
        bridge.review("rejectAll")
      } label: {
        Text(review.rejectAll)
      }
      .glassButton()
      Button {
        bridge.review("acceptAll")
      } label: {
        Text(review.acceptAll)
      }
      .prominentGlassButton()
    }
  }
}

/// Says whose money the replies cost when they come from a ChatGPT plan.
private struct AiPlanNote: View {
  let plan: AiState.Plan
  let bridge: AiBridge

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "info.circle")
        .foregroundStyle(.secondary)
      Text(plan.text)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      Spacer(minLength: 0)
      Button {
        bridge.plan()
      } label: {
        Text(plan.manage)
      }
      .glassButton()
      .controlSize(.small)
    }
    .padding(.vertical, 8)
    .padding(.horizontal, 14)
    .glass(RoundedRectangle(cornerRadius: 22, style: .continuous))
  }
}

// MARK: The composer

/// What a composer menu shows on its button: an icon, and the chosen name unless the bar is narrow.
private struct AiPillLabel: View {
  var symbol: String? = nil
  let name: String
  var folded = false

  var body: some View {
    HStack(spacing: 4) {
      if let symbol {
        Image(systemName: symbol)
      }
      if !folded {
        Text(name).lineLimit(1).truncationMode(.tail)
        Image(systemName: "chevron.down")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
      }
    }
    .font(.footnote)
    .foregroundStyle(.primary)
    .accessibilityLabel(name)
  }
}

/// The message field, the images going with it and the bar of attach, model, effort, mode and send, on a card of glass.
private struct AiComposerView: View {
  let state: AiState
  let composer: AiComposerState
  let bridge: AiBridge
  @Binding var draft: String

  private var isEmpty: Bool {
    draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && composer.images.isEmpty
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !composer.images.isEmpty || composer.notice != nil {
        tray
      }
      input
      bar
    }
    .padding(.horizontal, 14)
    .padding(.top, 12)
    .padding(.bottom, 10)
    .glassCard(radius: 26)
  }

  // MARK: Images

  private var tray: some View {
    VStack(alignment: .leading, spacing: 6) {
      if !composer.images.isEmpty {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 52, maximum: 52), spacing: 8)], alignment: .leading,
          spacing: 8
        ) {
          ForEach(composer.images) { image in
            AiThumbnail(picture: image.picture, side: 52, radius: 10)
              .overlay(alignment: .topTrailing) {
                Button {
                  bridge.unattach(image.id)
                } label: {
                  Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(Color.black.opacity(0.55)))
                    .padding(3)
                    .frame(width: 44, height: 44, alignment: .topTrailing)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(image.remove)
              }
          }
        }
      }
      if let notice = composer.notice {
        Text(notice)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  // MARK: The field

  @ViewBuilder private var input: some View {
    if #available(iOS 16.0, *) {
      TextField(
        text: $draft,
        prompt: Text(composer.placeholder),
        axis: .vertical
      ) {
        Text(composer.placeholder)
      }
      .lineLimit(1...6)
      .font(.body)
    } else {
      AiLegacyEditor(draft: $draft, placeholder: composer.placeholder)
    }
  }

  // MARK: The bar

  @ViewBuilder private var bar: some View {
    if #available(iOS 16.0, *) {
      ViewThatFits(in: .horizontal) {
        barRow(fold: 0)
        barRow(fold: 1)
        barRow(fold: 2)
      }
    } else {
      barRow(fold: 2)
    }
  }

  /// `fold` names how many of the mode and the effort show only their icon, the mode first.
  private func barRow(fold: Int) -> some View {
    HStack(spacing: 8) {
      Button {
        bridge.attach(room: composer.room)
      } label: {
        Image(systemName: "plus")
      }
      .glassButton()
      .aiCircle()
      .accessibilityLabel(composer.attach)
      modelMenu
      if let effort = state.effort {
        effortMenu(effort, folded: fold >= 2)
      }
      modeMenu(folded: fold >= 1)
      Spacer(minLength: 0)
      sendButton
    }
  }

  private var modelMenu: some View {
    Menu {
      ForEach(state.model.groups) { group in
        Section(group.name) {
          ForEach(group.options) { option in
            Button {
              bridge.chooseModel(option.id)
            } label: {
              checked(option.label, option.checked)
            }
          }
        }
      }
      Section {
        Button(state.model.manage) { bridge.settings() }
      }
    } label: {
      AiPillLabel(name: state.model.label)
    }
    .glassButton()
    .controlSize(.small)
  }

  private func effortMenu(_ effort: AiState.EffortMenu, folded: Bool) -> some View {
    Menu {
      Section(effort.heading) {
        ForEach(effort.options) { option in
          Button {
            bridge.chooseEffort(option.id)
          } label: {
            checked(option.label, option.checked)
          }
        }
      }
    } label: {
      AiPillLabel(symbol: "lightbulb", name: effort.label, folded: folded)
    }
    .glassButton()
    .controlSize(.small)
    .fixedSize()
  }

  private func modeMenu(folded: Bool) -> some View {
    Menu {
      ForEach(state.mode.options) { option in
        Button {
          bridge.chooseMode(option.id)
        } label: {
          Label {
            Text(option.label)
            Text(option.note)
          } icon: {
            Image(systemName: option.checked ? "checkmark" : modeSymbol(option.id))
          }
        }
      }
    } label: {
      AiPillLabel(symbol: modeSymbol(state.mode.value), name: state.mode.label, folded: folded)
    }
    .glassButton()
    .controlSize(.small)
    .fixedSize()
  }

  private func modeSymbol(_ mode: String) -> String {
    mode == "auto" ? "bolt" : "eye"
  }

  @ViewBuilder private func checked(_ label: String, _ on: Bool) -> some View {
    if on {
      Label(label, systemImage: "checkmark")
    } else {
      Text(label)
    }
  }

  private var sendButton: some View {
    let busy = state.busy
    return Button {
      if busy {
        bridge.stop()
      } else {
        let text = draft
        draft = ""
        bridge.send(text)
      }
    } label: {
      Image(systemName: busy ? "stop.fill" : "arrow.up")
        .font(.body.weight(.semibold))
    }
    .prominentGlassButton()
    .aiCircle()
    .disabled(!busy && isEmpty)
    .accessibilityLabel(busy ? composer.stop : composer.send)
  }
}

/// The message field before iOS 16, which has no growing `TextField`.
private struct AiLegacyEditor: View {
  @Binding var draft: String
  let placeholder: String

  var body: some View {
    ZStack(alignment: .topLeading) {
      Text(draft.isEmpty ? " " : draft + "\n")
        .font(.body)
        .opacity(0)
        .padding(.vertical, 8)
        .padding(.horizontal, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
      if draft.isEmpty {
        Text(placeholder)
          .font(.body)
          .foregroundStyle(.secondary)
          .padding(.vertical, 8)
          .padding(.horizontal, 5)
      }
      TextEditor(text: $draft)
        .font(.body)
    }
    .frame(maxHeight: 140)
    .onAppear { UITextView.appearance().backgroundColor = .clear }
  }
}

// MARK: Kept conversations

/// The document's kept conversations, to open one or delete it.
struct AiHistoryPage: View {
  @ObservedObject var model: AiModel
  @ObservedObject private var theme = Theme.shared
  let state: AiState
  let bridge: AiBridge

  var body: some View {
    List {
      if !model.historyLoaded {
        HStack(spacing: 10) {
          ProgressView()
          Text(state.history.loading)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
      } else {
        if let failure = model.historyFailure {
          Text(failure)
            .font(.footnote)
            .foregroundStyle(.red)
        }
        if model.historyItems.isEmpty {
          Text(state.history.empty)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        ForEach(model.historyItems) { item in
          row(item)
        }
      }
    }
    .listStyle(.plain)
    .clearListBackground()
    .navigationTitle(state.history.label)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        PanelCloseButton(label: state.close) { bridge.closeSheet() }
      }
    }
  }

  private func row(_ item: AiHistoryItem) -> some View {
    Button {
      bridge.conversation("open", item.id)
    } label: {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text(item.title)
            .font(.body)
            .foregroundStyle(Color.primary)
            .lineLimit(1)
          Text(item.detail)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
        if item.current {
          Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(theme.color("accent"))
        }
      }
      .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
      .contentShape(Rectangle())
    }
    .listRowBackground(item.current ? theme.color("accent").opacity(0.12) : Color.clear)
    .accessibilityAddTraits(item.current ? .isSelected : [])
    .swipeActions(edge: .trailing) {
      Button(role: .destructive) {
        bridge.conversation("remove", item.id)
      } label: {
        Label(state.history.delete, systemImage: "trash")
      }
    }
    .contextMenu {
      Button(role: .destructive) {
        bridge.conversation("remove", item.id)
      } label: {
        Label(state.history.delete, systemImage: "trash")
      }
    }
  }
}
