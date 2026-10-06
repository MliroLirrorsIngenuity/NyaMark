/**
 * A proposed hunk as it is drawn in the document: what it puts in, after
 * the text it takes out, and its accept and reject buttons. The text is
 * drawn as the editor's schema writes it to the DOM, with links that go
 * nowhere and no image fetched from the web: a page the assistant read
 * could otherwise have it propose an image whose address carries the
 * document off before the user has said yes to anything.
 */

import { DOMSerializer } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Hunk } from '../../editor/plugins/ai-proposals';
import { i18next } from '../../i18n';
import { ICONS } from '../ui/icons';

export type HunkActions = {
  accept(id: number): void;
  reject(id: number): void;
  localImage(src: string): Promise<string | null>;
};

function tame(root: ParentNode, actions: HunkActions) {
  for (const link of root.querySelectorAll('a')) {
    const href = link.getAttribute('href');
    link.removeAttribute('href');
    if (href) link.title = href;
  }
  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    image.removeAttribute('src');
    image.removeAttribute('srcset');
    const stand = document.createElement('span');
    stand.className = 'ny-ai-ins__image';
    stand.textContent = image.alt || src || '…';
    stand.title = src;
    image.replaceWith(stand);
    if (!src) continue;
    actions.localImage(src).then(
      (url) => {
        if (!url || !stand.parentNode) return;
        image.loading = 'lazy';
        stand.replaceWith(image);
        image.src = url;
      },
      () => undefined
    );
  }
}

function button(
  kind: 'accept' | 'reject',
  hunk: Hunk,
  run: (id: number) => void
) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `ny-ai-hunk__${kind}`;
  element.innerHTML = kind === 'accept' ? ICONS.check : ICONS.close;
  const label = i18next.t(
    kind === 'accept' ? 'ai.edit.accept' : 'ai.edit.reject'
  );
  element.title = label;
  element.setAttribute('aria-label', label);
  // The caret stays where it is in the document.
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    run(hunk.id);
  });
  return element;
}

export function renderHunk(
  view: EditorView,
  hunk: Hunk,
  actions: HunkActions
): HTMLElement {
  const block = hunk.kind === 'block';
  const root = document.createElement(block ? 'div' : 'span');
  root.className = `ny-ai-hunk ny-ai-hunk--${hunk.kind}`;
  root.contentEditable = 'false';
  if (hunk.insert.content.size > 0) {
    const content = document.createElement(block ? 'div' : 'ins');
    content.className = block ? 'ny-ai-ins-block' : 'ny-ai-ins';
    const inert = document.implementation.createHTMLDocument('');
    const inserted = DOMSerializer.fromSchema(
      view.state.schema
    ).serializeFragment(hunk.insert.content, { document: inert });
    tame(inserted, actions);
    content.append(inserted);
    root.append(content);
  }
  const bar = document.createElement('span');
  bar.className = 'ny-ai-hunk__actions';
  // In the panel's order: reject first, accept at the end.
  bar.append(
    button('reject', hunk, actions.reject),
    button('accept', hunk, actions.accept)
  );
  root.append(bar);
  return root;
}
