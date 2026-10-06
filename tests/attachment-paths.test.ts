import { describe, expect, test } from 'bun:test';
import {
  addressUrl,
  dirnamePath,
  findSiteRootFile,
  formatAttachmentReference,
  isNetworkPath,
  isSiteRootReference,
  isWithinDirectory,
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
      'My%20Image.png',
    ],
    [
      'keeps absolute paths when relative roots differ',
      'C:/docs/note.md',
      'D:/assets/image.png',
      options,
      'D:/assets/image.png',
    ],
    [
      'ignores case on Windows drives',
      'C:/Docs/note.md',
      'c:/docs/Assets/image.png',
      options,
      'Assets/image.png',
    ],
    [
      'ignores case on network shares',
      '//Server/Share/docs/note.md',
      '//server/share/Docs/image.png',
      options,
      'image.png',
    ],
    [
      'keeps case on POSIX paths',
      '/Docs/note.md',
      '/docs/image.png',
      options,
      '../docs/image.png',
    ],
    [
      'encodes what a URL would read as a query, fragment or escape',
      '/docs/note.md',
      '/docs/a#1 100%?.png',
      options,
      'a%231 100%25%3F.png',
    ],
    [
      'turns file URIs into relative paths',
      '/docs/note.md',
      'file:///docs/assets/My%20Image.png',
      options,
      'assets/My Image.png',
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
      'reads a reference from // as a host on the web',
      '/docs/note.md',
      '//example.com/image.png',
      null,
    ],
    ['returns null for other schemes', '/docs/note.md', 'foo:a.png', null],
    [
      'reads a drive letter as a path',
      '/docs/note.md',
      'C:\\img\\a.png',
      'C:/img/a.png',
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
      'ends the path at a fragment',
      '/docs/note.md',
      'notes/other.md#usage',
      '/docs/notes/other.md',
    ],
    [
      'ends the path at a query',
      '/docs/note.md',
      './a.png?v=2#x',
      '/docs/a.png',
    ],
    [
      'reads an encoded fragment mark as part of the name',
      '/docs/note.md',
      'a%231.md',
      '/docs/a#1.md',
    ],
    ['returns null for a fragment alone', '/docs/note.md', '#usage', null],
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

describe('site-root references', () => {
  /** The file `reference` in `documentPath` finds among `files`. */
  const find = (documentPath: string, reference: string, files: string[]) => {
    const path = resolveAttachmentPath(documentPath, reference) ?? '';
    return findSiteRootFile(documentPath, path, async (candidate) =>
      files.includes(candidate)
    );
  };

  test.each([
    ['from the root of a site', '/images/a.png', true],
    ['with spaces around', '  /a.png ', true],
    ['on a network share', '//server/share/a.png', false],
    ['relative to the document', './a.png', false],
    ['bare', 'a.png', false],
    ['on a drive', 'C:/a.png', false],
    ['as a file URI', 'file:///a.png', false],
  ])('a reference %s is one: %s', (_label, reference, expected) => {
    expect(isSiteRootReference(reference)).toBe(expected);
  });

  test.each([
    [
      'in public beside the posts (Astro, Vite)',
      '/Users/me/blog/posts/a.md',
      ['/Users/me/blog/public/images/x.png'],
      '/Users/me/blog/public/images/x.png',
    ],
    [
      'in static above the posts (Hugo)',
      '/site/content/posts/deep/a.md',
      ['/site/static/images/x.png'],
      '/site/static/images/x.png',
    ],
    [
      'in the site folder itself (Jekyll)',
      '/site/_posts/a.md',
      ['/site/images/x.png'],
      '/site/images/x.png',
    ],
    [
      'the nearest of two',
      '/blog/posts/a.md',
      ['/blog/public/images/x.png', '/blog/posts/public/images/x.png'],
      '/blog/posts/public/images/x.png',
    ],
    [
      'the file at that path on disk first',
      '/blog/posts/a.md',
      ['/images/x.png', '/blog/public/images/x.png'],
      '/images/x.png',
    ],
    [
      'on a Windows drive',
      'C:/blog/posts/a.md',
      ['C:/blog/public/images/x.png'],
      'C:/blog/public/images/x.png',
    ],
    ['none, with no such file', '/blog/posts/a.md', [], null],
  ])('finds the file %s', async (_label, documentPath, files, expected) => {
    expect(await find(documentPath, '/images/x.png', files)).toBe(expected);
  });

  test('decodes the reference before looking', async () => {
    expect(
      await find('/blog/posts/a.md', '/images/my%20pic.png', [
        '/blog/public/images/my pic.png',
      ])
    ).toBe('/blog/public/images/my pic.png');
  });
});

describe('addressUrl', () => {
  test.each([
    ['https://example.com/a.png', 'https://example.com/a.png'],
    ['  //example.com/a.png ', 'https://example.com/a.png'],
    ['file:///C:/a.png', 'file:///C:/a.png'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['C:\\a.png', null],
    ['c:/a.png', null],
    ['\\\\server\\share\\a.png', null],
    ['./a.png', null],
    ['/a.png', null],
    ['a b.png', null],
  ])('%s', (reference, href) => {
    expect(addressUrl(reference)?.href ?? null).toBe(href);
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

  test('isNetworkPath tells a share from a path on this computer', () => {
    expect(isNetworkPath('//server/share/a.png')).toBe(true);
    expect(isNetworkPath('\\\\server\\share\\a.png')).toBe(true);
    expect(isNetworkPath('/Users/me/a.png')).toBe(false);
    expect(isNetworkPath('C:/Users/me/a.png')).toBe(false);
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
    ['sanitizes the extension', 'image.p?n g', 'image.png'],
    ['drops leading and trailing dots', '.hidden..png', 'hidden.png'],
    ['avoids Windows device names', 'CON.png', 'CON_.png'],
    ['avoids device names before a later dot', 'nul.tar.gz', 'nul_.tar.gz'],
    ['keeps names that only start like devices', 'console.png', 'console.png'],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  test('caps the name length in bytes', () => {
    expect(sanitizeFileName(`${'a'.repeat(300)}.png`)).toBe(
      `${'a'.repeat(196)}.png`
    );
    expect(sanitizeFileName(`${'中'.repeat(100)}.png`)).toBe(
      `${'中'.repeat(65)}.png`
    );
  });
});

describe('isWithinDirectory', () => {
  test.each([
    ['the directory itself', '/docs', '/docs', true],
    ['a nested folder', '/docs/assets/img', '/docs', true],
    ['a sibling folder', '/static/images', '/docs', false],
    ['the parent folder', '/', '/docs', false],
    ['a name that only shares a prefix', '/docs-old', '/docs', false],
    ['another drive', 'D:/docs', 'C:/docs', false],
  ])('%s', (_label, path, directory, expected) => {
    expect(isWithinDirectory(path, directory)).toBe(expected);
  });
});
