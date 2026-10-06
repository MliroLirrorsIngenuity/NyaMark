import { describe, expect, test } from 'bun:test';
import { htmlReferencesMapped } from '../src/editor/html-references';

const moved = (reference: string) =>
  /^[a-z]+:|^#/i.test(reference) ? null : `../notes/${reference}`;

describe('htmlReferencesMapped', () => {
  test('moves the image and link addresses beside the document', () => {
    expect(
      htmlReferencesMapped(
        '<p align="center"><img width="120" src="img/logo.png"></p>',
        moved
      )
    ).toBe(
      '<p align="center"><img width="120" src="../notes/img/logo.png"></p>'
    );
    expect(
      htmlReferencesMapped("<a href='docs/a.md'>A</a> <img src=b.png>", moved)
    ).toBe(`<a href='../notes/docs/a.md'>A</a> <img src="../notes/b.png">`);
    expect(
      htmlReferencesMapped(
        '<video poster="p.jpg" src="v.mp4"></video><audio src="a.mp3"></audio>',
        moved
      )
    ).toBe(
      '<video poster="../notes/p.jpg" src="../notes/v.mp4"></video><audio src="../notes/a.mp3"></audio>'
    );
  });

  test('reads a tag past a `>` in the text of an attribute', () => {
    expect(
      htmlReferencesMapped('<img alt="a > b" src="img/x.png">', moved)
    ).toBe('<img alt="a > b" src="../notes/img/x.png">');
  });

  test('leaves web addresses, anchors and other attributes alone', () => {
    const html =
      '<a href="https://example.com" title="src=x.png">x</a><a href="#top">t</a><div data-src="y.png"></div><img title=" src=x.png">';
    expect(htmlReferencesMapped(html, moved)).toBe(html);
  });

  test('leaves what is no tag alone', () => {
    const html =
      '<!-- <img src="a.png"> --><script>"<img src=b.png>"</script><code>&lt;img src="c.png"&gt;</code>';
    expect(htmlReferencesMapped(html, moved)).toBe(html);
  });

  test('keeps the rest of a tag as written', () => {
    expect(
      htmlReferencesMapped('<IMG  SRC = "x.png"\n  ALT=\'é\'/>', moved)
    ).toBe('<IMG  SRC="../notes/x.png"\n  ALT=\'é\'/>');
  });

  test('reads an address as the browser does, references and all', () => {
    expect(htmlReferencesMapped('<a href="a&amp;b.md">x</a>', moved)).toBe(
      '<a href="../notes/a&amp;b.md">x</a>'
    );
    expect(htmlReferencesMapped(`<a href='it&apos;s.md'>x</a>`, moved)).toBe(
      `<a href='../notes/it&apos;s.md'>x</a>`
    );
  });

  test('moves the first of an attribute written twice', () => {
    expect(htmlReferencesMapped('<img src="a.png" src="b.png">', moved)).toBe(
      '<img src="../notes/a.png" src="b.png">'
    );
  });

  test('moves each image of a srcset', () => {
    expect(
      htmlReferencesMapped(
        '<img srcset="a.png 1x,\n  b.png 2x" src="a.png">',
        moved
      )
    ).toBe(
      '<img srcset="../notes/a.png 1x, ../notes/b.png 2x" src="../notes/a.png">'
    );
    expect(
      htmlReferencesMapped(
        '<picture><source srcset="s.webp 480w, https://a.com/l.webp 1080w"></picture>',
        moved
      )
    ).toBe(
      '<picture><source srcset="../notes/s.webp 480w, https://a.com/l.webp 1080w"></picture>'
    );
  });

  test('leaves a srcset that has nothing to move, or no list to move it into', () => {
    const remote =
      '<img srcset="https://a.com/a.png 1x, https://a.com/b.png 2x">';
    expect(htmlReferencesMapped(remote, moved)).toBe(remote);
    const spaced = '<img srcset="a.png 1x">';
    expect(htmlReferencesMapped(spaced, () => 'my image.png')).toBe(spaced);
  });
});
