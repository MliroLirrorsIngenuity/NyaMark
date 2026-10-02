import { describe, expect, test } from 'bun:test';
import { languageListRoom } from '../src/editor/plugins/language-picker-room';

const page = { top: 0, bottom: 700 };
const button = (top: number) => ({ top, bottom: top + 20 });

describe("a code block's language list", () => {
  test('opens under its button where it fits', () => {
    expect(languageListRoom(button(100), page, 50)).toEqual({
      up: false,
      height: 196,
    });
  });

  test('opens over it near the foot of the page', () => {
    expect(languageListRoom(button(500), page, 50)).toEqual({
      up: true,
      height: 196,
    });
  });

  test('is shorter where neither side has the room', () => {
    const short = { top: 0, bottom: 340 };
    expect(languageListRoom(button(140), short, 50)).toEqual({
      up: false,
      height: 340 - 160 - 4 - 8 - 50,
    });
  });

  test('is never too short to use', () => {
    const tiny = { top: 0, bottom: 120 };
    expect(languageListRoom(button(50), tiny, 50).height).toBe(88);
  });
});
