import { describe, expect, test } from 'bun:test';
import { buildInstructions } from '../src/ai/agent/instructions';
import { chatMarkdownHtml, isOpenableLink } from '../src/ai/render/markdown';

describe('chatMarkdownHtml', () => {
  test('shows raw HTML in a reply as text', () => {
    const html = chatMarkdownHtml('Hi <img src=x onerror=alert(1)> there');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('renders GitHub tables, task lists and strikethrough', () => {
    const html = chatMarkdownHtml(
      '| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~'
    );
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<del>gone</del>');
  });

  test('renders math with KaTeX', () => {
    expect(chatMarkdownHtml('$x^2$')).toContain('katex');
    expect(chatMarkdownHtml('$$\n\\frac{a}{b}\n$$')).toContain('katex-display');
  });

  test('copes with a reply cut off mid-construct', () => {
    expect(chatMarkdownHtml('```js\nconst a = 1')).toContain('<pre><code');
    expect(chatMarkdownHtml('$$\n\\frac{')).toBeString();
  });
});

describe('isOpenableLink', () => {
  test('lets web and mail links leave the app', () => {
    expect(isOpenableLink('https://example.com')).toBe(true);
    expect(isOpenableLink('HTTP://example.com')).toBe(true);
    expect(isOpenableLink('mailto:a@b.c')).toBe(true);
    expect(isOpenableLink('file:///etc/passwd')).toBe(false);
    expect(isOpenableLink('javascript:alert(1)')).toBe(false);
    expect(isOpenableLink('#section')).toBe(false);
  });
});

describe('buildInstructions', () => {
  const today = new Date(2026, 9, 5);

  test('names the open document and the date', () => {
    const text = buildInstructions({
      documentPath: '/Users/me/notes/draft.md',
      custom: '',
      today,
    });
    expect(text).toContain('"draft.md" at /Users/me/notes/draft.md');
    expect(text).toContain('Today is 2026-10-05.');
    expect(text).not.toContain('<user-instructions>');
  });

  test('says an unsaved document has no name', () => {
    const text = buildInstructions({ documentPath: null, custom: '', today });
    expect(text).toContain('has not been saved yet');
  });

  test('takes a Windows path apart too', () => {
    const text = buildInstructions({
      documentPath: 'C:\\Notes\\plan.md',
      custom: '',
      today,
    });
    expect(text).toContain('"plan.md"');
  });

  test('keeps the user’s standing instructions', () => {
    const text = buildInstructions({
      documentPath: null,
      custom: '  Use British spelling.  ',
      today,
    });
    expect(text).toContain(
      '<user-instructions>\nUse British spelling.\n</user-instructions>'
    );
  });
});
