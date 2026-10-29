import { countText, shownTotal } from '../../editor/source-search';
import { i18next } from '../../i18n';
import { store } from '../../state/store';
import type { NativePanelsHost } from './index';
import { onPanel, postPanel } from './panels';

/** Has the native shell show its find bar, which then tells the page it is open. */
export function openNativeFind() {
  postPanel('find', 'present');
}

/**
 * The page's side of the native find bar: the search in the document or the
 * source pane, the count of its matches, and the replace of the source pane.
 */
export function bindNativeFind(host: NativePanelsHost) {
  let open = false;
  let query = '';
  let sentState = '';
  let sourceBefore = store.getState().sourceMode;
  let stopWatching: (() => void) | null = null;

  const sourcePane = () => {
    const pane = host.sourceMode();
    return pane?.isActive() ? pane : null;
  };
  const target = () => sourcePane() ?? host.editor();

  const count = () => {
    const status = target()?.searchStatus();
    if (!query || !status) return '';
    return countText(
      status.current,
      sourcePane() ? shownTotal(status.total) : status.total
    );
  };

  const sendState = (force = false) => {
    const state = {
      query,
      count: count(),
      source: sourcePane() != null,
      labels: {
        placeholder: i18next.t('search.placeholder'),
        next: i18next.t('search.next'),
        prev: i18next.t('search.prev'),
        close: i18next.t('search.close'),
        toggleReplace: i18next.t('search.toggleReplace'),
        replacePlaceholder: i18next.t('search.replacePlaceholder'),
        replace: i18next.t('search.replace'),
        replaceAll: i18next.t('search.replaceAll'),
      },
    };
    const signature = JSON.stringify(state);
    if (!force && signature === sentState) return;
    sentState = signature;
    postPanel('find', 'state', state);
  };

  const refresh = () => sendState();

  const search = (direction: 'first' | 'next' | 'prev') => {
    target()?.search(query, direction);
    sendState();
  };

  const onSelection = () => {
    if (sourcePane()) sendState();
  };

  const show = () => {
    // Text selected in the document is what to look for.
    const selected = target()?.selectedLine() ?? '';
    if (selected) query = selected;
    const opening = !open;
    if (opening) {
      open = true;
      // Edits (or another file) change the matches under an open bar.
      stopWatching = host.editor()?.onDocChanged(refresh) ?? null;
      i18next.on('languageChanged', refresh);
      document.addEventListener('selectionchange', onSelection);
    }
    if (query && (opening || selected)) target()?.search(query, 'first');
    sendState(true);
  };

  const hide = () => {
    if (!open) return;
    open = false;
    stopWatching?.();
    stopWatching = null;
    i18next.off('languageChanged', refresh);
    document.removeEventListener('selectionchange', onSelection);
    target()?.endSearch();
    sentState = '';
  };

  store.subscribe((state) => {
    if (state.sourceMode === sourceBefore) return;
    sourceBefore = state.sourceMode;
    if (!open) return;
    // The source pane's search ended with the pane.
    if (state.sourceMode) host.editor()?.endSearch();
    search('first');
  });

  onPanel('find', (message) => {
    if (message.op === 'open') {
      show();
      return;
    }
    if (!open) return;
    switch (message.op) {
      case 'close':
        hide();
        return;
      case 'query':
        query = String(message.text ?? '');
        search('first');
        return;
      case 'next':
        search('next');
        return;
      case 'prev':
        search('prev');
        return;
      case 'replace':
        host.sourceMode()?.replace(String(message.text ?? ''));
        sendState();
        return;
      case 'replaceAll':
        host.sourceMode()?.replaceAll(String(message.text ?? ''));
        sendState();
        return;
    }
  });
}
