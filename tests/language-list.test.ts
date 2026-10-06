import { afterAll, describe, expect, test } from 'bun:test';
import { type Platform, type Rect, computePosition } from '@floating-ui/dom';
import { parseHTML } from 'linkedom';
import { languageList } from '../src/editor/floating';

const had = Reflect.get(globalThis, 'window');
afterAll(() => {
  if (had === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Reflect.set(globalThis, 'window', had);
});

/** The list's languages at their full height, and the search box over them. */
const LIST = 196;
const CHROME = 50;

/**
 * Where the language list opens for a button at `top` in a window `height`
 * tall, under a format bar `bar` tall: its side, and the room for its
 * languages as it is told it.
 */
async function open(top: number, height: number, bar = 0) {
  Reflect.set(globalThis, 'window', { innerWidth: 900, innerHeight: height });
  const { document } = parseHTML(
    '<div class="milkdown"><div class="milkdown-top-bar"></div>' +
      '<div class="language-picker"><div class="list-wrapper">' +
      '<ul class="language-list"></ul></div></div></div>'
  );
  const topBar = document.querySelector('.milkdown-top-bar');
  const picker = document.querySelector('.language-picker');
  const list = document.querySelector('.language-list');
  if (!topBar || !picker || !list) throw new Error('no picker');
  Object.assign(topBar, {
    getBoundingClientRect: () => ({ top: 0, bottom: bar }),
  });
  Object.defineProperty(picker, 'offsetHeight', { value: LIST + CHROME });
  Object.defineProperty(list, 'offsetHeight', { value: LIST });
  const button: Rect = { x: 700, y: top, width: 60, height: 20 };
  const page = { width: 900, height };
  const platform: Platform = {
    getElementRects: () => ({
      reference: button,
      floating: { x: 0, y: 0, width: 188, height: LIST + CHROME },
    }),
    getDimensions: () => ({ width: 188, height: LIST + CHROME }),
    getClippingRect: ({ rootBoundary }) =>
      rootBoundary === 'viewport' || rootBoundary === 'document'
        ? { x: 0, y: 0, ...page }
        : rootBoundary,
  };
  const { placement } = await computePosition(button as never, picker, {
    ...languageList,
    platform,
  });
  const room = (list as HTMLElement).style.getPropertyValue(
    '--ny-language-list-room'
  );
  return {
    placement,
    above: list.hasAttribute('data-ny-above'),
    room: Number.parseInt(room, 10),
  };
}

describe("a code block's language list", () => {
  test('opens under its button where it fits', async () => {
    const at = await open(100, 700);
    expect(at.placement).toBe('bottom-end');
    expect(at.above).toBe(false);
    expect(at.room).toBe(700 - 8 - (120 + 6) - CHROME);
  });

  test('opens over it near the foot of the window', async () => {
    const at = await open(500, 700);
    expect(at.placement).toBe('top-end');
    expect(at.above).toBe(true);
    expect(at.room).toBe(500 - 6 - 8 - CHROME);
  });

  test('takes the side with more room where neither has enough', async () => {
    const at = await open(140, 340);
    expect(at.placement).toBe('bottom-end');
    expect(at.room).toBe(340 - 8 - (160 + 6) - CHROME);
  });

  test('counts the room over it from under the format bar', async () => {
    expect((await open(480, 700)).placement).toBe('top-end');
    expect((await open(480, 700, 300)).placement).toBe('bottom-end');
  });

  test('is never too short to use', async () => {
    const at = await open(50, 130);
    expect(at.room).toBe(88);
  });
});
