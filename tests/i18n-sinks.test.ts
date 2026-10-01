import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';

// i18next runs with `escapeValue: false`, which is only safe while translated
// strings (and the file names, paths and errors interpolated into them) never
// reach an HTML parser. Templates assigned to innerHTML carry static fallback
// text and `data-i18n` keys; translateDOM fills them in via textContent.
const HTML_SINK =
  /(?:innerHTML|outerHTML)\s*=\s*`([\s\S]*?)`|insertAdjacentHTML\([^,]+,\s*`([\s\S]*?)`/g;
const TRANSLATION_CALL = /\bt\(/;

describe('translated strings stay out of HTML sinks', () => {
  test('no innerHTML template calls t()', async () => {
    const offenders: string[] = [];
    for await (const file of new Glob('src/**/*.ts').scan('.')) {
      const source = await Bun.file(file).text();
      for (const match of source.matchAll(HTML_SINK)) {
        const template = match[1] ?? match[2] ?? '';
        if (TRANSLATION_CALL.test(template)) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${file}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
