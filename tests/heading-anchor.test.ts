import { describe, expect, test } from 'bun:test';
import { anchorIndex, headingSlugs } from '../src/editor/heading-anchor';

describe('headingSlugs', () => {
  test('lower case, punctuation dropped, spaces as hyphens', () => {
    expect(
      headingSlugs(['Hello, World!', '第二节：用法', 'a_b c-d', 'Q&A  time'])
    ).toEqual(['hello-world', '第二节用法', 'a_b-c-d', 'qa--time']);
  });

  test('a name taken gets a number after it', () => {
    expect(headingSlugs(['用法', '用法', 'Intro', '用法-1', '用法'])).toEqual([
      '用法',
      '用法-1',
      'intro',
      '用法-1-1',
      '用法-2',
    ]);
  });
});

describe('anchorIndex', () => {
  const texts = ['概述', 'Getting Started', '概述'];

  test('finds the heading a fragment names', () => {
    expect(anchorIndex(texts, 'getting-started')).toBe(1);
    expect(anchorIndex(texts, '概述-1')).toBe(2);
  });

  test('reads the fragment escaped and in any case', () => {
    expect(anchorIndex(texts, encodeURIComponent('概述'))).toBe(0);
    expect(anchorIndex(texts, 'Getting-Started')).toBe(1);
  });

  test('is -1 for a name no heading has', () => {
    expect(anchorIndex(texts, 'missing')).toBe(-1);
    expect(anchorIndex(texts, '%E0%A4%A')).toBe(-1);
  });
});
