import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// Everything that talks to Tauri lives in src/bridge, so the rest of the app
// can be read (and unit tested) without the native runtime, and a Tauri API
// change touches one layer.
describe('bridge boundary', () => {
  const files = [...new Bun.Glob('src/**/*.ts').scanSync('.')].filter(
    (file) => !file.startsWith('src/bridge/')
  );

  test('finds the sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test('only src/bridge imports @tauri-apps', () => {
    const offenders = files.filter((file) =>
      /from '@tauri-apps\//.test(readFileSync(file, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
