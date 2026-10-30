import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';

type Watched = { target: Element };

/** The IntersectionObserver the module makes, driven by the test. */
let watcher: {
  watched: Set<Element>;
  report: (
    entries: Array<{ target: Element; isIntersecting: boolean }>
  ) => void;
} | null = null;

class FakeIntersectionObserver {
  readonly watched = new Set<Element>();
  constructor(
    readonly report: (
      entries: Array<{ target: Element; isIntersecting: boolean }>
    ) => void
  ) {
    watcher = this;
  }
  observe(element: Element) {
    this.watched.add(element);
  }
  unobserve(element: Element) {
    this.watched.delete(element);
  }
  disconnect() {
    this.watched.clear();
  }
}

const page = parseHTML('<html><body><div id="doc"></div></body></html>');
const stand = {
  window: globalThis,
  document: page.document,
  IntersectionObserver: FakeIntersectionObserver,
  MutationObserver: page.MutationObserver,
};
const had = Object.fromEntries(
  Object.keys(stand).map((key) => [key, Reflect.get(globalThis, key)])
);
Object.assign(globalThis, stand);
afterAll(() => {
  for (const [key, value] of Object.entries(had)) {
    if (value === undefined) Reflect.deleteProperty(globalThis, key);
    else Reflect.set(globalThis, key, value);
  }
});

const { bindNearScrollers } = await import('../src/ui/near-scrollers');

const container = page.document.getElementById('doc') as unknown as HTMLElement;
const table = () =>
  '<div class="milkdown-table-block"><div><div class="table-wrapper"><table></table></div></div></div>';
const formula = () =>
  '<div class="milkdown-code-block"><div class="preview-panel"><div class="preview"></div></div></div>';
const watched = () => [...(watcher?.watched ?? [])] as Watched['target'][];
const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

let release: (() => void) | null = null;
beforeEach(() => {
  release?.();
  container.innerHTML = '';
});

describe('wide blocks on a phone', () => {
  test('every table and preview in the document is watched', () => {
    container.innerHTML = `<p>text</p>${table()}${formula()}<pre>code</pre>`;
    release = bindNearScrollers(container);
    const classes = watched().map((element) => element.className);
    expect(classes.sort()).toEqual(['preview', 'table-wrapper']);
  });

  test('a block scrolls sideways only while it is near the screen', () => {
    container.innerHTML = table();
    release = bindNearScrollers(container);
    const [wrapper] = watched();
    watcher?.report([{ target: wrapper, isIntersecting: true }]);
    expect(wrapper.classList.contains('ny-scroll-near')).toBe(true);
    watcher?.report([{ target: wrapper, isIntersecting: false }]);
    expect(wrapper.classList.contains('ny-scroll-near')).toBe(false);
  });

  test('blocks added later are watched, and removed ones are let go', async () => {
    container.innerHTML = table();
    release = bindNearScrollers(container);
    const [first] = watched();
    container.innerHTML = formula();
    await settle();
    expect(watched().map((element) => element.className)).toEqual(['preview']);
    expect(watched()).not.toContain(first);
  });
});
