/**
 * GitHub-style blockquote admonitions:
 *
 *   > [!NOTE]
 *   > body
 *
 * In CommonMark the two `>` lines collapse into a single paragraph that
 * looks like `"[!NOTE]" + hardBreak + "body"`. We don't touch the schema or
 * the parser — instead we lay ProseMirror decorations over the marker:
 *
 *   - the wrapping blockquote gains `class="ny-alert ny-alert-<kind>"` and
 *     `data-alert="<kind>"`, so CSS can render the colored stripe + label,
 *   - the literal "[!NOTE]" range (and any trailing hard-break / blank
 *     space introduced by the user's line break) gets wrapped in
 *     `class="ny-alert-marker"` so we can hide just that span, leaving the
 *     body of the alert untouched.
 *
 * No schema mutation, no parser rewriting, no Milkdown internals touched —
 * the markdown source is preserved byte-for-byte.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import { ensureStyle } from '../../style/register';

const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
type AlertKind = (typeof ALERT_KINDS)[number];

const MARKER_PATTERN = new RegExp(
  `^\\s*\\[!(${ALERT_KINDS.join('|')})\\]`,
  'i'
);

const pluginKey = new PluginKey<DecorationSet>('nyamark/gfm-alerts');

interface MarkerHit {
  kind: AlertKind;
  /** Length, in document positions, of the inline range to hide. */
  range: number;
}

/**
 * Detect a GFM admonition marker that lives at the start of `paragraph`.
 *
 * Returns null when the paragraph doesn't begin with a recognised
 * `[!TYPE]` marker, when the marker is followed by other inline content
 * on the same visual line, or when the first child isn't text.
 */
function findMarker(paragraph: ProseNode): MarkerHit | null {
  if (paragraph.childCount === 0) return null;

  const first = paragraph.child(0);
  if (!first.isText || !first.text) return null;

  const match = first.text.match(MARKER_PATTERN);
  if (!match) return null;

  const kind = match[1].toLowerCase() as AlertKind;
  let consumed = match[0].length;

  const tail = first.text.slice(consumed);

  if (tail.length === 0) {
    // Marker ends exactly with the first text node. Eat a trailing
    // hard_break, if any, so the empty line collapses too.
    if (paragraph.childCount > 1) {
      const next = paragraph.child(1);
      if (next.type.name === 'hard_break' || next.type.name === 'hardbreak') {
        consumed += 1; // hard_break occupies a single position
      }
    }
    return { kind, range: consumed };
  }

  // After the marker comes whitespace ⇒ accept and absorb it.
  const wsLine = tail.match(/^[ \t]*\n/);
  if (wsLine) {
    consumed += wsLine[0].length;
    return { kind, range: consumed };
  }

  const wsOnly = tail.match(/^[ \t]+$/);
  if (wsOnly) {
    consumed += wsOnly[0].length;
    if (paragraph.childCount > 1) {
      const next = paragraph.child(1);
      if (next.type.name === 'hard_break' || next.type.name === 'hardbreak') {
        consumed += 1;
      }
    }
    return { kind, range: consumed };
  }

  // Marker followed by inline content on the same line — not a valid
  // GFM alert (per spec the marker must be on its own line).
  return null;
}

function buildDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return true;

    const firstChild = node.firstChild;
    if (!firstChild || firstChild.type.name !== 'paragraph') return false;

    const hit = findMarker(firstChild);
    if (!hit) return false;

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `ny-alert ny-alert-${hit.kind}`,
        'data-alert': hit.kind,
      })
    );

    // pos     -> blockquote token
    // pos + 1 -> paragraph token
    // pos + 2 -> first inline position inside the paragraph
    const paragraphFrom = pos + 1;
    const paragraphTo = paragraphFrom + firstChild.nodeSize;
    const inlineStart = pos + 2;

    // When the marker takes up the entire first paragraph (e.g. `> [!NOTE]`
    // with the body in a SEPARATE blockquote paragraph), collapse the host
    // paragraph too — otherwise we'd leave an empty line above the body.
    if (hit.range >= firstChild.content.size) {
      decorations.push(
        Decoration.node(paragraphFrom, paragraphTo, {
          class: 'ny-alert-marker-line',
        })
      );
    }

    decorations.push(
      Decoration.inline(inlineStart, inlineStart + hit.range, {
        class: 'ny-alert-marker',
      })
    );

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

export const gfmAlerts = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: pluginKey,
      state: {
        init: (_, state) => buildDecorations(state.doc),
        apply: (tr, prev, _old, newState) =>
          tr.docChanged ? buildDecorations(newState.doc) : prev,
      },
      props: {
        decorations(state) {
          return pluginKey.getState(state);
        },
      },
    })
);

const css = `
.ny-editor-root .milkdown .ProseMirror {
  --ny-alert-note-color: #1f6feb;
  --ny-alert-note-bg: rgba(56, 139, 253, 0.08);
  --ny-alert-tip-color: #1a7f37;
  --ny-alert-tip-bg: rgba(46, 160, 67, 0.08);
  --ny-alert-important-color: #8250df;
  --ny-alert-important-bg: rgba(130, 80, 223, 0.08);
  --ny-alert-warning-color: #9a6700;
  --ny-alert-warning-bg: rgba(212, 167, 44, 0.1);
  --ny-alert-caution-color: #cf222e;
  --ny-alert-caution-bg: rgba(207, 34, 46, 0.08);
}

:root[data-theme="dark"] .ny-editor-root .milkdown .ProseMirror {
  --ny-alert-note-color: #4493f8;
  --ny-alert-note-bg: rgba(56, 139, 253, 0.14);
  --ny-alert-tip-color: #3fb950;
  --ny-alert-tip-bg: rgba(46, 160, 67, 0.14);
  --ny-alert-important-color: #a371f7;
  --ny-alert-important-bg: rgba(130, 80, 223, 0.16);
  --ny-alert-warning-color: #d29922;
  --ny-alert-warning-bg: rgba(212, 167, 44, 0.14);
  --ny-alert-caution-color: #f85149;
  --ny-alert-caution-bg: rgba(248, 81, 73, 0.14);
}

.ny-editor-root .milkdown .ProseMirror .ny-alert {
  position: relative !important;
  margin: 0.6em 0 !important;
  padding: 10px 14px 12px 14px !important;
  border-left: 3px solid var(--ny-alert-color, var(--ny-text-muted)) !important;
  border-radius: 0 8px 8px 0 !important;
  background: var(--ny-alert-bg, transparent) !important;
}

/*
 * Render the alert label as a real block element above the body. We used
 * to position the label absolutely, but Crepe ships its own
 * ".editor blockquote::before" rule (a vertical bar) and the absolute
 * placement also overlapped the first inline node when the body and
 * marker share a paragraph. Block layout is reliably clear.
 */
.ny-editor-root .milkdown .ProseMirror .ny-alert::before {
  display: block !important;
  margin: 0 0 6px 0 !important;
  padding: 0 !important;
  background: transparent !important;
  width: auto !important;
  height: auto !important;
  position: static !important;
  font-family: var(--ny-font-sans);
  font-size: 12px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ny-alert-color);
  text-transform: capitalize;
  pointer-events: none;
  border-radius: 0 !important;
}

.ny-editor-root .milkdown .ProseMirror .ny-alert::before { content: "Alert"; }
.ny-editor-root .milkdown .ProseMirror .ny-alert-note { --ny-alert-color: var(--ny-alert-note-color); --ny-alert-bg: var(--ny-alert-note-bg); }
.ny-editor-root .milkdown .ProseMirror .ny-alert-note::before { content: "Note"; }
.ny-editor-root .milkdown .ProseMirror .ny-alert-tip { --ny-alert-color: var(--ny-alert-tip-color); --ny-alert-bg: var(--ny-alert-tip-bg); }
.ny-editor-root .milkdown .ProseMirror .ny-alert-tip::before { content: "Tip"; }
.ny-editor-root .milkdown .ProseMirror .ny-alert-important { --ny-alert-color: var(--ny-alert-important-color); --ny-alert-bg: var(--ny-alert-important-bg); }
.ny-editor-root .milkdown .ProseMirror .ny-alert-important::before { content: "Important"; }
.ny-editor-root .milkdown .ProseMirror .ny-alert-warning { --ny-alert-color: var(--ny-alert-warning-color); --ny-alert-bg: var(--ny-alert-warning-bg); }
.ny-editor-root .milkdown .ProseMirror .ny-alert-warning::before { content: "Warning"; }
.ny-editor-root .milkdown .ProseMirror .ny-alert-caution { --ny-alert-color: var(--ny-alert-caution-color); --ny-alert-bg: var(--ny-alert-caution-bg); }
.ny-editor-root .milkdown .ProseMirror .ny-alert-caution::before { content: "Caution"; }

/*
 * Hide ONLY the marker span, never the surrounding paragraph.
 * The decoration wraps "[!NOTE]" (plus a trailing hard_break / blank
 * whitespace) in an inline span we can collapse off-screen while keeping
 * it in the DOM so the editor still allows the user to delete or edit it.
 */
.ny-editor-root .milkdown .ProseMirror .ny-alert-marker {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}

/*
 * Used only when the marker spans an entire blockquote paragraph (the
 * body lives in another paragraph). Collapse the now-empty paragraph
 * vertically while keeping the caret target alive.
 */
.ny-editor-root .milkdown .ProseMirror .ny-alert > .ny-alert-marker-line {
  font-size: 0 !important;
  line-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  height: 0 !important;
  min-height: 0 !important;
  color: transparent !important;
  caret-color: var(--ny-editor-text-primary) !important;
}
`;

export function registerGfmAlertStyles() {
  ensureStyle('editor-gfm-alerts', css);
}
