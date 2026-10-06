import { expect, test } from 'bun:test';
import { systemLanguage } from '../src/i18n';
import cases from './system-languages.json';

test('a system language reads in the locale of its language and script', () => {
  for (const [languages, locale] of cases as [string[], string | null][]) {
    expect([languages, systemLanguage(languages)]).toEqual([languages, locale]);
  }
});
