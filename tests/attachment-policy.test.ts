import { describe, expect, test } from 'bun:test';
import {
  MARKDOWN_EXTENSIONS,
  classifyLinkTarget,
  extractClipboardFilePaths,
  getDocumentCopyTarget,
  isMarkdownPath,
  relocateLocalReference,
} from '../src/features/attachment-policy';

describe('classifyLinkTarget', () => {
  test.each([
    ['https://example.com/a', { kind: 'url', url: 'https://example.com/a' }],
    ['HTTP://example.com', { kind: 'url', url: 'http://example.com/' }],
    ['//example.com/a', { kind: 'url', url: 'https://example.com/a' }],
    ['mailto:a@b.c', { kind: 'url', url: 'mailto:a@b.c' }],
    ['tel:+123', { kind: 'url', url: 'tel:+123' }],
    ['./assets/img.png', { kind: 'local', reference: './assets/img.png' }],
    ['notes/other.md', { kind: 'local', reference: 'notes/other.md' }],
    ['/abs/path.pdf', { kind: 'local', reference: '/abs/path.pdf' }],
    ['C:\\docs\\a.md', { kind: 'local', reference: 'C:\\docs\\a.md' }],
    ['c:/docs/a.md', { kind: 'local', reference: 'c:/docs/a.md' }],
    [
      '\\\\server\\share\\a.md',
      { kind: 'local', reference: '\\\\server\\share\\a.md' },
    ],
    [
      'file:///tmp/a%20b.md',
      { kind: 'local', reference: 'file:///tmp/a%20b.md' },
    ],
    [
      'file://server/share/a.md',
      { kind: 'local', reference: 'file://server/share/a.md' },
    ],
    ['javascript:alert(1)', { kind: 'ignore' }],
    ['data:text/html,hi', { kind: 'ignore' }],
    ['blob:tauri://localhost/x', { kind: 'ignore' }],
    ['asset://localhost/etc/passwd', { kind: 'ignore' }],
    ['ms-settings:', { kind: 'ignore' }],
    ['foo:bar.md', { kind: 'ignore' }],
    ['   ', { kind: 'ignore' }],
  ] as const)('%s', (href, expected) => {
    expect(classifyLinkTarget(href)).toEqual(expected);
  });
});

describe('isMarkdownPath', () => {
  test('knows every extension the app opens', () => {
    expect(MARKDOWN_EXTENSIONS[0]).toBe('md');
    expect(MARKDOWN_EXTENSIONS).toContain('mdown');
    for (const extension of MARKDOWN_EXTENSIONS) {
      expect(isMarkdownPath(`/docs/a.${extension.toUpperCase()}`)).toBe(true);
    }
  });

  test.each(['/docs/a.png', '/docs/md', '/docs/a.md.txt'])('%s', (path) => {
    expect(isMarkdownPath(path)).toBe(false);
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

  test('keeps what follows the path', () => {
    expect(
      relocateLocalReference(
        'other.md#usage',
        '/docs/notes/one.md',
        '/docs/two.md',
        options
      )
    ).toBe('notes/other.md#usage');
    expect(
      relocateLocalReference(
        'a.png?v=2',
        '/docs/notes/one.md',
        '/docs/two.md',
        options
      )
    ).toBe('notes/a.png?v=2');
    expect(
      relocateLocalReference('#usage', '/docs/one.md', '/x/two.md', options)
    ).toBeNull();
    expect(
      relocateLocalReference('?v=2', '/docs/one.md', '/x/two.md', options)
    ).toBeNull();
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
    '//example.com/a.png',
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
    ).toBe('a/my%20img.png');
  });

  test('turns the old backslash escape into percent-encoding', () => {
    expect(
      relocateLocalReference(
        './my\\ img.png',
        '/docs/a/one.md',
        '/docs/two.md',
        options
      )
    ).toBe('a/my%20img.png');
  });
});

describe('relocateLocalReference with percent-encoding', () => {
  const options = {
    preferRelativePath: true,
    ensureDotSlash: false,
    escapePath: true,
  };

  test('keeps the percent-encoded style', () => {
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

describe('extractClipboardFilePaths', () => {
  const clipboard = (data: Record<string, string>) => ({
    getData: (type: string) => data[type] ?? '',
  });

  test('reads every file URI of a uri-list and skips comments', () => {
    expect(
      extractClipboardFilePaths(
        clipboard({
          'text/uri-list': '# copied\nfile:///tmp/a.png\r\nhttps://x.y/z\n',
        })
      )
    ).toEqual(['/tmp/a.png']);
  });

  test('takes plain text only when it is purely a file list', () => {
    expect(
      extractClipboardFilePaths(
        clipboard({ 'text/plain': 'file:///tmp/a.png\nfile:///tmp/b.png' })
      )
    ).toEqual(['/tmp/a.png', '/tmp/b.png']);
    expect(
      extractClipboardFilePaths(
        clipboard({ 'text/plain': 'See the log at\nfile:///tmp/log.txt' })
      )
    ).toEqual([]);
  });
});

describe('getDocumentCopyTarget', () => {
  const yaml = (source: string) =>
    getDocumentCopyTarget({ kind: 'yaml', source });

  test.each([
    ['a plain value', 'typora-copy-images-to: assets', 'assets'],
    ['a quoted value', 'typora-copy-images-to: "./my pics"', './my pics'],
    ['a value with a comment', 'typora-copy-images-to: img # here', 'img'],
    ['the NyaMark key', 'nyamark-copy-images-to: ../shared', '../shared'],
    [
      'a folded value',
      'title: x\ntypora-copy-images-to: >-\n  long\n  name',
      'long name',
    ],
    ['a key inside another', 'meta:\n  typora-copy-images-to: a', null],
    ['a number', 'typora-copy-images-to: 2024', null],
    ['YAML that does not parse', 'typora-copy-images-to: [a', null],
  ])('reads %s', async (_label, source, expected) => {
    expect(await yaml(source)).toBe(expected);
  });

  test('reads nothing from TOML or no front matter', async () => {
    expect(
      await getDocumentCopyTarget({
        kind: 'toml',
        source: 'typora-copy-images-to = "a"',
      })
    ).toBeNull();
    expect(await getDocumentCopyTarget(null)).toBeNull();
  });
});
