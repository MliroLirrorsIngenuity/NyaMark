import { describe, expect, test } from 'bun:test';
import {
  formatAttachmentReference,
  resolveAttachmentPath,
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
  ])('%s', (_label, documentPath, assetPath, expected) => {
    expect(resolveAttachmentPath(documentPath, assetPath)).toBe(expected);
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
