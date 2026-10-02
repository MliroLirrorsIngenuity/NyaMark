import { describe, expect, test } from 'bun:test';
import { menuRoom } from '../src/editor/plugins/slash-menu-room';

const page = { top: 93, bottom: 689 };

describe('menuRoom', () => {
  test('takes the room under a line near the top', () => {
    expect(menuRoom({ top: 220, bottom: 240 }, page)).toBe(689 - 240 - 18);
  });

  test('takes the room over a line near the foot', () => {
    expect(menuRoom({ top: 600, bottom: 620 }, page)).toBe(600 - 93 - 18);
  });

  test('keeps a usable height when there is little room either side', () => {
    expect(menuRoom({ top: 180, bottom: 200 }, { top: 93, bottom: 300 })).toBe(
      160
    );
  });
});
