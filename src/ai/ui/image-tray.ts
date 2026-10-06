import {
  ImageReadError,
  type ImageReadFailure,
  type InvokeFailure,
} from '../../bridge/ipc/ai';
import { i18next } from '../../i18n';
import {
  type ChatImage,
  ImageError,
  type ImageErrorCode,
  MAX_IMAGES,
} from '../images/image';
import { ICONS } from './icons';

/** What went wrong with an image, in the user's words. */
const REASONS: Record<
  ImageErrorCode | (ImageReadFailure | InvokeFailure)['kind'],
  string
> = {
  'too-large': 'ai.image.reason.tooLarge',
  'not-an-image': 'ai.image.reason.notImage',
  forbidden: 'ai.image.reason.forbidden',
  'not-found': 'ai.image.reason.notFound',
  io: 'ai.image.reason.other',
  invoke: 'ai.image.reason.other',
};

function reasonOf(error: unknown): string {
  if (error instanceof ImageError) return i18next.t(REASONS[error.code]);
  if (error instanceof ImageReadError) {
    return i18next.t(REASONS[error.failure.kind]);
  }
  return i18next.t('ai.image.reason.other');
}

/** A thumbnail's address, to be revoked when it is no longer shown. */
export function imageUrl(image: ChatImage): string {
  return URL.createObjectURL(
    new Blob([image.data], {
      type: image.mediaType,
    })
  );
}

type Item = { image: ChatImage; url: string; element: HTMLElement };

/** The images going with the next message, over where it is written. */
export class ImageTray {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly notice: HTMLElement;
  private items: Item[] = [];
  /** The model's name when it is not known to see images. */
  private blind: string | null = null;
  private told: { key: string; options: Record<string, unknown> } | null = null;

  constructor(private readonly changed: () => void) {
    this.element = document.createElement('div');
    this.element.className = 'ny-ai__tray';
    this.list = document.createElement('div');
    this.list.className = 'ny-ai__tray-list';
    this.notice = document.createElement('div');
    this.notice.className = 'ny-ai__tray-notice';
    this.notice.setAttribute('role', 'status');
    this.element.append(this.list, this.notice);
    this.draw();
  }

  get count(): number {
    return this.items.length;
  }

  /** How many more images the message may carry. */
  get room(): number {
    return MAX_IMAGES - this.items.length;
  }

  add(image: ChatImage) {
    if (this.room <= 0) {
      this.full();
      return;
    }
    const url = imageUrl(image);
    const element = document.createElement('div');
    element.className = 'ny-ai__tray-item';
    const thumb = document.createElement('img');
    thumb.className = 'ny-ai-thumb';
    thumb.src = url;
    thumb.alt = image.name;
    thumb.title = `${image.name} · ${image.width}×${image.height}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ny-ai__tray-remove';
    remove.innerHTML = ICONS.close;
    const label = i18next.t('ai.image.remove', { name: image.name });
    remove.title = label;
    remove.setAttribute('aria-label', label);
    const item: Item = { image, url, element };
    remove.addEventListener('click', () => this.remove(item));
    element.append(thumb, remove);
    this.list.append(element);
    this.items.push(item);
    this.told = null;
    this.draw();
    this.changed();
  }

  /** The images, for the message being sent; the tray is empty after. */
  take(): ChatImage[] {
    const images = this.items.map((item) => item.image);
    this.clear();
    return images;
  }

  clear() {
    for (const item of this.items) URL.revokeObjectURL(item.url);
    this.items = [];
    this.list.replaceChildren();
    this.told = null;
    this.draw();
    this.changed();
  }

  /** Says the message can carry no more images. */
  full() {
    this.tell('ai.image.limit', { count: MAX_IMAGES });
  }

  failed(name: string, error: unknown) {
    this.tell('ai.image.failed', { name, reason: reasonOf(error) });
  }

  /** Warns the images may not reach a model not known to see them. */
  setBlind(model: string | null) {
    if (model === this.blind) return;
    this.blind = model;
    this.draw();
  }

  /** Draws the words again, as after the language changed. */
  redraw() {
    for (const item of this.items) {
      const label = i18next.t('ai.image.remove', { name: item.image.name });
      const button = item.element.querySelector('button');
      button?.setAttribute('title', label);
      button?.setAttribute('aria-label', label);
    }
    this.draw();
  }

  private remove(item: Item) {
    URL.revokeObjectURL(item.url);
    item.element.remove();
    this.items = this.items.filter((other) => other !== item);
    this.told = null;
    this.draw();
    this.changed();
  }

  private tell(key: string, options: Record<string, unknown>) {
    this.told = { key, options };
    this.draw();
  }

  private draw() {
    let text = '';
    if (this.told) text = i18next.t(this.told.key, this.told.options);
    else if (this.blind && this.items.length > 0) {
      text = i18next.t('ai.image.noVision', { model: this.blind });
    }
    this.notice.textContent = text;
    this.notice.hidden = !text;
    this.list.hidden = this.items.length === 0;
    this.element.hidden = !text && this.items.length === 0;
  }
}
