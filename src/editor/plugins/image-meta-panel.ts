/**
 * "Info" overlay attached to every Crepe image block: a toggleable panel for
 * editing the caption and src path. Lives entirely in the DOM (no Milkdown
 * schema mutation) and writes back through ProseMirror transactions.
 */

import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

export class ImageMetaPanel {
  private observer: MutationObserver | null = null;
  private readonly handleRootPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const activeHost = target?.closest(
      '.milkdown-image-block.nyamark-image-meta-open'
    );
    this.root
      .querySelectorAll('.milkdown-image-block.nyamark-image-meta-open')
      .forEach((host) => {
        if (host !== activeHost) {
          host.classList.remove('nyamark-image-meta-open');
        }
      });
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly getCrepe: () => Crepe | null
  ) {}

  attach() {
    this.root.addEventListener('pointerdown', this.handleRootPointerDown);
    this.decorateAll();
    this.observer = new MutationObserver(() => this.decorateAll());
    this.observer.observe(this.root, { childList: true, subtree: true });
  }

  detach() {
    this.root.removeEventListener('pointerdown', this.handleRootPointerDown);
    this.observer?.disconnect();
    this.observer = null;
  }

  private decorateAll() {
    this.root.querySelectorAll('.milkdown-image-block').forEach((host) => {
      this.syncPanel(host as HTMLElement);
    });
  }

  private findImageNodeState(
    host: HTMLElement
  ): { pos: number; node: ProseNode } | null {
    const crepe = this.getCrepe();
    if (!crepe) return null;

    const view = crepe.editor.ctx.get(editorViewCtx);
    const hosts = Array.from(
      this.root.querySelectorAll('.milkdown-image-block')
    );
    const hostIndex = hosts.indexOf(host);
    if (hostIndex >= 0) {
      const imageNodes: Array<{ pos: number; node: ProseNode }> = [];
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image-block' || node.type.name === 'image') {
          imageNodes.push({ pos, node });
        }
      });

      if (hostIndex < imageNodes.length) {
        return imageNodes[hostIndex];
      }
    }

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
      if (
        node &&
        (node.type.name === 'image-block' || node.type.name === 'image')
      ) {
        return { pos, node };
      }

      const $pos = view.state.doc.resolve(pos);
      const after = $pos.nodeAfter;
      if (
        after &&
        (after.type.name === 'image-block' || after.type.name === 'image')
      ) {
        return { pos: $pos.pos, node: after };
      }

      const before = $pos.nodeBefore;
      if (
        before &&
        (before.type.name === 'image-block' || before.type.name === 'image')
      ) {
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
      toggle.setAttribute('aria-label', 'Toggle image details');
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
        host.classList.toggle('nyamark-image-meta-open');
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
          <span class="nyamark-image-meta__label">Description</span>
          <input type="text" class="nyamark-image-meta__input nyamark-image-meta__input--caption" placeholder="Write image description" />
        </label>
        <label class="nyamark-image-meta__field nyamark-image-meta__field--path">
          <span class="nyamark-image-meta__label">Path</span>
          <input type="text" class="nyamark-image-meta__input nyamark-image-meta__input--path" placeholder="Image path" spellcheck="false" />
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

      captionInput.addEventListener('input', () => {
        if (captionTimer) window.clearTimeout(captionTimer);
        captionTimer = window.setTimeout(commitCaption, 220);
      });
      captionInput.addEventListener('blur', () => {
        if (captionTimer) {
          window.clearTimeout(captionTimer);
          captionTimer = 0;
        }
        commitCaption();
      });

      pathInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const nextSrc = pathInput.value.trim();
          if (nextSrc) this.updateImageNodeAttrs(host, { src: nextSrc });
          pathInput.blur();
        }
      });
      pathInput.addEventListener('blur', () => {
        const nextSrc = pathInput.value.trim();
        if (nextSrc) this.updateImageNodeAttrs(host, { src: nextSrc });
      });

      panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          host.classList.remove('nyamark-image-meta-open');
        }
      });
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
