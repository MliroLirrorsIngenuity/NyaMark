import type { NyaEditor } from '../../editor/editor';
import type { SourceModeController } from '../../editor/source-mode';
import { i18next } from '../../i18n';
import { type Heading, MAX_DEPTH, headingBeingRead } from '../../ui/outline';
import { onPanel, postPanel } from './panels';

/** Pause after the last document change before the list is sent again. */
const RENDER_DELAY_MS = 150;

export type NativeOutlineHost = {
  editor: () => NyaEditor | null;
  sourceMode: () => SourceModeController | null;
};

/**
 * The page's side of the native outline: the headings, the one being read
 * as the page scrolls, and the jump to a heading tapped in the list.
 */
export function bindNativeOutline(host: NativeOutlineHost) {
  let open = false;
  let headings: Heading[] = [];
  let sentHeadings = '';
  let activeId: string | null = null;
  /** The tapped heading stays marked until the user scrolls themselves. */
  let pinnedId: string | null = null;
  let renderTimer: number | null = null;
  let spyFrame: number | null = null;
  let stopWatching: (() => void) | null = null;

  const sendHeadings = () => {
    const editor = host.editor();
    headings = editor?.getOutline() ?? [];
    const top = Math.min(...headings.map((heading) => heading.level));
    const items = headings.map((heading) => ({
      id: heading.id,
      text: heading.text,
      depth: Math.min(heading.level - top, MAX_DEPTH),
    }));
    const message = {
      title: i18next.t('outline.title'),
      close: i18next.t('outline.close'),
      empty: i18next.t('outline.empty'),
      headings: items,
    };
    const signature = JSON.stringify(message);
    if (signature === sentHeadings) return;
    sentHeadings = signature;
    postPanel('outline', 'headings', message);
  };

  const setActive = (id: string | null) => {
    if (id === activeId) return;
    activeId = id;
    postPanel('outline', 'active', { id });
  };

  const updateActive = () => {
    const editor = host.editor();
    if (!pinnedId && editor) setActive(headingBeingRead(editor, headings));
  };

  const onScroll = () => {
    if (pinnedId || spyFrame != null) return;
    spyFrame = requestAnimationFrame(() => {
      spyFrame = null;
      updateActive();
    });
  };
  const releasePin = () => {
    pinnedId = null;
  };

  const scheduleRender = () => {
    if (!open || renderTimer != null) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      sendHeadings();
      updateActive();
    }, RENDER_DELAY_MS);
  };

  const show = () => {
    if (open) return;
    open = true;
    sentHeadings = '';
    activeId = null;
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    for (const type of ['touchmove', 'keydown', 'mousedown']) {
      document.addEventListener(type, releasePin, {
        capture: true,
        passive: true,
      });
    }
    stopWatching = host.editor()?.onDocChanged(scheduleRender) ?? null;
    i18next.on('languageChanged', sendHeadings);
    sendHeadings();
    updateActive();
  };

  const hide = () => {
    if (!open) return;
    open = false;
    document.removeEventListener('scroll', onScroll, { capture: true });
    for (const type of ['touchmove', 'keydown', 'mousedown']) {
      document.removeEventListener(type, releasePin, { capture: true });
    }
    stopWatching?.();
    stopWatching = null;
    i18next.off('languageChanged', sendHeadings);
    if (renderTimer != null) window.clearTimeout(renderTimer);
    if (spyFrame != null) cancelAnimationFrame(spyFrame);
    renderTimer = spyFrame = null;
    pinnedId = null;
  };

  onPanel('outline', (message) => {
    switch (message.op) {
      case 'open':
        show();
        return;
      case 'close':
        hide();
        return;
      case 'go': {
        const id = String(message.id);
        // A heading near the end cannot scroll up to the reading line.
        pinnedId = id;
        setActive(id);
        if (!host.sourceMode()?.revealHeading(id)) {
          host.editor()?.scrollToHeading(id);
        }
        return;
      }
    }
  });
}
