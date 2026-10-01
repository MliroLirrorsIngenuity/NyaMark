import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// CodeMirror recognises extensions and facets by object identity. Crepe's
// code blocks and NyaMark's own source mode both build on these packages;
// a second copy of any of them in the tree makes the extensions one side
// passes unrecognisable to the other ("Unrecognized extension value").
// bun.lock keeps a nested copy under a `parent/@codemirror/name` key.
const SHARED = [
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
  '@codemirror/autocomplete',
];

describe('dependency tree', () => {
  const lock = readFileSync(new URL('../bun.lock', import.meta.url), 'utf8');

  for (const name of SHARED) {
    test(`resolves a single ${name}`, () => {
      const pattern = new RegExp(
        `^\\s*"(?:[^"]+/)?${name.replace('/', '\\/')}": \\[`,
        'gm'
      );
      const entries = lock.match(pattern) ?? [];
      expect(entries.map((entry) => entry.trim())).toEqual([`"${name}": [`]);
    });
  }
});
