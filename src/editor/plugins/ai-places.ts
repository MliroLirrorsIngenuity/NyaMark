/**
 * Where the reply to a command of the AI or slash menu is to go, kept up
 * with the user's edits while the model writes: ProseMirror maps the range
 * through each transaction, as it does the proposals'. Text typed at an
 * empty one goes before it; deleting across an end of one loses it.
 */

import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { mapRange } from './ai-proposals';

type Range = { from: number; to: number };

/** Each range kept, by its id; null once it is lost. */
type Places = ReadonlyMap<number, Range | null>;

type PlaceMeta = { keep: number; range: Range } | { drop: number };

const placesKey = new PluginKey<Places>('nyamark/ai-places');

let ids = 0;

/** Keeps `from`–`to` of the view's document; returns the id to find it by. */
export function keepPlace(view: EditorView, from: number, to: number) {
  const meta: PlaceMeta = { keep: ++ids, range: { from, to } };
  view.dispatch(view.state.tr.setMeta(placesKey, meta));
  return meta.keep;
}

/** Where the range `id` is now; null once it is lost, or let go. */
export function keptPlace(state: EditorState, id: number): Range | null {
  return placesKey.getState(state)?.get(id) ?? null;
}

export function dropPlace(view: EditorView, id: number) {
  if (!placesKey.getState(view.state)?.has(id)) return;
  const meta: PlaceMeta = { drop: id };
  view.dispatch(view.state.tr.setMeta(placesKey, meta));
}

/** The plugin itself, apart from the editor (for the tests). */
export function placesPlugin() {
  return new Plugin<Places>({
    key: placesKey,
    state: {
      init: () => new Map(),
      apply(tr, places) {
        const meta = tr.getMeta(placesKey) as PlaceMeta | undefined;
        if (!tr.docChanged && !meta) return places;
        const next = new Map<number, Range | null>();
        for (const [id, range] of places) {
          next.set(id, range && mapRange(range.from, range.to, tr, false));
        }
        if (meta && 'keep' in meta) next.set(meta.keep, meta.range);
        if (meta && 'drop' in meta) next.delete(meta.drop);
        return next;
      },
    },
  });
}

export const aiPlaces = $prose(placesPlugin);
