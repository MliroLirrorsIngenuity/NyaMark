/**
 * "Info" overlay attached to every Crepe image block: a toggleable panel for
 * editing the caption and src path. Lives entirely in the DOM (no Milkdown
 * schema mutation) and writes back through ProseMirror transactions.
 */

import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { translateDOM } from '../../i18n/dom';
import { pushEscapeLayer } from '../../ui/escape-layers';

const IMAGE_BLOCK = 'image-block';

export class ImageMetaPanel {
  private decorateFrame = 0;
  /** Escape layers of the open panels, by image block. */
  private readonly openPanels = new Map<HTMLElement, () => void>();

  private readonly handleRootPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const activeHost = target?.closest(
      '.milkdown-image-block.nyamark-image-meta-open'
    );
    for (const host of [...this.openPanels.keys()]) {
      if (host !== activeHost) this.setOpen(host, false);
    }
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly getCrepe: () => Crepe | null
  ) {}

  attach() {
    this.root.addEventListener('pointerdown', this.handleRootPointerDown);
    this.decorateAll();
    // Typing mutates the editor DOM on nearly every keystroke; one pass per
    // frame is plenty for panels that only follow image blocks.
    new MutationObserver(() => {
      if (this.decorateFrame) return;
      this.decorateFrame = requestAnimationFrame(() => {
        this.decorateFrame = 0;
        this.decorateAll();
      });
    }).observe(this.root, { childList: true, subtree: true });
  }

  /**
   * Opening puts the caret in the description, the field the panel is for.
   * Closing hands the caret back to the document: the panel only fades out,
   * and its field kept the focus, so typing after Escape went on into a
   * description no longer on screen.
   */
  private setOpen(host: HTMLElement, open: boolean) {
    host.classList.toggle('nyamark-image-meta-open', open);
    const release = this.openPanels.get(host);
    if (open && !release) {
      this.openPanels.set(
        host,
        pushEscapeLayer({ dismiss: () => this.setOpen(host, false) })
      );
    } else if (!open && release) {
      release();
      this.openPanels.delete(host);
    }
    const panel = host.querySelector('.nyamark-image-meta');
    if (open) {
      panel
        ?.querySelector<HTMLInputElement>('.nyamark-image-meta__input--caption')
        ?.focus();
    } else if (host.isConnected && panel?.contains(document.activeElement)) {
      this.getCrepe()?.editor.ctx.get(editorViewCtx).focus();
    }
  }

  private decorateAll() {
    // An image deleted with its panel open must not keep taking Escape.
    for (const host of [...this.openPanels.keys()]) {
      if (!host.isConnected) this.setOpen(host, false);
    }
    for (const host of this.root.querySelectorAll<HTMLElement>(
      '.milkdown-image-block'
    )) {
      this.syncPanel(host);
    }
  }

  private findImageNodeState(
    host: HTMLElement
  ): { pos: number; node: ProseNode } | null {
    const crepe = this.getCrepe();
    if (!crepe) return null;

    // Located through the DOM, never by counting: inline images and images in
    // other containers would shift any index-based pairing onto the wrong node.
    const view = crepe.editor.ctx.get(editorViewCtx);
    const docSize = view.state.doc.content.size;
    const anchorTargets = [
      host.querySelector('img[data-type]'),
      host.querySelector('img'),
      host,
    ].filter((value): value is HTMLElement => value instanceof HTMLElement);

    const candidates = anchorTargets.flatMap((target) => {
      try {
        const anchor = view.posAtDOM(target, 0);
        return [anchor, anchor - 1, anchor + 1];
      } catch {
        return [];
      }
    });

    for (const pos of candidates) {
      if (pos < 0 || pos > docSize) continue;
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name === IMAGE_BLOCK) {
        return { pos, node };
      }

      const $pos = view.state.doc.resolve(pos);
      const after = $pos.nodeAfter;
      if (after?.type.name === IMAGE_BLOCK) {
        return { pos: $pos.pos, node: after };
      }

      const before = $pos.nodeBefore;
      if (before?.type.name === IMAGE_BLOCK) {
        return { pos: $pos.pos - before.nodeSize, node: before };
      }
    }

    return null;
  }

  private syncPanel(host: HTMLElement) {
    host.querySelector('.image-wrapper .operation')?.remove();
    host.querySelector('.caption-input')?.remove();
    host.draggable = false;

    const state = this.findImageNodeState(host);
    const currentSrc = String(
      state?.node.attrs.src ??
        host.querySelector('img[data-type]')?.getAttribute('src') ??
        host.querySelector('img')?.getAttribute('src') ??
        ''
    );
    const currentCaption = String(state?.node.attrs.caption ?? '');
    const wrapper = host.querySelector('.image-wrapper') as HTMLElement | null;
    if (!wrapper) return;
    wrapper.draggable = false;
    const image = wrapper.querySelector('img');
    if (image instanceof HTMLImageElement) {
      image.draggable = false;
      this.syncBroken(host, wrapper, image, currentSrc);
    }

    if (!host.dataset.nyamarkMetaBound) {
      const stopMouseEvent = (event: Event) => {
        const target =
          event.target instanceof HTMLElement ? event.target : null;
        if (
          target?.closest('.nyamark-image-meta, .nyamark-image-meta-toggle')
        ) {
          event.stopPropagation();
        }
      };
      const stopDragEvent = (event: DragEvent) => {
        const target =
          event.target instanceof HTMLElement ? event.target : null;
        if (
          target?.closest('.nyamark-image-meta, .nyamark-image-meta-toggle')
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      host.addEventListener('mousedown', stopMouseEvent, true);
      host.addEventListener('pointerdown', stopMouseEvent, true);
      host.addEventListener('dragstart', stopDragEvent, true);
      host.dataset.nyamarkMetaBound = 'true';
    }

    let toggle = wrapper.querySelector(
      '.nyamark-image-meta-toggle'
    ) as HTMLButtonElement | null;
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nyamark-image-meta-toggle';
      toggle.draggable = false;
      toggle.setAttribute('contenteditable', 'false');
      toggle.textContent = 'Info';
      toggle.dataset.i18n = 'editor.image.info';
      toggle.setAttribute('aria-label', 'Toggle image details');
      toggle.dataset.i18nAriaLabel = 'editor.image.toggleInfo';
      toggle.addEventListener('pointerdown', (event) =>
        event.stopPropagation()
      );
      toggle.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setOpen(host, !host.classList.contains('nyamark-image-meta-open'));
      });
      wrapper.appendChild(toggle);
    }

    let panel = wrapper.querySelector(
      '.nyamark-image-meta'
    ) as HTMLElement | null;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'nyamark-image-meta';
      panel.draggable = false;
      panel.setAttribute('contenteditable', 'false');
      panel.innerHTML = `
        <label class="nyamark-image-meta__field nyamark-image-meta__field--caption">
          <span class="nyamark-image-meta__label" data-i18n="editor.image.description">Description</span>
          <input type="text" class="nyamark-image-meta__input nyamark-image-meta__input--caption" placeholder="Write image description" data-i18n-placeholder="editor.image.descriptionPlaceholder" />
        </label>
        <label class="nyamark-image-meta__field nyamark-image-meta__field--path">
          <span class="nyamark-image-meta__label" data-i18n="editor.image.path">Path</span>
          <input type="text" class="nyamark-image-meta__input nyamark-image-meta__input--path" placeholder="Image path" spellcheck="false" data-i18n-placeholder="editor.image.pathPlaceholder" />
        </label>
      `;
      wrapper.appendChild(panel);

      const captionInput = panel.querySelector(
        '.nyamark-image-meta__input--caption'
      ) as HTMLInputElement;
      const pathInput = panel.querySelector(
        '.nyamark-image-meta__input--path'
      ) as HTMLInputElement;
      captionInput.draggable = false;
      pathInput.draggable = false;

      panel.addEventListener('pointerdown', (event) => event.stopPropagation());
      panel.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      let captionTimer = 0;
      const commitCaption = () => {
        const nextCaption = captionInput.value.trim();
        this.updateImageNodeAttrs(host, { caption: nextCaption });
      };

      const scheduleCaptionCommit = () => {
        if (captionTimer) window.clearTimeout(captionTimer);
        captionTimer = window.setTimeout(commitCaption, 220);
      };
      // An IME composition is not text yet; committing it mid-way would
      // write half-composed syllables into the document.
      captionInput.addEventListener('input', (event) => {
        if (!(event as InputEvent).isComposing) scheduleCaptionCommit();
      });
      captionInput.addEventListener('compositionend', scheduleCaptionCommit);
      // Enter is done: the panel closes, and the blur commits the field.
      const closeOnEnter = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        this.setOpen(host, false);
      };
      captionInput.addEventListener('keydown', closeOnEnter);
      captionInput.addEventListener('blur', () => {
        if (captionTimer) {
          window.clearTimeout(captionTimer);
          captionTimer = 0;
        }
        commitCaption();
      });

      pathInput.addEventListener('keydown', closeOnEnter);
      pathInput.addEventListener('blur', () => {
        const nextSrc = pathInput.value.trim();
        if (nextSrc) this.updateImageNodeAttrs(host, { src: nextSrc });
      });
      translateDOM(wrapper);
    }

    const captionInput = panel.querySelector(
      '.nyamark-image-meta__input--caption'
    ) as HTMLInputElement | null;
    const pathInput = panel.querySelector(
      '.nyamark-image-meta__input--path'
    ) as HTMLInputElement | null;

    if (
      captionInput &&
      document.activeElement !== captionInput &&
      captionInput.value !== currentCaption
    ) {
      captionInput.value = currentCaption;
    }
    if (
      pathInput &&
      document.activeElement !== pathInput &&
      pathInput.value !== currentSrc
    ) {
      pathInput.value = currentSrc;
    }
  }

  /**
   * A picture that fails to load showed WebKit's broken-image glyph in a bare
   * 100px box, with no word of what went wrong or which path was tried. It
   * gives way to a card that says so and names the path, for the info panel
   * to correct.
   */
  private syncBroken(
    host: HTMLElement,
    wrapper: HTMLElement,
    image: HTMLImageElement,
    src: string
  ) {
    let card = wrapper.querySelector<HTMLElement>('.nyamark-image-broken');
    if (!card) {
      card = document.createElement('div');
      card.className = 'nyamark-image-broken';
      card.setAttribute('contenteditable', 'false');
      card.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3l18 18" />
          <path d="M9 4h10a1 1 0 0 1 1 1v10" />
          <path d="M20 19.5a1 1 0 0 1-1 .5H5a1 1 0 0 1-1-1V5a1 1 0 0 1 .5-.9" />
          <path d="M4 16l4.5-4.5L12 15" />
        </svg>
        <span class="nyamark-image-broken__title" data-i18n="editor.image.broken">Can't load this image</span>
        <span class="nyamark-image-broken__path"></span>
      `;
      translateDOM(card);
      image.after(card);
    }
    const path = card.querySelector('.nyamark-image-broken__path');
    if (path && path.textContent !== src) path.textContent = src;

    // Settled before this saw it, or settling later (a corrected path loads).
    const update = () =>
      host.classList.toggle(
        'nyamark-image-broken',
        image.complete && image.naturalWidth === 0 && !!image.src
      );
    if (!image.dataset.nyamarkWatched) {
      image.dataset.nyamarkWatched = 'true';
      image.addEventListener('load', update);
      image.addEventListener('error', update);
    }
    update();
  }

  private updateImageNodeAttrs(
    host: HTMLElement,
    attrs: { src?: string; caption?: string }
  ) {
    const crepe = this.getCrepe();
    if (!crepe) return;
    const state = this.findImageNodeState(host);
    if (!state) return;

    const view = crepe.editor.ctx.get(editorViewCtx);
    let transaction = view.state.tr;
    if (attrs.src !== undefined && attrs.src !== state.node.attrs.src) {
      transaction = transaction.setNodeAttribute(state.pos, 'src', attrs.src);
    }
    if (
      attrs.caption !== undefined &&
      attrs.caption !== state.node.attrs.caption
    ) {
      transaction = transaction.setNodeAttribute(
        state.pos,
        'caption',
        attrs.caption
      );
    }
    if (!transaction.docChanged) return;
    transaction = transaction.scrollIntoView();
    view.dispatch(transaction);
  }
}
