import { EditorView as CodeMirror } from '@codemirror/view';
import DOMPurify from 'dompurify';
import i18next from 'i18next';
import type { MermaidConfig } from 'mermaid';
import type { EditorView } from 'prosemirror-view';

type Mermaid = typeof import('mermaid').default;

const FONT_FAMILY =
  'SF Pro Text, PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, sans-serif';

/** Typing pause before a mermaid block is re-rendered. */
const RENDER_DELAY_MS = 300;

function mermaidConfig(isDark: boolean): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    htmlLabels: false,
    // On a parse error mermaid otherwise draws its own error diagram; the
    // message is shown in place of the preview instead.
    suppressErrorRendering: true,
    themeVariables: {
      primaryColor: isDark ? '#243446' : '#eef2ff',
      primaryBorderColor: isDark ? '#8db4c8' : '#8b7cf6',
      primaryTextColor: isDark ? '#edf3f8' : '#1f2937',
      lineColor: isDark ? '#a5b8c9' : '#3f3f46',
      secondaryColor: isDark ? '#1c2733' : '#f5f3ff',
      tertiaryColor: isDark ? '#141a22' : '#fafaf9',
      fontFamily: FONT_FAMILY,
    },
  };
}

let isDarkTheme = false;
let loadedMermaid: Mermaid | null = null;
let mermaidPromise: Promise<Mermaid> | null = null;

/**
 * Mermaid is the largest dependency by far, and most documents have no
 * diagram, so it is fetched on the first render instead of with the editor.
 */
function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then(
    ({ default: mermaid }) => {
      mermaid.initialize(mermaidConfig(isDarkTheme));
      loadedMermaid = mermaid;
      return mermaid;
    },
    (error) => {
      mermaidPromise = null;
      throw error;
    }
  );
  return mermaidPromise;
}

export function configureMermaid(isDark: boolean) {
  isDarkTheme = isDark;
  loadedMermaid?.initialize(mermaidConfig(isDark));
}

function genId() {
  return `mermaid-${Math.random().toString(36).slice(2, 11)}`;
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ] ?? ch
  );
}

type Drawing = { ok: boolean; markup: string };

/**
 * The last diagrams drawn, by theme and source. A code block's view is built
 * again when the blocks around it change, and each time it drew its diagram
 * anew.
 */
const drawings = new Map<string, Drawing>();
const KEPT_DRAWINGS = 24;

function drawingKey(content: string) {
  return `${isDarkTheme ? 'dark' : 'light'}\n${content}`;
}

/**
 * Render a diagram to the markup the preview shows: the SVG, or the parser's
 * message when the source does not parse. Mermaid renders inside a
 * temporary element under `<body>` and does not always remove it when it
 * throws, so a failed render cleans up after it.
 */
async function renderDiagram(content: string): Promise<Drawing> {
  const key = drawingKey(content);
  const kept = drawings.get(key);
  if (kept) return kept;
  const id = genId();
  let drawing: Drawing;
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(id, content);
    drawing = {
      ok: true,
      markup: `<div class="nyamark-mermaid-preview">${svg}</div>`,
    };
  } catch (error) {
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    const message = error instanceof Error ? error.message : String(error);
    drawing = {
      ok: false,
      markup: `<div class="nyamark-mermaid-error">${escapeHtml(message)}</div>`,
    };
  }
  drawings.set(key, drawing);
  if (drawings.size > KEPT_DRAWINGS) {
    drawings.delete(drawings.keys().next().value as string);
  }
  return drawing;
}

/*
 * Diagrams are drawn as they come near the screen. Drawing one holds the
 * page for a few hundred milliseconds, and a document opened with six of
 * them could not be scrolled or typed in for over a second. Each waits
 * under a placeholder until it is within a screen's height of what is
 * shown, and they are drawn one at a time, with input and painting let in
 * between.
 */

type Job = { content: string; place: (markup: string) => void };

/** Diagrams waiting to be drawn, by the element standing where each goes. */
const jobs = new Map<Element, Job>();
/** Those whose placeholder Crepe has yet to put in the page, by its id. */
const unplaced = new Map<string, Job>();
/** Those near the screen. */
const due = new Set<Element>();
const observers = new Map<Element | null, IntersectionObserver>();
let draining = false;
let attachQueued = false;

function placeholder(id: string) {
  const label = escapeHtml(i18next.t('editor.blocks.loading'));
  return `<div class="nyamark-mermaid-pending" data-mermaid-job="${id}">${label}</div>`;
}

/**
 * What scrolls the page `element` is in. The search starts above the code
 * block: the preview inside scrolls a wide diagram sideways, and taken for
 * the page it made every diagram look on screen.
 */
function scrollParent(element: Element): Element | null {
  const block = element.closest('.milkdown-code-block') ?? element;
  for (let node = block.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/** The part of the page `scroller` shows, top and bottom. */
function shownSpan(scroller: Element | null): [number, number] {
  if (!scroller) return [0, window.innerHeight];
  const { top, bottom } = scroller.getBoundingClientRect();
  return [top, bottom];
}

function watchFor(element: Element, job: Job) {
  jobs.set(element, job);
  const root = scrollParent(element);
  let observer = observers.get(root);
  if (!observer) {
    observer = new IntersectionObserver(onNearScreen, {
      root,
      rootMargin: '100% 0px',
    });
    observers.set(root, observer);
  }
  observer.observe(element);
}

function forget(element: Element) {
  jobs.delete(element);
  due.delete(element);
  for (const observer of observers.values()) observer.unobserve(element);
}

/** Watch the placeholders Crepe has put in since, and drop the gone ones. */
function attachPlaceholders() {
  attachQueued = false;
  for (const element of document.querySelectorAll('[data-mermaid-job]')) {
    const id = (element as HTMLElement).dataset.mermaidJob ?? '';
    const job = unplaced.get(id);
    if (job) watchFor(element, job);
  }
  // One not in the page by now belongs to a block already replaced.
  unplaced.clear();
  for (const element of jobs.keys()) {
    if (!element.isConnected) forget(element);
  }
}

function queueAttach() {
  if (attachQueued) return;
  attachQueued = true;
  window.setTimeout(attachPlaceholders, 0);
}

function onNearScreen(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    if (entry.isIntersecting && jobs.has(entry.target)) due.add(entry.target);
    else due.delete(entry.target);
  }
  void drainDue();
}

/** The waiting diagram nearest to what is shown, those on screen first. */
function nearestDue(): Element | undefined {
  let nearest: Element | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const element of due) {
    const [top, bottom] = shownSpan(scrollParent(element));
    const rect = element.getBoundingClientRect();
    const distance = Math.max(0, top - rect.bottom, rect.top - bottom);
    if (distance < nearestDistance) {
      nearest = element;
      nearestDistance = distance;
    }
  }
  return nearest;
}

async function drainDue() {
  if (draining) return;
  draining = true;
  try {
    for (let element = nearestDue(); element; element = nearestDue()) {
      due.delete(element);
      await draw(element);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    draining = false;
  }
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Draw the diagram waiting at `element`. One drawn above the screen grows
 * the page there, and WebKit, with no scroll anchoring, pushed the text
 * being read down by its height; the scroll moves with it instead. The
 * frame waited for comes before the page is painted.
 */
async function draw(element: Element) {
  const job = jobs.get(element);
  if (!job) return;
  const { markup } = await renderDiagram(job.content);
  // A newer job for the element, as a second change of theme, draws it.
  if (jobs.get(element) !== job) return;
  forget(element);
  if (!element.isConnected) return;

  const block = element.closest('.milkdown-code-block') ?? element;
  const scroller = scrollParent(block);
  const [top] = shownSpan(scroller);
  const before = block.getBoundingClientRect();
  job.place(markup);
  const scrolled = scroller ?? document.scrollingElement;
  if (!scrolled || before.top >= top) return;
  await nextFrame();
  if (!block.isConnected) return;
  scrolled.scrollTop += block.getBoundingClientRect().height - before.height;
}

/** Draw every diagram still waiting: a printed page shows all of them. */
export async function drawWaitingDiagrams() {
  // Crepe puts a placeholder in after the change that asked for it.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  attachPlaceholders();
  for (const element of [...jobs.keys()]) await draw(element);
}

/**
 * The preview while a diagram is being typed. Half a line does not parse,
 * and swapping a tall diagram for a two-line message threw everything below
 * the block up the page at each pause. The last diagram that rendered stays,
 * faded, under the message.
 */
async function renderWhileTyping(
  content: string,
  editor: Element
): Promise<string> {
  const { ok, markup } = await renderDiagram(content);
  if (ok) return markup;
  const last = editor
    .closest('.milkdown-code-block')
    ?.querySelector('.preview .nyamark-mermaid-preview');
  if (!last) return markup;
  return `<div class="nyamark-mermaid-stale">${markup}${last.outerHTML}</div>`;
}

type PendingRender = { timer: number; sequence: number };

/**
 * Renders scheduled while typing, keyed on the CodeMirror editor being typed
 * in. Only one block is edited at a time, but a document can hold many, and
 * on load every block asks for its preview at once; the key keeps those
 * apart from each other and from the debounce.
 */
const pendingRenders = new Map<Element, PendingRender>();

function editorBeingTyped(): Element | null {
  const active = document.activeElement;
  return active?.closest('.milkdown-code-block .cm-editor') ?? null;
}

/** Whether `editor` no longer holds `content`: its render is out of date. */
function changedSince(editor: Element, content: string): boolean {
  const cm =
    editor instanceof HTMLElement ? CodeMirror.findFromDOM(editor) : null;
  return cm != null && cm.state.doc.toString() !== content;
}

/**
 * `renderPreview` hook of Crepe's code block. Called with every change to
 * the block's text; rendering is asynchronous (returns `undefined`) and, while
 * the block is being typed in, waits for a pause so each keystroke does not
 * cost a full parse and layout. A render whose block changed again before
 * it finished is dropped rather than shown over the newer one.
 *
 * A change made from outside the code, as the closing fence typed and taken
 * out on Enter, comes after the caret has left it and is drawn when near
 * the screen, at once if it is on it. The render still waiting from the
 * last keystroke in it is dropped too: it drew the fence into the diagram
 * over the right one.
 */
export function renderMermaidPreview(
  language: string,
  content: string,
  applyPreview: (value: string) => void
): string | null | undefined {
  if (language !== 'mermaid' || !content.trim()) return null;

  const editor = editorBeingTyped();
  if (!editor) {
    const kept = drawings.get(drawingKey(content));
    if (kept) return kept.markup;
    const id = genId();
    unplaced.set(id, { content, place: applyPreview });
    queueAttach();
    return placeholder(id);
  }

  const previous = pendingRenders.get(editor);
  if (previous) window.clearTimeout(previous.timer);
  const sequence = (previous?.sequence ?? 0) + 1;
  const timer = window.setTimeout(() => {
    void renderWhileTyping(content, editor).then((markup) => {
      if (pendingRenders.get(editor)?.sequence !== sequence) return;
      pendingRenders.delete(editor);
      if (changedSince(editor, content)) return;
      applyPreview(markup);
    });
  }, RENDER_DELAY_MS);
  pendingRenders.set(editor, { timer, sequence });
  return undefined;
}

/**
 * Re-render every mermaid preview after a theme change, each as it comes
 * near the screen. The colours are baked into the SVG, so each diagram is
 * drawn again from its source. The source comes from the document node:
 * CodeMirror only keeps the visible lines in the DOM and its line elements
 * carry no newlines, so reading the editor's text would hand mermaid a
 * truncated single line.
 */
export function reRenderMermaidPreviews(
  root: HTMLElement,
  view: EditorView | null
) {
  const previews = root.querySelectorAll(
    '.nyamark-mermaid-stale, :is(.nyamark-mermaid-preview, .nyamark-mermaid-error):not(.nyamark-mermaid-stale *)'
  );
  if (!previews.length || !view) return;

  const previewByBlock = new Map<Element, Element>();
  for (const preview of previews) {
    const block = preview.closest('.milkdown-code-block');
    if (block) previewByBlock.set(block, preview);
  }

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof Element)) return false;
    for (const [block, preview] of previewByBlock) {
      if (dom !== block && !dom.contains(block)) continue;
      previewByBlock.delete(block);
      const content = node.textContent;
      if (!content.trim()) break;
      watchFor(preview, {
        content,
        place: (markup) => {
          preview.outerHTML = DOMPurify.sanitize(markup);
        },
      });
      break;
    }
    return false;
  });
}

/**
 * Bind a theme-change listener. Returns an `unbind` function so callers can
 * detach when destroying the editor.
 */
export function bindMermaidThemeListener(
  root: HTMLElement,
  getView: () => EditorView | null
): () => void {
  const handler = () => {
    configureMermaid(document.documentElement.dataset.theme === 'dark');
    reRenderMermaidPreviews(root, getView());
  };
  window.addEventListener('nyamark:themechange', handler);
  return () => window.removeEventListener('nyamark:themechange', handler);
}
