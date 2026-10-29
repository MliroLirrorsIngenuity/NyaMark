import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { Composer } from '../src/ai/ui/composer';
import { DockedPanel } from '../src/ui/dock';
import { isModalOpen, openModal } from '../src/ui/modal';
import { bindViewport } from '../src/ui/viewport';

class IdleObserver {
  observe() {}
  disconnect() {}
}

let compact = true;
let DomEvent: typeof Event;
let media: EventTarget & { matches: boolean };
let viewport: EventTarget & {
  height: number;
  offsetTop: number;
  scale: number;
};
let browser: EventTarget & { innerHeight: number; innerWidth: number };
const cleanups: Array<() => void> = [];
let frames: Array<() => void> = [];

function nextFrame() {
  const due = frames;
  frames = [];
  for (const run of due) run();
}

beforeEach(() => {
  const page = parseHTML(
    '<html><body><main id="ny-app"><button id="trigger">Tools</button></main></body></html>'
  );
  compact = true;
  DomEvent = page.window.Event;
  media = Object.assign(new EventTarget(), { matches: true });
  viewport = Object.assign(new EventTarget(), {
    height: 844,
    offsetTop: 0,
    scale: 1,
  });
  browser = Object.assign(new EventTarget(), {
    __NYAMARK_PLATFORM__: 'ios',
    innerHeight: 844,
    innerWidth: 390,
    visualViewport: viewport,
    matchMedia: () => Object.assign(media, { matches: compact }),
  });
  frames = [];
  Object.assign(globalThis, {
    requestAnimationFrame: (run: () => void) => frames.push(run),
    window: browser,
    document: page.document,
    HTMLElement: page.window.HTMLElement,
    HTMLInputElement: page.window.HTMLInputElement,
    Node: page.window.Node,
    ResizeObserver: IdleObserver,
    MutationObserver: IdleObserver,
  });
  page.window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 0 }) as DOMRect;
  page.window.HTMLElement.prototype.focus = function () {
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      value: this,
    });
  };
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('the visible mobile viewport', () => {
  test('shows document tools only while editing the document', () => {
    (document.getElementById('ny-app') as HTMLElement).innerHTML =
      '<div id="ny-editor-container"><div class="ProseMirror" contenteditable="true"></div></div><input id="settings-field">';
    bindViewport();
    document.querySelector<HTMLElement>('.ProseMirror')?.focus();
    document.dispatchEvent(new DomEvent('focusin'));
    expect(
      document.documentElement.classList.contains('ny-document-editing')
    ).toBe(true);
    document.getElementById('settings-field')?.focus();
    document.dispatchEvent(new DomEvent('focusin'));
    expect(
      document.documentElement.classList.contains('ny-document-editing')
    ).toBe(false);
  });

  test('follows the software keyboard and its viewport offset', () => {
    bindViewport();
    viewport.height = 440;
    viewport.offsetTop = 24;
    viewport.dispatchEvent(new Event('resize'));
    nextFrame();
    expect(
      document.documentElement.style.getPropertyValue('--ny-viewport-height')
    ).toBe('440px');
    expect(
      document.documentElement.style.getPropertyValue('--ny-viewport-top')
    ).toBe('24px');
    expect(
      document.documentElement.classList.contains('ny-keyboard-open')
    ).toBe(true);
    viewport.height = 844;
    viewport.dispatchEvent(new Event('resize'));
    nextFrame();
    expect(
      document.documentElement.classList.contains('ny-keyboard-open')
    ).toBe(false);
  });

  test('also recognizes keyboards that resize the layout viewport', () => {
    bindViewport();
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    browser.innerHeight = viewport.height = 440;
    browser.dispatchEvent(new Event('resize'));
    nextFrame();
    expect(
      document.documentElement.classList.contains('ny-keyboard-open')
    ).toBe(true);
  });

  test('does not treat rotation as a keyboard opening', () => {
    bindViewport();
    browser.innerWidth = 844;
    browser.innerHeight = viewport.height = 390;
    browser.dispatchEvent(new Event('resize'));
    nextFrame();
    expect(
      document.documentElement.classList.contains('ny-keyboard-open')
    ).toBe(false);
  });

  test('leaves pinch zoom alone', () => {
    bindViewport();
    viewport.scale = 2;
    viewport.height = 422;
    viewport.dispatchEvent(new Event('resize'));
    nextFrame();
    expect(
      document.documentElement.style.getPropertyValue('--ny-viewport-height')
    ).toBe('844px');
  });

  test('moves with the keyboard once a frame however many events come', () => {
    bindViewport();
    for (const offset of [10, 20, 30]) {
      viewport.offsetTop = offset;
      viewport.dispatchEvent(new Event('scroll'));
    }
    expect(frames.length).toBe(1);
    nextFrame();
    expect(
      document.documentElement.style.getPropertyValue('--ny-viewport-top')
    ).toBe('30px');
  });
});

function composer() {
  const sent: string[] = [];
  const composer = new Composer({
    send: (text) => sent.push(text),
    stop() {},
    leave() {},
    attach() {},
    paste() {},
  });
  document.body.append(composer.element);
  const input = composer.element.querySelector(
    'textarea'
  ) as HTMLTextAreaElement;
  input.value = 'A draft';
  input.dispatchEvent(new DomEvent('input'));
  return { composer, input, sent };
}

function enter(input: HTMLElement, modifiers = {}) {
  const event = Object.assign(new DomEvent('keydown', { cancelable: true }), {
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...modifiers,
  });
  input.dispatchEvent(event);
  return event;
}

describe('writing to the assistant on mobile', () => {
  test('Enter starts a line instead of sending an unfinished message', () => {
    const { input, sent } = composer();
    expect(enter(input).defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
    expect(input.value).toBe('A draft');
  });

  test('the send button still sends', () => {
    const { composer: view, sent } = composer();
    (view.element.querySelector('.ny-ai__send') as HTMLElement).click();
    expect(sent).toEqual(['A draft']);
  });

  test('a hardware keyboard can send with the primary modifier', () => {
    const { input, sent } = composer();
    expect(enter(input, { metaKey: true }).defaultPrevented).toBe(true);
    expect(sent).toEqual(['A draft']);
  });

  test('desktop Enter keeps sending, but composition never sends', () => {
    compact = false;
    const { input, sent } = composer();
    enter(input, { isComposing: true });
    expect(sent).toEqual([]);
    enter(input);
    expect(sent).toEqual(['A draft']);
  });
});

function dock(name: string) {
  const card = document.createElement('aside');
  card.className = 'ny-dock';
  card.hidden = true;
  document.body.append(card);
  const dock = new DockedPanel(
    card,
    name,
    () => null,
    () => dock.setOpen(false),
    document.getElementById('trigger')
  );
  cleanups.push(() => dock.destroy());
  return { card, dock };
}

describe('mobile sheets and desktop docks', () => {
  test('mobile opens one modal sheet without focusing a text field', () => {
    const { card, dock: panel } = dock('ny-outline-open');
    panel.setOpen(true);
    expect(card.hidden).toBe(false);
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(card);
    expect(document.getElementById('ny-app')?.inert).toBe(true);
    panel.setOpen(false);
    expect(isModalOpen()).toBe(false);
    expect(document.getElementById('ny-app')?.inert).toBe(false);
    expect(document.activeElement?.id).toBe('trigger');
  });

  test('opening another sheet releases the first', async () => {
    const first = dock('ny-outline-open');
    const second = dock('ny-ai-open');
    first.dock.setOpen(true);
    second.dock.setOpen(true);
    await Promise.resolve();
    expect(first.card.hidden).toBe(true);
    expect(second.card.hidden).toBe(false);
    expect(document.querySelectorAll('.ny-dock-backdrop').length).toBe(1);
    expect(document.getElementById('ny-app')?.inert).toBe(true);
  });

  test('desktop allows two docks without blocking the document', () => {
    compact = false;
    const first = dock('ny-outline-open');
    const second = dock('ny-ai-open');
    first.dock.setOpen(true);
    second.dock.setOpen(true);
    expect(first.card.hidden).toBe(false);
    expect(second.card.hidden).toBe(false);
    expect(isModalOpen()).toBe(false);
    expect(document.querySelector('.ny-dock-backdrop')).toBeNull();
  });

  test('rotation never places a dock over an existing dialog', () => {
    compact = false;
    const { dock: panel } = dock('ny-ai-open');
    panel.setOpen(true);
    const overlay = document.createElement('div');
    const dialog = document.createElement('div');
    overlay.append(dialog);
    document.body.append(overlay);
    const modal = openModal({
      overlay,
      dialog,
      initialFocus: dialog,
      onDismiss() {},
    });
    cleanups.push(() => modal.release());
    compact = media.matches = true;
    media.dispatchEvent(new Event('change'));
    expect(document.querySelector('.ny-dock-backdrop')).toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  test('rotation to a desktop layout releases modal focus and the backdrop', () => {
    const { card, dock: panel } = dock('ny-ai-open');
    panel.setOpen(true);
    compact = media.matches = false;
    media.dispatchEvent(new Event('change'));
    expect(card.hidden).toBe(false);
    expect(card.hasAttribute('aria-modal')).toBe(false);
    expect(isModalOpen()).toBe(false);
    expect(document.getElementById('ny-app')?.inert).toBe(false);
  });
});
