import SwiftUI
import UIKit

private func aiTap() {
  UIImpactFeedbackGenerator(style: .light).impactOccurred()
}

private extension View {
  /// Lets a drag on the conversation take the keyboard down.
  @ViewBuilder func aiDismissingKeyboard() -> some View {
    if #available(iOS 16.0, *) {
      scrollDismissesKeyboard(.interactively)
    } else {
      self
    }
  }
}

/// The sheet: the dock on a phone, with its header, the conversation and the composer.
struct AiPanelView: View {
  @ObservedObject var model: AiModel
  @ObservedObject private var theme = Theme.shared
  let bridge: AiBridge
  @State private var draft = ""
  @State private var keyboardShown = false

  var body: some View {
    ZStack(alignment: .topTrailing) {
      VStack(spacing: 0) {
        PanelHeader(title: model.state?.title ?? "") {
          if let state = model.state {
            if state.history.visible {
              CircleButton(symbol: "clock.arrow.circlepath", label: state.history.label) {
                bridge.history()
              }
            }
            CircleButton(symbol: "square.and.pencil", label: state.newChat, disabled: state.empty) {
              bridge.newChat()
            }
            if keyboardShown {
              CircleButton(symbol: "keyboard.chevron.compact.down", label: state.hideKeyboard) {
                UIApplication.shared.sendAction(
                  #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
              }
            }
          }
          CircleButton(symbol: "xmark", label: model.state?.close ?? L10n.text("cancel")) {
            bridge.closeSheet()
          }
        }
        if let state = model.state {
          AiBodyView(model: model, state: state, bridge: bridge)
          AiFootView(state: state, bridge: bridge, draft: $draft)
        } else {
          Spacer()
        }
      }
      if model.historyShown, let state = model.state, state.history.visible {
        Color.black.opacity(0.001)
          .ignoresSafeArea()
          .onTapGesture { model.historyShown = false }
        AiHistoryCard(model: model, state: state, bridge: bridge)
          .padding(.top, 66)
          .padding(.trailing, keyboardShown ? 162 : 112)
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
      keyboardShown = true
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
      keyboardShown = false
    }
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

/// The setup card or the empty card, then the messages; it keeps to the end of a reply as it grows unless the user scrolled up.
struct AiBodyView: View {
  @ObservedObject var model: AiModel
  let state: AiState
  let bridge: AiBridge
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
                  .frame(minHeight: geometry.size.height - 1)
              } else if let intro = state.intro {
                AiIntroCard(intro: intro, bridge: bridge)
                  .frame(minHeight: geometry.size.height - 1)
              }
            }
            if !model.boxes.isEmpty {
              LazyVStack(alignment: .leading, spacing: 18) {
                ForEach(model.boxes) { box in
                  AiMessageRow(
                    box: box, state: state, bridge: bridge, width: geometry.size.width - 36,
                    isLast: box.id == model.boxes.last?.id, copied: model.copied == box.id)
                }
              }
              .padding(.top, 6)
              .padding(.horizontal, 18)
              .padding(.bottom, 16)
            }
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
        .mask(
          VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
              .frame(height: 14)
            Rectangle()
          }
        )
        .overlay(alignment: .bottom) {
          if !following {
            CircleButton(symbol: "arrow.down", label: state.jump) {
              following = true
              settling = true
              withAnimation(.easeOut(duration: 0.25)) { scroller.scrollTo(end, anchor: .bottom) }
              DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { settling = false }
            }
            .padding(.bottom, 10)
            .transition(.opacity)
          }
        }
      }
    }
  }
}

// MARK: Before a conversation

private struct AiTile: View {
  @ObservedObject private var theme = Theme.shared
  var large = false

  var body: some View {
    let side: CGFloat = large ? 52 : 36
    RoundedRectangle(cornerRadius: large ? 16 : 11, style: .continuous)
      .fill(theme.color("accent"))
      .frame(width: side, height: side)
      .overlay(
        Image(systemName: "sparkles")
          .font(.system(size: large ? 24 : 18, weight: .medium))
          .foregroundStyle(theme.color("ai-on-mark"))
      )
      .shadow(color: large ? theme.color("accent-line") : .clear, radius: 10, x: 0, y: 8)
  }
}

/// Before any model is set up: where to set one up.
struct AiSetupCard: View {
  @ObservedObject private var theme = Theme.shared
  let setup: AiState.Setup
  let bridge: AiBridge

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 0)
      AiTile(large: true)
      Text(setup.title)
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(theme.color("text-primary"))
        .multilineTextAlignment(.center)
        .padding(.top, 18)
        .padding(.bottom, 4)
      Text(setup.body)
        .font(.system(size: 15))
        .lineSpacing(5)
        .foregroundStyle(theme.color("text-secondary"))
        .multilineTextAlignment(.center)
        .padding(.bottom, 18)
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible())], spacing: 8) {
        ForEach(setup.services) { service in
          Button {
            aiTap()
            bridge.service(service.id)
          } label: {
            HStack(spacing: 6) {
              Text(service.name)
                .font(.system(size: 15, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
              Spacer(minLength: 0)
              Image(systemName: "plus")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.color("text-secondary"))
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          }
          .buttonStyle(AiButtonStyle(kind: .soft))
        }
      }
      .padding(.bottom, 16)
      Button {
        aiTap()
        bridge.settings()
      } label: {
        Text(setup.action)
          .font(.system(size: 15, weight: .semibold))
          .frame(maxWidth: .infinity, minHeight: 44)
      }
      .buttonStyle(AiButtonStyle(kind: .ink))
      Text(setup.note)
        .font(.system(size: 12))
        .foregroundStyle(theme.color("text-secondary"))
        .multilineTextAlignment(.center)
        .padding(.top, 10)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 20)
    .padding(.top, 20)
    .padding(.bottom, 32)
  }
}

/// An empty conversation: what to ask, with a few things to ask at once.
struct AiIntroCard: View {
  @ObservedObject private var theme = Theme.shared
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
    VStack(alignment: .leading, spacing: 0) {
      Spacer(minLength: 0)
      AiTile()
      Text(intro.title)
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(theme.color("text-primary"))
        .padding(.top, 14)
        .padding(.bottom, 4)
      Text(intro.body)
        .font(.system(size: 15))
        .lineSpacing(5)
        .foregroundStyle(theme.color("text-secondary"))
        .padding(.bottom, 18)
      VStack(spacing: 8) {
        ForEach(Array(intro.suggestions.enumerated()), id: \.offset) { index, suggestion in
          Button {
            aiTap()
            bridge.suggestion(index)
          } label: {
            HStack(spacing: 10) {
              Image(systemName: symbol(suggestion.icon))
                .font(.system(size: 15))
                .foregroundStyle(theme.color("text-secondary"))
                .frame(width: 16)
              Text(suggestion.label)
                .font(.system(size: 15))
                .multilineTextAlignment(.leading)
              Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
          }
          .buttonStyle(AiButtonStyle(kind: .plain))
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 18)
    .padding(.top, 12)
    .padding(.bottom, 24)
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
    let limit = max(0, width * 0.86)
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
            .font(.system(size: 16))
            .lineSpacing(7)
            .foregroundStyle(theme.color("on-ink"))
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(
              RoundedRectangle(cornerRadius: 18, style: .continuous).fill(theme.color("ink"))
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
  @ObservedObject private var theme = Theme.shared
  let picture: UIImage?
  let side: CGFloat
  let radius: CGFloat

  var body: some View {
    ZStack {
      theme.color("dock-bg")
      if let picture {
        Image(uiImage: picture).resizable().scaledToFill()
      }
    }
    .frame(width: side, height: side)
    .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: radius, style: .continuous)
        .stroke(theme.color("line"), lineWidth: 1))
  }
}

/// The assistant's reply at full width beside its mark: text, folds of steps, notes, errors and its foot.
struct AiAssistantMessage: View {
  @ObservedObject private var theme = Theme.shared
  let entry: AiEntry
  let state: AiState
  let bridge: AiBridge
  let isLast: Bool
  let copied: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(theme.color("accent"))
        .frame(width: 26, height: 26)
        .overlay(
          Image(systemName: "sparkles")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(theme.color("ai-on-mark")))
      VStack(alignment: .leading, spacing: 8) {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(Array(entry.parts.enumerated()), id: \.offset) { _, part in
            AiPartView(part: part, bridge: bridge)
          }
          if entry.waiting {
            AiDots().accessibilityLabel(state.waiting)
          }
        }
        .padding(.top, 2)
        if let status = entry.status {
          Text(status)
            .font(.system(size: 12))
            .foregroundStyle(theme.color("text-secondary"))
        }
        if let failure = entry.failure {
          AiFailureCard(failure: failure, isLast: isLast, bridge: bridge)
        }
        if let foot = entry.foot {
          AiFootLine(entry: entry, foot: foot, isLast: isLast, copied: copied, bridge: bridge)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .contextMenu {
      if entry.foot?.actions.contains(where: { $0.id == "copy" }) == true {
        Button {
          bridge.copy(entry.id)
        } label: {
          Label(entry.foot?.actions.first(where: { $0.id == "copy" })?.label ?? "", systemImage: "doc.on.doc")
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

/// The waiting dots under a reply that has not begun.
private struct AiDots: View {
  @ObservedObject private var theme = Theme.shared
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var lit = false

  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<3, id: \.self) { index in
        Circle()
          .fill(theme.color("text-muted"))
          .frame(width: 6, height: 6)
          .opacity(reduceMotion ? 0.6 : (lit ? 1 : 0.25))
          .animation(
            reduceMotion
              ? nil
              : .easeInOut(duration: 0.6).repeatForever(autoreverses: true).delay(Double(index) * 0.15),
            value: lit)
      }
    }
    .padding(.vertical, 9)
    .onAppear { lit = true }
  }
}

private struct AiSpinner: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let color: Color
  var size: CGFloat = 9
  @State private var turning = false

  var body: some View {
    Circle()
      .trim(from: 0, to: 0.75)
      .stroke(color, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
      .frame(width: size, height: size)
      .rotationEffect(.degrees(turning ? 360 : 0))
      .animation(
        reduceMotion ? nil : .linear(duration: 0.8).repeatForever(autoreverses: false), value: turning
      )
      .onAppear { turning = true }
  }
}

// MARK: Steps

/// The steps between two runs of text, folded into one line; the questions and edits they raise sit under it.
private struct AiGroupView: View {
  @ObservedObject private var theme = Theme.shared
  let group: AiGroup
  let bridge: AiBridge
  @State private var open = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      head
      if open && !group.flat {
        steps
      }
      if !group.cards.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(Array(group.cards.enumerated()), id: \.offset) { _, card in
            switch card {
            case .approval(let approval): AiApprovalCard(approval: approval, bridge: bridge)
            case .edit(let edit): AiEditCard(edit: edit, bridge: bridge)
            default: EmptyView()
            }
          }
        }
        .padding(.top, 6)
      }
    }
  }

  private var head: some View {
    let line = HStack(spacing: 6) {
      icon.frame(width: 14, height: 14)
      Text(group.label)
        .font(.system(size: 12.5))
        .foregroundStyle(
          group.state == "live" ? theme.color("text-primary") : theme.color("text-secondary")
        )
        .lineLimit(1)
        .truncationMode(.tail)
      if !group.flat {
        Image(systemName: "chevron.right")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(theme.color("text-muted"))
          .rotationEffect(.degrees(open ? 90 : 0))
      }
    }
    return Group {
      if group.flat {
        line.frame(minHeight: 26, alignment: .leading)
      } else {
        Button {
          aiTap()
          withAnimation(.easeOut(duration: 0.12)) { open.toggle() }
        } label: {
          line.frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(group.label)
      }
    }
  }

  @ViewBuilder private var icon: some View {
    switch group.state {
    case "live": AiSpinner(color: theme.color("text-muted"))
    case "error":
      Image(systemName: "exclamationmark.circle").font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("ai-error"))
    case "stopped":
      Image(systemName: "minus").font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("text-muted"))
    case "thought":
      Image(systemName: "sparkles").font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("accent"))
    default:
      Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("ok"))
    }
  }

  private var steps: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(group.parts.enumerated()), id: \.offset) { _, part in
        AiStepView(part: part, single: group.single, bridge: bridge)
      }
    }
    .font(.system(size: 12.5))
    .foregroundStyle(theme.color("text-secondary"))
    .padding(.leading, 14)
    .padding(.vertical, 2)
    .overlay(alignment: .leading) {
      Rectangle().fill(theme.color("line")).frame(width: 1.5)
    }
    .padding(.leading, 6)
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
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.color("text-muted"))
        }
        Text(text)
          .lineSpacing(4)
          .textSelection(.enabled)
      }
    case .tool(let label, let state):
      if !single {
        HStack(spacing: 6) {
          toolIcon(state).frame(width: 14, height: 14)
          Text(label).lineLimit(1).truncationMode(.tail)
        }
      }
    case .sources(let label, let items):
      VStack(alignment: .leading, spacing: 2) {
        ForEach(items) { source in
          Button {
            aiTap()
            bridge.link(source.href)
          } label: {
            VStack(alignment: .leading, spacing: 1) {
              Text(source.title)
                .foregroundStyle(theme.color("text-primary"))
                .lineLimit(1)
              Text(source.host)
                .font(.system(size: 11))
                .foregroundStyle(theme.color("text-muted"))
                .lineLimit(1)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
          }
          .buttonStyle(RowStyle())
          .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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
                .stroke(theme.color("line"), lineWidth: 1))
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
    case "running": AiSpinner(color: theme.color("text-muted"))
    case "error", "denied":
      Image(systemName: "exclamationmark.circle").font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("ai-error"))
    case "stopped":
      Image(systemName: "minus").font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("text-muted"))
    default:
      Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("ok"))
    }
  }
}

// MARK: Cards

private struct AiHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// A scroll view as tall as its content, up to `maxHeight`.
private struct AiBoundedScroll<Content: View>: View {
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
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 2) {
        Text(approval.title)
          .font(.system(size: 13.5, weight: .semibold))
          .foregroundStyle(theme.color("text-primary"))
        if let note = approval.note {
          Text(note)
            .font(.system(size: 12))
            .foregroundStyle(theme.color("text-secondary"))
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
          .font(.system(size: 12))
          .foregroundStyle(theme.color("text-secondary"))
          .padding(.top, 2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, 12)
      .padding(.horizontal, 14)
      .padding(.bottom, 10)
      box
      answers.padding(12)
    }
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(theme.color("dock-bg")))
    .overlay(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .stroke(theme.color("accent-line"), lineWidth: 1.5)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(theme.color("accent-soft"), lineWidth: 4)
        .padding(-2)
    )
    .padding(.horizontal, 2)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(approval.title)
  }

  @ViewBuilder private var box: some View {
    if let text = approval.text {
      AiBoundedScroll(maxHeight: 160) {
        Text(text)
          .font(.system(size: 11.5, design: .monospaced))
          .lineSpacing(6)
          .foregroundStyle(theme.color("text-primary"))
          .padding(.vertical, 6)
          .padding(.horizontal, 12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .textSelection(.enabled)
      }
      .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(theme.color("fill-soft")))
      .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      .padding(.horizontal, 12)
    } else if !approval.rows.isEmpty {
      AiBoundedScroll(maxHeight: 220) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(approval.rows) { row in
            diffRow(row)
          }
        }
        .padding(.vertical, 6)
      }
      .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(theme.color("fill-soft")))
      .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      .padding(.horizontal, 12)
    }
  }

  private func diffRow(_ row: AiDiffRow) -> some View {
    let ink =
      row.kind == "added"
      ? theme.color("accent-ink")
      : row.kind == "removed"
        ? theme.color("del-ink")
        : row.kind == "gap" ? theme.color("text-muted") : theme.color("text-primary")
    return HStack(alignment: .top, spacing: 0) {
      if row.kind != "gap" {
        Text(row.mark).frame(width: 16, alignment: .leading)
      }
      Text(row.text)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(row.kind == "gap" ? .system(size: 11.5) : .system(size: 11.5, design: .monospaced))
    .lineSpacing(6)
    .foregroundStyle(ink)
    .padding(.horizontal, 12)
    .textSelection(.enabled)
  }

  @ViewBuilder private var answers: some View {
    if #available(iOS 16.0, *) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 8) { buttons(wrapping: false) }
        VStack(spacing: 8) { buttons(wrapping: true) }
      }
    } else {
      VStack(spacing: 8) { buttons(wrapping: true) }
    }
  }

  @ViewBuilder private func buttons(wrapping: Bool) -> some View {
    ForEach(approval.answers) { answer in
      Button {
        aiTap()
        bridge.approval(approval.id, answer.id)
      } label: {
        Text(answer.label)
          .font(.system(size: 15, weight: answer.primary ? .semibold : .regular))
          .multilineTextAlignment(.center)
          .lineLimit(wrapping ? nil : 1)
          .fixedSize(horizontal: false, vertical: wrapping)
          .padding(.horizontal, 12)
          .frame(maxWidth: .infinity, minHeight: 44)
      }
      .buttonStyle(AiButtonStyle(kind: answer.primary ? .primary : .plain))
    }
  }
}

/// An edit to the document: the file, what is pending or became of it, and buttons for its changes while any are pending.
private struct AiEditCard: View {
  @ObservedObject private var theme = Theme.shared
  let edit: AiEdit
  let bridge: AiBridge

  var body: some View {
    HStack(spacing: 6) {
      if edit.pending {
        Button {
          aiTap()
          bridge.edit("reveal", edit.edit)
        } label: {
          summary.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(edit.reveal)
      } else {
        summary
      }
      if edit.pending {
        Button {
          aiTap()
          bridge.edit("reject", edit.edit)
        } label: {
          Text(edit.reject).font(.system(size: 15)).padding(.horizontal, 10).frame(minHeight: 44)
        }
        .buttonStyle(AiButtonStyle(kind: .plain))
        Button {
          aiTap()
          bridge.edit("accept", edit.edit)
        } label: {
          Text(edit.accept).font(.system(size: 15, weight: .semibold)).padding(.horizontal, 10)
            .frame(minHeight: 44)
        }
        .buttonStyle(AiButtonStyle(kind: .ink))
      }
    }
    .padding(.leading, 8)
    .padding(.trailing, 10)
    .padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(theme.color("dock-bg")))
    .overlay(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .stroke(theme.color("line"), lineWidth: 1))
    .shadow(color: edit.pending ? .black.opacity(0.04) : .clear, radius: 1, x: 0, y: 1)
  }

  private var summary: some View {
    HStack(spacing: 10) {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(theme.color("fill-soft"))
        .frame(width: 28, height: 28)
        .overlay(
          Image(systemName: "doc")
            .font(.system(size: 14))
            .foregroundStyle(theme.color("text-secondary")))
      VStack(alignment: .leading, spacing: 1) {
        Text(edit.title)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.color("text-primary"))
          .lineLimit(1)
        Text(edit.meta)
          .font(.system(size: 11.5))
          .foregroundStyle(theme.color("text-secondary"))
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(2)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct AiFailureCard: View {
  @ObservedObject private var theme = Theme.shared
  let failure: AiEntry.Failure
  let isLast: Bool
  let bridge: AiBridge

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(failure.text)
        .font(.system(size: 15))
        .lineSpacing(3)
        .foregroundStyle(theme.color("text-primary"))
      if let detail = failure.detail {
        Text(detail)
          .font(.system(size: 12))
          .foregroundStyle(theme.color("text-secondary"))
      }
      HStack(spacing: 8) {
        ForEach(failure.actions.filter { $0.id != "retry" || isLast }) { action in
          Button {
            aiTap()
            run(action.id)
          } label: {
            Text(action.label)
              .font(.system(size: 15, weight: action.primary ? .semibold : .regular))
              .padding(.horizontal, 12)
              .frame(minHeight: 44)
          }
          .buttonStyle(AiButtonStyle(kind: action.primary ? .primary : .plain))
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 12)
    .padding(.horizontal, 14)
    .background(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(theme.color("ai-error").opacity(0.08))
    )
    .overlay(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .stroke(theme.color("ai-error").opacity(0.4), lineWidth: 1))
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
  @ObservedObject private var theme = Theme.shared
  let entry: AiEntry
  let foot: AiEntry.Foot
  let isLast: Bool
  let copied: Bool
  let bridge: AiBridge

  var body: some View {
    HStack(spacing: 2) {
      Text(foot.text)
        .font(.system(size: 11.5))
        .foregroundStyle(theme.color("text-muted"))
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 0)
      ForEach(foot.actions.filter { $0.id != "retry" || isLast }) { action in
        AiIconButton(
          symbol: action.id == "copy" ? (copied ? "checkmark" : "doc.on.doc") : "arrow.clockwise",
          label: action.label
        ) {
          if action.id == "copy" { bridge.copy(entry.id) } else { bridge.retry() }
        }
      }
    }
    .padding(.top, -2)
  }
}

/// A round 44-point button inside a sheet, with the soft fill of the page's `.ny-ai__icon`.
private struct AiIconButton: View {
  @ObservedObject private var theme = Theme.shared
  let symbol: String
  let label: String
  let action: () -> Void

  var body: some View {
    Button {
      aiTap()
      action()
    } label: {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(theme.color("text-primary"))
        .frame(width: 44, height: 44)
        .background(Circle().fill(theme.color("fill-soft")))
        .overlay(Circle().stroke(theme.color("border-soft"), lineWidth: 1))
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

/// The page's buttons: bordered, accent, ink, or bare, round at the mobile control radius.
struct AiButtonStyle: ButtonStyle {
  enum Kind { case plain, primary, ink, soft, quiet, raised }
  @ObservedObject private var theme = Theme.shared
  let kind: Kind

  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    let fill: Color
    var ink = theme.color("text-primary")
    switch kind {
    case .plain, .raised: fill = theme.color("dock-bg")
    case .primary:
      fill = theme.color("accent")
      ink = theme.color("on-accent")
    case .ink:
      fill = theme.color("ink")
      ink = theme.color("on-ink")
    case .soft: fill = theme.color("fill-soft")
    case .quiet: fill = .clear
    }
    return configuration.label
      .foregroundStyle(pressed ? theme.color("accent-ink") : ink)
      .background(
        Capsule().fill(pressed ? theme.color("accent-soft") : fill)
      )
      .overlay(
        Capsule().stroke(kind == .plain ? theme.color("line") : .clear, lineWidth: 1)
      )
      .shadow(color: kind == .raised ? .black.opacity(0.1) : .clear, radius: 1, x: 0, y: 1)
      .animation(.easeOut(duration: 0.1), value: pressed)
  }
}

// MARK: The foot: review bar, plan note and composer

struct AiFootView: View {
  let state: AiState
  let bridge: AiBridge
  @Binding var draft: String

  var body: some View {
    VStack(spacing: 0) {
      if let review = state.review {
        AiReviewBar(review: review, bridge: bridge).padding(.bottom, 8)
      }
      if let plan = state.plan {
        AiPlanNote(plan: plan, bridge: bridge).padding(.horizontal, 4).padding(.bottom, 6)
      }
      if let composer = state.composer {
        AiComposerView(state: state, composer: composer, bridge: bridge, draft: $draft)
      }
    }
    .padding(12)
  }
}

/// The bar over the composer for the changes still waiting.
private struct AiReviewBar: View {
  @ObservedObject private var theme = Theme.shared
  let review: AiState.Review
  let bridge: AiBridge

  var body: some View {
    Group {
      if #available(iOS 16.0, *) {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 4) {
            title
            steppers
            actions
          }
          VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
              title
              Spacer(minLength: 0)
              steppers
            }
            HStack(spacing: 4) {
              Spacer(minLength: 0)
              actions
            }
          }
        }
      } else {
        VStack(alignment: .leading, spacing: 0) {
          HStack(spacing: 4) {
            title
            Spacer(minLength: 0)
            steppers
          }
          HStack(spacing: 4) {
            Spacer(minLength: 0)
            actions
          }
        }
      }
    }
    .padding(.vertical, 5)
    .padding(.trailing, 5)
    .padding(.leading, 12)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(theme.color("fill-soft")))
  }

  private var title: some View {
    HStack(spacing: 4) {
      Circle().fill(theme.color("accent")).frame(width: 6, height: 6).padding(.trailing, 4)
      Text(review.text)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.color("text-primary"))
        .lineLimit(1)
        .truncationMode(.tail)
    }
  }

  private var steppers: some View {
    HStack(spacing: 4) {
      AiIconButton(symbol: "chevron.up", label: review.prev) { bridge.review("prev") }
      AiIconButton(symbol: "chevron.down", label: review.next) { bridge.review("next") }
    }
  }

  private var actions: some View {
    HStack(spacing: 4) {
      Button {
        aiTap()
        bridge.review("rejectAll")
      } label: {
        Text(review.rejectAll).font(.system(size: 15)).padding(.horizontal, 12).frame(minHeight: 44)
      }
      .buttonStyle(AiButtonStyle(kind: .quiet))
      Button {
        aiTap()
        bridge.review("acceptAll")
      } label: {
        Text(review.acceptAll).font(.system(size: 15, weight: .semibold)).padding(.horizontal, 12)
          .frame(minHeight: 44)
      }
      .buttonStyle(AiButtonStyle(kind: .raised))
    }
  }
}

/// Says whose money the replies cost when they come from a ChatGPT plan.
private struct AiPlanNote: View {
  @ObservedObject private var theme = Theme.shared
  let plan: AiState.Plan
  let bridge: AiBridge

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "asterisk")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(theme.color("text-primary"))
      Text(plan.text)
        .font(.system(size: 12))
        .foregroundStyle(theme.color("text-secondary"))
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 0)
      Button {
        aiTap()
        bridge.plan()
      } label: {
        Text(plan.manage)
          .font(.system(size: 12))
          .foregroundStyle(theme.color("accent"))
          .padding(.horizontal, 6)
          .frame(minWidth: 44, minHeight: 44)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
    }
  }
}

// MARK: The composer

private struct AiPill: View {
  @ObservedObject private var theme = Theme.shared
  var symbol: String? = nil
  let name: String
  var folded = false

  var body: some View {
    HStack(spacing: 4) {
      if let symbol {
        Image(systemName: symbol)
          .font(.system(size: 13))
          .foregroundStyle(theme.color("text-secondary"))
      }
      if !folded {
        Text(name).font(.system(size: 14)).lineLimit(1).truncationMode(.tail)
        Image(systemName: "chevron.down")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(theme.color("text-secondary"))
      }
    }
    .foregroundStyle(theme.color("text-primary"))
    .padding(.horizontal, 10)
    .frame(minWidth: 44, minHeight: 44)
    .contentShape(Rectangle())
    .accessibilityLabel(name)
  }
}

/// The message field, the images going with it and the bar of attach, model, effort, mode and send.
private struct AiComposerView: View {
  @ObservedObject private var theme = Theme.shared
  let state: AiState
  let composer: AiComposerState
  let bridge: AiBridge
  @Binding var draft: String
  @FocusState private var focused: Bool

  /// The field grows to this tall: 180 points or 28% of the screen.
  private var maxInputHeight: CGFloat { min(180, UIScreen.main.bounds.height * 0.28) }

  private var isEmpty: Bool {
    draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && composer.images.isEmpty
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if !composer.images.isEmpty || composer.notice != nil {
        tray.padding(.horizontal, 8).padding(.top, 8).padding(.bottom, 8)
      }
      input
      bar.padding(.top, 6)
    }
    .padding(6)
    .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(theme.color("fill-soft")))
    .overlay(
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .stroke(focused ? theme.color("accent-line") : theme.color("border-strong"), lineWidth: 1)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 30, style: .continuous)
        .stroke(theme.color("accent-soft"), lineWidth: 4)
        .padding(-2)
        .opacity(focused ? 1 : 0)
    )
    .animation(.easeOut(duration: 0.12), value: focused)
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
              .overlay(alignment: .topLeading) {
                Button {
                  aiTap()
                  bridge.unattach(image.id)
                } label: {
                  Circle()
                    .fill(theme.color("ink"))
                    .frame(width: 18, height: 18)
                    .overlay(
                      Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(theme.color("on-ink"))
                    )
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(image.remove)
                .offset(x: 27, y: -19)
              }
          }
        }
      }
      if let notice = composer.notice {
        Text(notice)
          .font(.system(size: 11.5))
          .lineSpacing(2)
          .foregroundStyle(theme.color("text-secondary"))
      }
    }
  }

  // MARK: The field

  @ViewBuilder private var input: some View {
    if #available(iOS 16.0, *) {
      TextField(
        text: $draft,
        prompt: Text(composer.placeholder).foregroundColor(theme.color("text-muted")),
        axis: .vertical
      ) {
        Text(composer.placeholder)
      }
      .lineLimit(1...max(1, Int((maxInputHeight - 24) / 24.8)))
      .font(.system(size: 16))
      .lineSpacing(5.8)
      .foregroundStyle(theme.color("text-primary"))
      .tint(theme.color("accent"))
      .focused($focused)
      .padding(.vertical, 12)
      .padding(.horizontal, 14)
    } else {
      AiLegacyEditor(
        draft: $draft, placeholder: composer.placeholder, maxHeight: maxInputHeight, focused: $focused)
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
    HStack(spacing: 6) {
      Button {
        aiTap()
        bridge.attach(room: composer.room)
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 15, weight: .medium))
          .foregroundStyle(theme.color("text-primary"))
          .frame(width: 44, height: 44)
          .background(Circle().fill(theme.color("fill-soft")))
          .overlay(Circle().stroke(theme.color("border-soft"), lineWidth: 1))
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
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
      AiPill(name: state.model.label)
    }
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
      AiPill(symbol: "lightbulb", name: effort.label, folded: folded)
    }
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
      AiPill(symbol: modeSymbol(state.mode.value), name: state.mode.label, folded: folded)
    }
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
    let off = !busy && isEmpty
    return Button {
      aiTap()
      if busy {
        bridge.stop()
      } else {
        let text = draft
        draft = ""
        bridge.send(text)
      }
    } label: {
      Image(systemName: busy ? "stop.fill" : "arrow.up")
        .font(.system(size: 15, weight: busy ? .regular : .semibold))
        .foregroundStyle(off ? theme.color("dock-bg") : theme.color("on-ink"))
        .frame(width: 44, height: 44)
        .background(
          Circle().fill(off ? theme.color("text-primary").opacity(0.14) : theme.color("ink"))
        )
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .disabled(off)
    .accessibilityLabel(busy ? composer.stop : composer.send)
  }
}

/// The message field before iOS 16, which has no growing `TextField`.
private struct AiLegacyEditor: View {
  @ObservedObject private var theme = Theme.shared
  @Binding var draft: String
  let placeholder: String
  let maxHeight: CGFloat
  var focused: FocusState<Bool>.Binding

  var body: some View {
    ZStack(alignment: .topLeading) {
      Text(draft.isEmpty ? " " : draft + "\n")
        .font(.system(size: 16))
        .lineSpacing(5.8)
        .opacity(0)
        .padding(.vertical, 12)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
      if draft.isEmpty {
        Text(placeholder)
          .font(.system(size: 16))
          .foregroundStyle(theme.color("text-muted"))
          .padding(.vertical, 12)
          .padding(.horizontal, 18)
      }
      TextEditor(text: $draft)
        .font(.system(size: 16))
        .foregroundStyle(theme.color("text-primary"))
        .tint(theme.color("accent"))
        .focused(focused)
        .padding(.vertical, 4)
        .padding(.horizontal, 14)
    }
    .frame(maxHeight: maxHeight)
    .onAppear { UITextView.appearance().backgroundColor = .clear }
  }
}

// MARK: Kept conversations

/// The document's kept conversations, to open one or delete it.
struct AiHistoryCard: View {
  @ObservedObject var model: AiModel
  @ObservedObject private var theme = Theme.shared
  let state: AiState
  let bridge: AiBridge

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if !model.historyLoaded {
        note(state.history.loading, error: false)
      } else {
        if let failure = model.historyFailure {
          note(failure, error: true)
        }
        if model.historyItems.isEmpty {
          note(state.history.empty, error: false)
        } else {
          AiBoundedScroll(maxHeight: 344) {
            VStack(alignment: .leading, spacing: 0) {
              ForEach(model.historyItems) { item in
                row(item)
              }
            }
          }
        }
      }
    }
    .padding(8)
    .frame(width: min(320, UIScreen.main.bounds.width - 28), alignment: .leading)
    .glassCard(radius: 24)
    .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
  }

  private func note(_ text: String, error: Bool) -> some View {
    Text(text)
      .font(.system(size: 12))
      .foregroundStyle(error ? theme.color("ai-error") : theme.color("text-secondary"))
      .padding(10)
  }

  private func row(_ item: AiHistoryItem) -> some View {
    HStack(spacing: 0) {
      Button {
        aiTap()
        bridge.conversation("open", item.id)
      } label: {
        HStack(spacing: 10) {
          VStack(alignment: .leading, spacing: 2) {
            Text(item.title)
              .font(.system(size: 15))
              .foregroundStyle(theme.color("text-primary"))
              .lineLimit(1)
              .truncationMode(.tail)
            Text(item.detail)
              .font(.system(size: 11.5))
              .foregroundStyle(theme.color("text-secondary"))
              .lineLimit(1)
          }
          Spacer(minLength: 0)
          if item.current {
            Image(systemName: "checkmark")
              .font(.system(size: 13, weight: .bold))
              .foregroundStyle(theme.color("accent-ink"))
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(RowStyle())
      Button {
        aiTap()
        bridge.conversation("remove", item.id)
      } label: {
        Image(systemName: "trash")
          .font(.system(size: 14))
          .foregroundStyle(theme.color("text-secondary"))
          .frame(width: 44, height: 44)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(state.history.delete)
    }
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .contextMenu {
      Button(role: .destructive) {
        bridge.conversation("remove", item.id)
      } label: {
        Label(state.history.delete, systemImage: "trash")
      }
    }
  }
}
