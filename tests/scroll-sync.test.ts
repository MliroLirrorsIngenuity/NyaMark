import { describe, expect, test } from 'bun:test';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  buildScrollGuidePoints,
  headingKey,
  mapScrollTop,
  syncedScrollTop,
} from '../src/editor/scroll-sync';

const reader = unified().use(remarkParse).use(remarkGfm);
const parse = (markdown: string) => reader.parse(markdown);

describe('headingKey', () => {
  test('gives a source heading and its rendering the same key', () => {
    expect(
      headingKey(
        parse(
          '## Install **`nyamark`** [here](https://x.y "t") \\* &amp; ![logo](a.png) <b>now</b>  ##'
        )
      )
    ).toBe(headingKey('Install nyamark here * &  now'));
  });

  test('keys a setext heading by its text', () => {
    expect(headingKey(parse('Overview\n========'))).toBe('overview');
  });
});

describe('buildScrollGuidePoints', () => {
  test('pins every heading found on both sides', () => {
    const points = buildScrollGuidePoints(
      [
        { key: 'a', top: 100 },
        { key: 'b', top: 300 },
      ],
      [
        { key: 'a', top: 150 },
        { key: 'b', top: 500 },
      ],
      1000,
      2000
    );

    expect(points).toEqual([
      { fromTop: 0, toTop: 0 },
      { fromTop: 100, toTop: 150 },
      { fromTop: 300, toTop: 500 },
      { fromTop: 1000, toTop: 2000 },
    ]);
  });

  test('skips a heading missing on the other side', () => {
    const points = buildScrollGuidePoints(
      [
        { key: 'a', top: 100 },
        { key: 'draft', top: 200 },
        { key: 'b', top: 300 },
      ],
      [
        { key: 'a', top: 150 },
        { key: 'b', top: 500 },
      ],
      1000,
      2000
    );

    expect(points.map((point) => point.fromTop)).toEqual([0, 100, 300, 1000]);
  });

  test('matches repeated headings in order', () => {
    const points = buildScrollGuidePoints(
      [
        { key: 'example', top: 100 },
        { key: 'example', top: 300 },
      ],
      [
        { key: 'example', top: 150 },
        { key: 'example', top: 450 },
      ],
      1000,
      1000
    );

    expect(points.slice(1, 3)).toEqual([
      { fromTop: 100, toTop: 150 },
      { fromTop: 300, toTop: 450 },
    ]);
  });

  test('keeps the target positions moving forward', () => {
    const points = buildScrollGuidePoints(
      [
        { key: 'b', top: 100 },
        { key: 'a', top: 200 },
      ],
      [
        { key: 'a', top: 150 },
        { key: 'b', top: 300 },
      ],
      1000,
      1000
    );

    const targets = points.map((point) => point.toTop);
    expect(targets).toEqual([...targets].sort((a, b) => a - b));
    expect(points).toContainEqual({ fromTop: 100, toTop: 300 });
  });

  test('pairs headings by position when no key matches', () => {
    const points = buildScrollGuidePoints(
      [
        { key: 'renamed', top: 100 },
        { key: 'also renamed', top: 200 },
      ],
      [
        { key: 'a', top: 150 },
        { key: 'b', top: 400 },
      ],
      1000,
      2000
    );

    expect(points.slice(1, 3)).toEqual([
      { fromTop: 100, toTop: 150 },
      { fromTop: 200, toTop: 400 },
    ]);
  });

  test('leaves out an anchor that only fits at the end', () => {
    const points = buildScrollGuidePoints(
      [{ key: 'a', top: 5000 }],
      [{ key: 'a', top: 500 }],
      1000,
      2000
    );

    expect(points).toEqual([
      { fromTop: 0, toTop: 0 },
      { fromTop: 1000, toTop: 2000 },
    ]);
  });

  test('stays at the top when either pane cannot scroll', () => {
    expect(
      buildScrollGuidePoints([{ key: 'a', top: 100 }], [], 0, 2000)
    ).toEqual([{ fromTop: 0, toTop: 0 }]);
  });
});

describe('mapScrollTop', () => {
  const points = [
    { fromTop: 0, toTop: 0 },
    { fromTop: 100, toTop: 300 },
    { fromTop: 200, toTop: 400 },
  ];

  test('interpolates between guide points', () => {
    expect(mapScrollTop(50, points)).toBe(150);
    expect(mapScrollTop(100, points)).toBe(300);
    expect(mapScrollTop(150, points)).toBe(350);
  });

  test('clamps outside the guide', () => {
    expect(mapScrollTop(-20, points)).toBe(0);
    expect(mapScrollTop(900, points)).toBe(400);
  });
});

describe('syncedScrollTop', () => {
  const pane = (scrollTop: number, scrollHeight: number) => ({
    scrollTop,
    scrollHeight,
    clientHeight: 100,
  });
  const heading = (top: number) => [{ key: 'a', top }];

  test('reaches the top and the bottom together', () => {
    const follow = (scrollTop: number) =>
      syncedScrollTop(
        pane(scrollTop, 1000),
        pane(0, 3000),
        heading(400),
        heading(2000)
      );

    expect(follow(0)).toBe(0);
    expect(follow(900)).toBe(2900);
  });

  test('lines a shared heading up in both panes', () => {
    // 28 px down a 100 px viewport in both panes.
    expect(
      syncedScrollTop(
        pane(372, 1000),
        pane(0, 3000),
        heading(400),
        heading(2000)
      )
    ).toBe(1972);
  });

  test('keeps panes of the same layout at the same position', () => {
    expect(
      syncedScrollTop(
        pane(400, 1000),
        pane(0, 1000),
        heading(500),
        heading(500)
      )
    ).toBe(400);
  });

  test('a heading too close to the end does not hold the other pane back', () => {
    expect(
      syncedScrollTop(
        pane(900, 1000),
        pane(0, 3000),
        heading(990),
        heading(1000)
      )
    ).toBe(2900);
  });
});
