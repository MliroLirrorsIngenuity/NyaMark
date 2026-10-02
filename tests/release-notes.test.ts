import { describe, expect, test } from 'bun:test';
import { releaseNoteBlocks } from '../src/ui/release-notes';

const CLIFF = `## 1.0.1 (2026-10-05)

### 🐛 Bug Fixes

- *(editor)* Rank the code block's language search  @Lemon-miaow
- *(ui)* Ring a dialog's choice card  @Lemon-miaow

- Dark mode transparency effects  @Lemon-miaow


### 🔧 Chore

- Update CHANGELOG.md [skip ci]  @github-actions[bot]
`;

describe('release notes in the update dialog', () => {
  test("read git-cliff's groups as headings and its changes as a list", () => {
    expect(releaseNoteBlocks(CLIFF)).toEqual([
      { kind: 'heading', text: '🐛 Bug Fixes' },
      {
        kind: 'item',
        scope: 'editor',
        text: "Rank the code block's language search",
      },
      { kind: 'item', scope: 'ui', text: "Ring a dialog's choice card" },
      { kind: 'item', scope: null, text: 'Dark mode transparency effects' },
      { kind: 'heading', text: '🔧 Chore' },
      { kind: 'item', scope: null, text: 'Update CHANGELOG.md [skip ci]' },
    ]);
  });

  test('read emphasis, code and links as their words', () => {
    expect(
      releaseNoteBlocks(
        'Fixed **bold**, `code` and [a link](https://example.com).\n- snake_case_name stays'
      )
    ).toEqual([
      { kind: 'text', text: 'Fixed bold, code and a link.' },
      { kind: 'item', scope: null, text: 'snake_case_name stays' },
    ]);
  });

  test('join a line that goes on to the change or paragraph before it', () => {
    expect(
      releaseNoteBlocks('- First half\n  second half\n\nOne\ntwo')
    ).toEqual([
      { kind: 'item', scope: null, text: 'First half second half' },
      { kind: 'text', text: 'One two' },
    ]);
  });

  test('hold nothing for an empty body', () => {
    expect(releaseNoteBlocks('')).toEqual([]);
    expect(releaseNoteBlocks('## Unreleased\n\n')).toEqual([]);
  });
});
