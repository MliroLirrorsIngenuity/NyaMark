import { afterAll, describe, expect, test } from 'bun:test';

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
};
const had = Reflect.get(globalThis, 'localStorage');
Reflect.set(globalThis, 'localStorage', storage);
afterAll(() => {
  if (had === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
  else Reflect.set(globalThis, 'localStorage', had);
});

stored.set(
  'nyamark.mermaidSizes',
  JSON.stringify([['light\ngraph TD; A-->B', [320, 180]]])
);
const { drawnSize, keepDrawnSize } = await import(
  '../src/editor/plugins/mermaid-sizes'
);

describe('diagram sizes', () => {
  test('one drawn at an earlier launch is known', () => {
    expect(drawnSize('light\ngraph TD; A-->B')).toEqual([320, 180]);
    expect(drawnSize('dark\ngraph TD; A-->B')).toBeUndefined();
  });

  test('one drawn now is kept for the next launch', () => {
    keepDrawnSize('dark\ngraph TD; A-->B', 300, 170);
    const saved = JSON.parse(stored.get('nyamark.mermaidSizes') ?? '[]');
    expect(saved).toContainEqual(['dark\ngraph TD; A-->B', [300, 170]]);
    expect(drawnSize('dark\ngraph TD; A-->B')).toEqual([300, 170]);
  });

  test('the sizes of the last two hundred drawn are kept', () => {
    for (let index = 0; index < 200; index += 1) {
      keepDrawnSize(`light\n${index}`, 100, index + 1);
    }
    expect(drawnSize('light\ngraph TD; A-->B')).toBeUndefined();
    expect(drawnSize('light\n0')).toEqual([100, 1]);
    expect(drawnSize('light\n199')).toEqual([100, 200]);
  });
});
