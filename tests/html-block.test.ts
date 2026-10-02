import { describe, expect, test } from 'bun:test';
import { htmlReferencesMapped } from '../src/editor/plugins/html-block';

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
  });

  test('leaves web addresses, anchors and other attributes alone', () => {
    const html =
      '<a href="https://example.com" title="src=x.png">x</a><a href="#top">t</a><div data-src="y.png"></div>';
    expect(htmlReferencesMapped(html, moved)).toBe(html);
  });
});
