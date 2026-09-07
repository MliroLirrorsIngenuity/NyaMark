import { describe, expect, test } from 'bun:test';
import {
  classifyLinkTarget,
  relocateLocalReference,
} from '../src/features/attachment-policy';

describe('classifyLinkTarget', () => {
  test.each([
    ['https://example.com/a', { kind: 'url', url: 'https://example.com/a' }],
    ['HTTP://example.com', { kind: 'url', url: 'HTTP://example.com' }],
    ['mailto:a@b.c', { kind: 'url', url: 'mailto:a@b.c' }],
    ['tel:+123', { kind: 'url', url: 'tel:+123' }],
    ['./assets/img.png', { kind: 'local', reference: './assets/img.png' }],
    ['notes/other.md', { kind: 'local', reference: 'notes/other.md' }],
    ['/abs/path.pdf', { kind: 'local', reference: '/abs/path.pdf' }],
    ['C:\\docs\\a.md', { kind: 'local', reference: 'C:\\docs\\a.md' }],
    ['file:///tmp/a%20b.md', { kind: 'local', reference: '/tmp/a b.md' }],
    ['file:///C:/x/y.md', { kind: 'local', reference: 'C:/x/y.md' }],
    ['file://localhost/tmp/a.md', { kind: 'local', reference: '/tmp/a.md' }],
    [
      'file://server/share/a.md',
      { kind: 'local', reference: '//server/share/a.md' },
    ],
    ['javascript:alert(1)', { kind: 'ignore' }],
    ['data:text/html,hi', { kind: 'ignore' }],
    ['blob:tauri://localhost/x', { kind: 'ignore' }],
    ['asset://localhost/etc/passwd', { kind: 'ignore' }],
    ['ms-settings:', { kind: 'ignore' }],
    ['   ', { kind: 'ignore' }],
  ] as const)('%s', (href, expected) => {
    expect(classifyLinkTarget(href)).toEqual(expected);
  });
});

describe('relocateLocalReference', () => {
  const options = {
    preferRelativePath: true,
    ensureDotSlash: false,
    escapePath: false,
  };

  test('re-anchors a relative reference at the new directory', () => {
    expect(
      relocateLocalReference(
        './assets/a.png',
        '/docs/notes/one.md',
        '/docs/two.md',
        options
      )
    ).toBe('notes/assets/a.png');
    expect(
      relocateLocalReference(
        '../shared/b.png',
        '/docs/notes/one.md',
        '/docs/deep/er/two.md',
        options
      )
    ).toBe('../../shared/b.png');
  });

  test('keeps a relative reference relative even when settings prefer absolute', () => {
    expect(
      relocateLocalReference('img.png', '/docs/one.md', '/docs/sub/two.md', {
        ...options,
        preferRelativePath: false,
      })
    ).toBe('../img.png');
  });

  test('turns an absolute reference relative on the first save', () => {
    expect(
      relocateLocalReference(
        '/docs/assets/a.png',
        null,
        '/docs/one.md',
        options
      )
    ).toBe('assets/a.png');
    expect(
      relocateLocalReference('/docs/assets/a.png', null, '/docs/one.md', {
        ...options,
        ensureDotSlash: true,
      })
    ).toBe('./assets/a.png');
  });

  test('leaves an absolute reference alone when settings prefer absolute', () => {
    expect(
      relocateLocalReference('/docs/assets/a.png', null, '/docs/one.md', {
        ...options,
        preferRelativePath: false,
      })
    ).toBeNull();
  });

  test('falls back to absolute across drives', () => {
    expect(
      relocateLocalReference('img.png', 'C:/docs/one.md', 'D:/two.md', options)
    ).toBe('C:/docs/img.png');
  });

  test('returns null when nothing changes or nothing can be resolved', () => {
    expect(
      relocateLocalReference('img.png', '/docs/one.md', '/docs/two.md', options)
    ).toBeNull();
    expect(
      relocateLocalReference('img.png', null, '/docs/two.md', options)
    ).toBeNull();
  });

  test.each([
    '#heading',
    '?query=1',
    'https://example.com/a.png',
    'mailto:a@b.c',
    'data:image/png;base64,AAAA',
    'file:///docs/a.png',
    'javascript:alert(1)',
    '',
  ])('ignores %s', (reference) => {
    expect(
      relocateLocalReference(reference, '/docs/one.md', '/x/two.md', options)
    ).toBeNull();
  });

  test('escapes spaces when asked', () => {
    expect(
      relocateLocalReference('./my img.png', '/docs/a/one.md', '/docs/two.md', {
        ...options,
        escapePath: true,
      })
    ).toBe('a/my\\ img.png');
  });
});

describe('relocateLocalReference with percent-encoding', () => {
  const options = {
    preferRelativePath: true,
    ensureDotSlash: false,
    escapePath: true,
  };

  test('keeps the percent-encoded style instead of backslash escapes', () => {
    expect(
      relocateLocalReference(
        './My%20Image.png',
        '/docs/note.md',
        '/docs/sub/note.md',
        options
      )
    ).toBe('../My%20Image.png');
  });

  test('returns null when the encoded reference still fits', () => {
    expect(
      relocateLocalReference(
        'My%20Image.png',
        '/docs/note.md',
        '/docs/copy.md',
        options
      )
    ).toBeNull();
  });
});
