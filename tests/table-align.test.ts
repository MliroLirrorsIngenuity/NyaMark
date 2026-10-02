import { describe, expect, test } from 'bun:test';
import { alignmentFromDOM } from '../src/editor/plugins/table-align';

/** A cell as the parser sees it: its style and its attributes. */
function cell(textAlign: string, align: string | null = null) {
  return {
    style: { textAlign },
    getAttribute: (name: string) => (name === 'align' ? align : null),
  } as unknown as HTMLElement;
}

describe('alignmentFromDOM', () => {
  test('reads the alignment a cell is drawn with', () => {
    expect(alignmentFromDOM(cell('center'))).toBe('center');
    expect(alignmentFromDOM(cell(''))).toBeNull();
  });

  test('reads the align attribute of a page made from Markdown', () => {
    expect(alignmentFromDOM(cell('', 'center'))).toBe('center');
    expect(alignmentFromDOM(cell('', 'RIGHT'))).toBe('right');
    expect(alignmentFromDOM(cell('', 'justify'))).toBeNull();
  });
});
