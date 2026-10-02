/**
 * Find and replace for the source pane.
 *
 * CodeMirror's own panel is a form of native buttons and checkboxes labelled
 * in English, and in a half-width pane it wrapped onto three lines. This one
 * looks and reads like the document search (ui/search.ts), with the replace
 * row folded away until asked for. Matching is literal and ignores case, as
 * there.
 */

import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from '@codemirror/search';
import {
  type EditorView,
  type Panel,
  runScopeHandlers,
} from '@codemirror/view';
import { i18next } from '../i18n';
import { translateDOM } from '../i18n/dom';
import { ensureStyle } from '../style/register';
import { forInputMethod } from '../ui/ime';

const styles = `
/* Docked above the text rather than floating over it: a floating panel hid
   the first lines, and a match there could not be scrolled out from under it. */
.ny-source-pane .cm-panels.cm-panels-top {
  display: flex;
  justify-content: flex-end;
  padding: 8px 14px 4px;
  border: 0;
  background: transparent;
}

.ny-source-search {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto auto;
  align-items: center;
  gap: 4px 6px;
  padding: 6px 8px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 12px;
  background: var(--ny-surface-ghost);
  box-shadow: var(--ny-shadow-float);
  backdrop-filter: blur(20px) saturate(1.1);
  -webkit-backdrop-filter: blur(20px) saturate(1.1);
  font-family: var(--ny-font-sans);
  animation: ny-search-in 0.15s ease;
}

.ny-source-search .ny-search__input {
  width: 168px;
  height: 24px;
}

.ny-source-search__replace {
  grid-column: 2 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ny-source-search__replace[hidden] {
  display: none;
}

.ny-source-search__text-button {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ny-text-secondary);
  font-size: 12px;
  white-space: nowrap;
  cursor: default;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.ny-source-search__text-button:hover {
  background: color-mix(in srgb, var(--ny-surface-elevated), var(--ny-accent) 8%);
  color: var(--ny-text-primary);
}

.ny-source-search__toggle svg {
  transition: transform 0.15s ease;
}

.ny-source-search__toggle[aria-expanded="true"] svg {
  transform: rotate(90deg);
}
`;

/** Counting stops here; a longer run shows as "1000+". */
const COUNT_LIMIT = 1000;

const CHEVRON =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function button(className: string, label: string, i18nKey: string) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.setAttribute('aria-label', label);
  el.setAttribute('data-i18n-aria-label', i18nKey);
  el.setAttribute('title', label);
  el.setAttribute('data-i18n-title', i18nKey);
  return el;
}

function textButton(i18nKey: string) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ny-source-search__text-button';
  el.setAttribute('data-i18n', i18nKey);
  return el;
}

function input(i18nKey: string) {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'ny-search__input';
  el.spellcheck = false;
  el.setAttribute('data-i18n-placeholder', i18nKey);
  el.setAttribute('data-i18n-aria-label', i18nKey);
  return el;
}

function createPanel(view: EditorView): Panel {
  ensureStyle('source-search', styles);

  const dom = document.createElement('div');
  dom.className = 'ny-source-search';
  dom.setAttribute('role', 'search');

  const toggle = button(
    'ny-search__button ny-source-search__toggle',
    'Replace',
    'search.toggleReplace'
  );
  toggle.innerHTML = CHEVRON;
  toggle.setAttribute('aria-expanded', 'false');

  const findField = input('search.placeholder');
  // openSearchPanel focuses the field marked `main-field`.
  findField.setAttribute('main-field', 'true');
  const count = document.createElement('span');
  count.className = 'ny-search__count';
  count.setAttribute('aria-live', 'polite');

  const prev = button('ny-search__button', 'Previous match', 'search.prev');
  prev.textContent = '↑';
  const next = button('ny-search__button', 'Next match', 'search.next');
  next.textContent = '↓';
  const close = button(
    'ny-search__button ny-search__button--close',
    'Close search',
    'search.close'
  );
  close.textContent = '✕';

  const replaceRow = document.createElement('div');
  replaceRow.className = 'ny-source-search__replace';
  replaceRow.hidden = true;
  const replaceField = input('search.replacePlaceholder');
  const replaceOne = textButton('search.replace');
  const replaceEvery = textButton('search.replaceAll');
  replaceRow.append(replaceField, replaceOne, replaceEvery);

  dom.append(toggle, findField, count, prev, next, close, replaceRow);
  translateDOM(dom);

  const initial = getSearchQuery(view.state);
  findField.value = initial.search;
  replaceField.value = initial.replace;

  const renderCount = () => {
    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) {
      count.textContent = '';
      return;
    }
    const { main } = view.state.selection;
    const cursor = query.getCursor(view.state);
    let total = 0;
    let current = 0;
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      total += 1;
      if (step.value.from === main.from && step.value.to === main.to) {
        current = total;
      }
      if (total >= COUNT_LIMIT) break;
    }
    const shown = total >= COUNT_LIMIT ? `${COUNT_LIMIT}+` : total;
    count.textContent =
      total === 0
        ? i18next.t('search.noResults')
        : i18next.t('search.count', { current, total: shown });
  };

  /** Selects the first match at or after the caret, wrapping to the top. */
  const selectFirst = () => {
    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) return;
    const from = view.state.selection.main.from;
    let match = query.getCursor(view.state, from).next();
    if (match.done) match = query.getCursor(view.state, 0, from).next();
    if (match.done) return;
    view.dispatch({
      selection: { anchor: match.value.from, head: match.value.to },
      scrollIntoView: true,
    });
  };

  const commit = (find: boolean) => {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: findField.value,
          replace: replaceField.value,
          caseSensitive: false,
          literal: true,
        })
      ),
    });
    if (find) selectFirst();
  };

  // An IME commits its text on compositionend; the half-typed composition
  // is not searched for.
  findField.addEventListener('input', (event) => {
    if (!(event as InputEvent).isComposing) commit(true);
  });
  findField.addEventListener('compositionend', () => commit(true));
  replaceField.addEventListener('input', (event) => {
    if (!(event as InputEvent).isComposing) commit(false);
  });
  replaceField.addEventListener('compositionend', () => commit(false));

  dom.addEventListener('keydown', (event) => {
    if (forInputMethod(event)) return;
    // Escape, Mod-G and the rest of CodeMirror's search keys.
    if (runScopeHandlers(view, event, 'search-panel')) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.target === replaceField) replaceNext(view);
    else if (event.shiftKey) findPrevious(view);
    else findNext(view);
  });

  toggle.addEventListener('click', () => {
    const open = replaceRow.hidden;
    replaceRow.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    (open ? replaceField : findField).focus();
  });
  // WebKit leaves a clicked button unfocused and sends focus to the body,
  // where Escape and Enter no longer reached the panel.
  for (const el of [prev, next, close, replaceOne, replaceEvery]) {
    el.addEventListener('mousedown', (event) => event.preventDefault());
  }
  prev.addEventListener('click', () => findPrevious(view));
  next.addEventListener('click', () => findNext(view));
  close.addEventListener('click', () => closeSearchPanel(view));
  replaceOne.addEventListener('click', () => replaceNext(view));
  replaceEvery.addEventListener('click', () => replaceAll(view));

  return {
    dom,
    top: true,
    mount: () => {
      renderCount();
      findField.focus();
      findField.select();
    },
    update: (update) => {
      const query = getSearchQuery(update.state);
      // Mod-F over a selection searches for it.
      if (!query.eq(getSearchQuery(update.startState))) {
        if (query.search !== findField.value) findField.value = query.search;
        if (query.replace !== replaceField.value) {
          replaceField.value = query.replace;
        }
      }
      if (
        update.docChanged ||
        update.selectionSet ||
        !query.eq(getSearchQuery(update.startState))
      ) {
        renderCount();
      }
    },
  };
}

export function sourceSearch() {
  return search({ top: true, literal: true, createPanel });
}
