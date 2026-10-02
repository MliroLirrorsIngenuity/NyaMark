import { describe, expect, test } from 'bun:test';
import { openingBox } from '../src/editor/plugins/task-paste';

type Fake = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: Fake[];
  getAttribute: (name: string) => string | null;
};

const text = (value: string): Fake => ({
  nodeType: 3,
  nodeName: '#text',
  textContent: value,
  childNodes: [],
  getAttribute: () => null,
});

const el = (
  name: string,
  attrs: Record<string, string> = {},
  ...children: Fake[]
): Fake => ({
  nodeType: 1,
  nodeName: name,
  textContent: null,
  childNodes: children,
  getAttribute: (key) => attrs[key] ?? null,
});

const box = (attrs: Record<string, string> = {}) =>
  el('INPUT', { type: 'checkbox', ...attrs });
const find = (item: Fake) => openingBox(item as unknown as Node);

describe('openingBox', () => {
  test('finds the box an item opens with', () => {
    const ticked = box({ checked: '' });
    expect(find(el('LI', {}, text('\n'), ticked, text(' 完成')))).toBe(
      ticked as never
    );
    const loose = box();
    expect(find(el('LI', {}, el('P', {}, loose, text(' 未完'))))).toBe(
      loose as never
    );
  });

  test('passes over an item that opens with text or another input', () => {
    expect(find(el('LI', {}, text('先'), box()))).toBeNull();
    expect(find(el('LI', {}, el('INPUT', { type: 'text' })))).toBeNull();
    expect(find(el('LI', {}, el('STRONG', {}, box())))).toBeNull();
    expect(find(el('LI', {}, text('项')))).toBeNull();
  });
});
