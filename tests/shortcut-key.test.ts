import { describe, expect, test } from 'bun:test';
import { shortcutKey } from '../src/features/shortcut-controller';

const press = (key: string, code: string) =>
  shortcutKey({ key, code } as KeyboardEvent);

describe('shortcutKey', () => {
  test('reads the letter the layout puts on the key', () => {
    // Dvorak: the F is where QWERTY has Y, and QWERTY's F types U.
    expect(press('f', 'KeyY')).toBe('KeyF');
    expect(press('u', 'KeyF')).toBe('KeyU');
    expect(press('O', 'KeyS')).toBe('KeyO');
  });

  test('reads the comma wherever the layout puts it', () => {
    expect(press(',', 'KeyM')).toBe('Comma');
  });

  test('falls back to the QWERTY place under another script', () => {
    expect(press('а', 'KeyF')).toBe('KeyF');
  });
});
