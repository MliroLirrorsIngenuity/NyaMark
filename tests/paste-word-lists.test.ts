import { describe, expect, test } from 'bun:test';
import {
  isNumberMarker,
  wordListLevel,
} from '../src/editor/plugins/paste-word-lists';

describe('wordListLevel', () => {
  test('reads the level of an item Word wrote', () => {
    expect(wordListLevel('margin-left:36.0pt;mso-list:l0 level2 lfo1')).toBe(2);
    expect(wordListLevel('mso-list: l3 level1 lfo4')).toBe(1);
  });

  test('passes over a paragraph and a bullet', () => {
    expect(wordListLevel('margin:0cm')).toBeNull();
    expect(wordListLevel('mso-list:Ignore')).toBeNull();
    expect(wordListLevel(null)).toBeNull();
  });
});

describe('isNumberMarker', () => {
  test('tells numbers from bullets', () => {
    expect(isNumberMarker('1.   ')).toBe(true);
    expect(isNumberMarker('a)')).toBe(true);
    expect(isNumberMarker('(iv)')).toBe(true);
    expect(isNumberMarker('·  ')).toBe(false);
    expect(isNumberMarker('o')).toBe(false);
    expect(isNumberMarker('§')).toBe(false);
  });
});
