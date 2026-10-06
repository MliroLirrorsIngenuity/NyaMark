import { describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { pageText } from '../src/ai/web/page';

const parse = (html: string) => parseHTML(html).document as unknown as Document;

const html = (url: string, text: string) =>
  pageText({ url, contentType: 'text/html; charset=utf-8', text }, parse);

const WORDS =
  'Markdown keeps writing plain, so the same notes read well in any editor and in version control alike. ';

const ARTICLE = `<!doctype html>
<html>
<head><title>Writing in Markdown | Example</title><script>track()</script></head>
<body>
  <nav><a href="/">Home</a> <a href="/blog">Blog</a></nav>
  <article>
    <h1>Writing in Markdown</h1>
    <p>${WORDS.repeat(4)}</p>
    <p>Start with <a href="docs/guide">the guide</a> or <a href="javascript:alert(1)">this</a>.</p>
    <img src="data:image/png;base64,AAAA" alt="pixel">
    <img src="/img/shot.png" alt="Screenshot">
    <table>
      <tr><th>Name</th><th>Use</th></tr>
      <tr><td>Heading</td><td># Title</td></tr>
      <tr><td>Pipe</td><td>a | b</td></tr>
    </table>
    <p>${WORDS.repeat(3)}</p>
  </article>
  <footer>© Example</footer>
  <script>more()</script>
</body>
</html>`;

describe('a fetched page as the assistant reads it', () => {
  test('reads an article as Markdown with its links made whole', () => {
    const page = html('https://example.com/blog/post', ARTICLE);
    expect(page.title).toContain('Writing in Markdown');
    expect(page.text).toContain('Markdown keeps writing plain');
    expect(page.text).toContain(
      '[the guide](https://example.com/blog/docs/guide)'
    );
    expect(page.text).toContain(
      '![Screenshot](https://example.com/img/shot.png)'
    );
    expect(page.text).not.toContain('javascript:');
    expect(page.text).not.toContain('data:image');
    expect(page.text).not.toContain('track()');
    expect(page.text).not.toContain('Blog');
    expect(page.text).not.toContain('© Example');
  });

  test('turns tables into pipe tables', () => {
    const { text } = html('https://example.com/', ARTICLE);
    expect(text).toContain(
      '| Name | Use |\n| --- | --- |\n| Heading | \\# Title |\n| Pipe | a \\| b |'
    );
  });

  test('reads a page with no article whole, without its scripts and menus', () => {
    const page = html(
      'https://example.com/',
      '<html><head><title> Short </title></head><body><nav>Menu</nav><p>Just a <b>short</b> note.</p><script>x()</script></body></html>'
    );
    expect(page).toEqual({ title: 'Short', text: 'Just a **short** note.' });
  });

  test('keeps line breaks and the blank lines in code', () => {
    const { text } = html(
      'https://example.com/',
      '<html><body><p>Roses are red,<br>violets are blue.</p><pre><code>a\n\n\n\nb</code></pre></body></html>'
    );
    expect(text).toBe(
      'Roses are red,  \nviolets are blue.\n\n```\na\n\n\n\nb\n```'
    );
  });

  test('gives JSON pretty-printed, and text as it came', () => {
    expect(
      pageText(
        {
          url: 'https://api.example.com/',
          contentType: 'application/json',
          text: '{"a":[1,2]}',
        },
        parse
      )
    ).toEqual({
      title: '',
      text: '```json\n{\n  "a": [\n    1,\n    2\n  ]\n}\n```',
    });
    expect(
      pageText(
        {
          url: 'https://example.com/a.txt',
          contentType: 'text/plain',
          text: '  plain *text*\n',
        },
        parse
      )
    ).toEqual({ title: '', text: 'plain *text*' });
  });

  test('reads HTML sent as plain text as HTML', () => {
    const page = pageText(
      {
        url: 'https://example.com/',
        contentType: 'text/plain',
        text: '<!DOCTYPE html><html><head><title>T</title></head><body><p>Hello</p></body></html>',
      },
      parse
    );
    expect(page).toEqual({ title: 'T', text: 'Hello' });
  });
});
