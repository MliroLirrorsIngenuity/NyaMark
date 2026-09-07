import { describe, expect, test } from 'bun:test';
import { classifyLinkTarget } from '../src/features/attachment-policy';

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
