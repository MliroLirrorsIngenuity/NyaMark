import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import colors from '../src/ui/page-colors.json';

// The window is coloured from page-colors.json till its page is drawn.
test('the window opens in the colour the page opens on', () => {
  const { document } = parseHTML('<!doctype html><html><head></head></html>');
  const style = document.createElement('style');
  style.textContent = readFileSync('src/ui/shell.css', 'utf8');
  document.head.append(style);
  const rules = Array.from(style.sheet?.cssRules ?? []) as CSSStyleRule[];
  const opensOn = (selector: string) =>
    rules
      .find((rule) => rule.selectorText === selector)
      ?.style.getPropertyValue('--ny-app-bg-start');
  const hex = (rgb: number[]) =>
    `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  expect(opensOn(':root')).toBe(hex(colors.light));
  expect(opensOn(':root[data-theme="dark"]')).toBe(hex(colors.dark));
});
