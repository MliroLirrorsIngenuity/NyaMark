import { describe, expect, test } from 'bun:test';
import {
  dirnamePath,
  formatAttachmentReference,
  normalizePath,
  resolveAttachmentPath,
  resolveStorageDir,
  sanitizeFileName,
} from '../src/features/attachment-paths';

describe('formatAttachmentReference', () => {
  const options = {
    preferRelativePath: true,
    ensureDotSlash: false,
    escapePath: false,
  };

  test.each([
    [
      'keeps plain relative paths relative',
      '/docs/note.md',
      '/docs/assets/image.png',
      options,
      'assets/image.png',
    ],
    [
      'adds dot slash when requested',
      '/docs/note.md',
      '/docs/assets/image.png',
      { ...options, ensureDotSlash: true },
      './assets/image.png',
    ],
    [
      'escapes spaces when requested',
      '/docs/note.md',
      '/docs/My Image.png',
      { ...options, escapePath: true },
      'My\\ Image.png',
    ],
    [
      'keeps absolute paths when relative roots differ',
      'C:/docs/note.md',
      'D:/assets/image.png',
      options,
      'D:/assets/image.png',
    ],
    [
      'leaves external resources unchanged',
      '/docs/note.md',
      'https://example.com/image.png',
      options,
      'https://example.com/image.png',
    ],
  ])('%s', (_label, documentPath, assetPath, referenceOptions, expected) => {
    expect(
      formatAttachmentReference(documentPath, assetPath, referenceOptions)
    ).toBe(expected);
  });
});

describe('resolveAttachmentPath', () => {
  test.each([
    [
      'resolves dot slash relative paths',
      '/docs/note.md',
      './assets/image.png',
      '/docs/assets/image.png',
    ],
    [
      'resolves escaped spaces',
      '/docs/note.md',
      './My\\ Image.png',
      '/docs/My Image.png',
    ],
    [
      'returns null for external resources',
      '/docs/note.md',
      'https://example.com/image.png',
      null,
    ],
    [
      'returns null for relative paths without a document',
      null,
      './assets/image.png',
      null,
    ],
    [
      'decodes percent-encoded references',
      '/docs/note.md',
      './My%20Image%20%E4%B8%AD.png',
      '/docs/My Image 中.png',
    ],
    [
      'keeps a literal percent sign',
      '/docs/note.md',
      './100%.png',
      '/docs/100%.png',
    ],
    [
      'keeps UNC paths intact',
      '/docs/note.md',
      '\\\\server\\share\\img.png',
      '//server/share/img.png',
    ],
    [
      'resolves relative to a document on a share',
      '//server/share/docs/note.md',
      '../img.png',
      '//server/share/img.png',
    ],
    [
      'converts file URIs',
      '/docs/note.md',
      'file:///tmp/a%20b.png',
      '/tmp/a b.png',
    ],
    [
      'converts file URIs with a share host',
      '/docs/note.md',
      'file://server/share/a.png',
      '//server/share/a.png',
    ],
  ])('%s', (_label, documentPath, assetPath, expected) => {
    expect(resolveAttachmentPath(documentPath, assetPath)).toBe(expected);
  });
});

describe('UNC paths', () => {
  test('normalizePath keeps the share root', () => {
    expect(normalizePath('\\\\server\\share\\a\\..\\b')).toBe(
      '//server/share/b'
    );
    expect(normalizePath('//server/share')).toBe('//server/share/');
  });

  test('dirnamePath stops at the share root', () => {
    expect(dirnamePath('//server/share/docs/a.md')).toBe('//server/share/docs');
    expect(dirnamePath('//server/share/a.md')).toBe('//server/share/');
  });

  test('formatAttachmentReference relativizes within a share', () => {
    expect(
      formatAttachmentReference(
        '//server/share/docs/note.md',
        '//server/share/img.png',
        { preferRelativePath: true, ensureDotSlash: false, escapePath: false }
      )
    ).toBe('../img.png');
  });
});

describe('resolveStorageDir', () => {
  test.each([
    ['dot means the document folder', '/docs/note.md', '.', '/docs'],
    ['keeps absolute folders', '/docs/note.md', '/pics', '/pics'],
    [
      'expands ${filename} to the document stem',
      '/docs/my note.md',
      './${filename}.assets',
      '/docs/my note.assets',
    ],
    [
      'expands a bare ${filename}',
      '/docs/note.md',
      '${filename}',
      '/docs/note',
    ],
  ])('%s', (_label, documentPath, targetDir, expected) => {
    expect(resolveStorageDir(documentPath, targetDir)).toBe(expected);
  });
});

describe('sanitizeFileName', () => {
  test.each([
    ['keeps readable names', 'hello-world.png', 'hello-world.png'],
    ['replaces unsafe characters', 'hello world?.png', 'hello-world.png'],
    ['strips parent paths', '../nested/image.png', 'image.png'],
    ['keeps duplicate suffixes intact', 'image-2.png', 'image-2.png'],
    ['falls back for empty stems', '???', 'attachment'],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });
});
