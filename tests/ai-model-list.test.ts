import { describe, expect, test } from 'bun:test';
import {
  formatTokens,
  modelFromListing,
  parseTokens,
} from '../src/ui/settings-panel/sections/ai-models';

describe('formatTokens', () => {
  test('shortens whole thousands and millions', () => {
    expect(formatTokens(272_000)).toBe('272K');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(2_000_000)).toBe('2M');
  });

  test('writes any other length in full', () => {
    expect(formatTokens(131_072)).toBe('131,072');
    expect(formatTokens(1_048_576)).toBe('1,048,576');
  });
});

describe('parseTokens', () => {
  test('reads a length as the list shows it or as typed', () => {
    expect(parseTokens('272K')).toBe(272_000);
    expect(parseTokens('272k')).toBe(272_000);
    expect(parseTokens('1.5M')).toBe(1_500_000);
    expect(parseTokens('131,072')).toBe(131_072);
    expect(parseTokens(' 128000 ')).toBe(128_000);
  });

  test('reads back what formatTokens writes', () => {
    for (const value of [8192, 131_072, 272_000, 1_000_000, 1_048_576]) {
      expect(parseTokens(formatTokens(value))).toBe(value);
    }
  });

  test('turns down text that is no length, and lengths out of range', () => {
    expect(parseTokens('')).toBeNull();
    expect(parseTokens('K')).toBeNull();
    expect(parseTokens('abc')).toBeNull();
    expect(parseTokens('12x')).toBeNull();
    expect(parseTokens('100')).toBeNull();
    expect(parseTokens('20M')).toBeNull();
  });
});

describe('modelFromListing', () => {
  test('takes what the service lists over the guess from the ID', () => {
    const model = modelFromListing(
      {
        id: 'gpt-6-sol',
        name: 'GPT-6-Sol',
        contextWindow: 272_000,
        vision: false,
        tools: true,
        reasoning: true,
      },
      false
    );
    expect(model).toMatchObject({
      id: 'gpt-6-sol',
      name: 'GPT-6-Sol',
      contextWindow: 272_000,
      vision: false,
      tools: true,
      reasoning: true,
    });
  });
});
