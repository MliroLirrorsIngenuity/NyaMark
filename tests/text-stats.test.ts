import { describe, expect, test } from 'bun:test';
import { countLines, countWords } from '../src/editor/text-stats';

describe('countWords', () => {
  test('counts Latin words between spaces', () => {
    expect(countWords('Hello world, three words.')).toBe(4);
    expect(countWords("don't stop")).toBe(2);
  });

  test('counts each Chinese or Japanese character', () => {
    expect(countWords('中文段落一共十个字。')).toBe(9);
    expect(countWords('ひらがなとカタカナ')).toBe(9);
  });

  test('counts mixed text without spaces between scripts', () => {
    expect(countWords('用 Rust写了3个CLI工具')).toBe(9);
  });

  test('ignores punctuation and empty text', () => {
    expect(countWords('—— … !!')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('countLines', () => {
  test('does not count the final newline as a line', () => {
    expect(countLines('one\n')).toBe(1);
    expect(countLines('one\r\ntwo\r\n')).toBe(2);
    expect(countLines('one\n\nthree')).toBe(3);
  });

  test('an empty document has one line', () => {
    expect(countLines('')).toBe(1);
  });
});
