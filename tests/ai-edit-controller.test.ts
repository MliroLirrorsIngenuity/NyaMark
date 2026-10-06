import { afterEach, describe, expect, test } from 'bun:test';
import { history, undo } from '@milkdown/kit/prose/history';
import type { Node } from '@milkdown/kit/prose/model';
import {
  EditorState,
  type PluginView,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { EditController } from '../src/ai/edit/controller';
import { EditError, replaceText } from '../src/ai/edit/text-edit';
import type { NyaEditor } from '../src/editor/editor';
import { proposalsPlugin } from '../src/editor/plugins/ai-proposals';
import type { AiEditMode } from '../src/state/ai-settings';
import { env, parse, serialize } from './ai-edit-helpers';

const controllers: EditController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
});

/** A controller on an editor that is no more than its state. */
function setup(text: string, mode: AiEditMode = 'review') {
  let pluginViews: PluginView[] = [];
  const view = {
    state: EditorState.create({
      doc: parse(text),
      plugins: [history(), proposalsPlugin()],
    }),
    composing: false,
    isDestroyed: false,
    dom: new EventTarget(),
    dispatch(tr: Transaction) {
      const previous = view.state;
      view.state = view.state.apply(tr);
      for (const each of pluginViews) each.update?.(asView, previous);
    },
  };
  const asView = view as unknown as EditorView;
  pluginViews = view.state.plugins.flatMap((plugin) =>
    plugin.spec.view ? [plugin.spec.view(asView)] : []
  );
  const editor = {
    whenReady: async () => undefined,
    getView: () => asView,
    getMarkdown: () => serialize(view.state.doc),
    serializeDoc: serialize,
    parseMarkdown: parse,
    blockSpans: env.blockSpans,
  } as unknown as NyaEditor;
  const followed: Node[] = [];
  const controller = new EditController({
    editor,
    sourceSelection: () => null,
    flushSource: () => undefined,
    localImage: async () => null,
    followSource: (before) => followed.push(before),
    editMode: () => mode,
  });
  controllers.push(controller);
  return {
    view,
    controller,
    followed,
    text: () => serialize(view.state.doc),
    replace: (from: string, to: string) =>
      controller.edit((current) => replaceText(current, from, to)),
  };
}

const TEXT = 'one two three\n\nsecond paragraph\n';

describe('the assistant editing the document', () => {
  test('proposes its edits and reads them back before they are accepted', async () => {
    const { controller, text, replace } = setup(TEXT);
    const { report, notices } = await replace('two', 'TWO');
    expect(text()).toBe(TEXT);
    expect(notices).toBeNull();
    expect(report).toMatchObject({
      status: 'proposed',
      edit: 'e1',
      changes: 1,
    });
    expect(report.text).toContain('one TWO three');
    expect((await controller.read()).text).toBe(
      'one TWO three\n\nsecond paragraph\n'
    );
    expect(controller.outcome('e1')).toEqual({
      total: 1,
      pending: 1,
      accepted: 0,
      rejected: 0,
      dropped: 0,
      replaced: 0,
    });
  });

  test('tells the assistant once what the user accepted', async () => {
    const { controller, followed, text, replace } = setup(TEXT);
    await replace('two', 'TWO');
    controller.acceptEdit('e1');
    expect(text()).toBe('one TWO three\n\nsecond paragraph\n');
    expect(followed).toHaveLength(1);
    expect(controller.outcome('e1')).toMatchObject({ pending: 0, accepted: 1 });
    const notices = await controller.notices();
    expect(notices).toContain('The user accepted 1 change of edit e1.');
    expect(notices).not.toContain('differs');
    expect(await controller.notices()).toBeNull();
  });

  test('tells the assistant what the user rejected and that the text went back', async () => {
    const { controller, text, replace } = setup(TEXT);
    await replace('two', 'TWO');
    controller.rejectEdit('e1');
    expect(text()).toBe(TEXT);
    expect(controller.outcome('e1')).toMatchObject({ pending: 0, rejected: 1 });
    const notices = await controller.notices();
    expect(notices).toContain('The user rejected 1 change of edit e1');
    expect(notices).toContain('The text differs from how you last saw it');
  });

  test('gives the notices with an edit that fails', async () => {
    const { controller, replace } = setup(TEXT);
    await replace('two', 'TWO');
    controller.rejectEdit('e1');
    const failed = await replace('missing', 'x').catch((error) => error);
    expect(failed).toBeInstanceOf(EditError);
    expect((failed as EditError).code).toBe('not_found');
    expect((failed as EditError).message).toContain('The user rejected');
    expect(await controller.notices()).toBeNull();
  });

  test('tells where the user changed the text since it last read it', async () => {
    const { controller, view } = setup(TEXT);
    await controller.read();
    view.dispatch(view.state.tr.insertText('X', 1));
    expect(await controller.notices()).toContain(
      'The text differs from how you last saw it around'
    );
  });

  test('takes back an earlier proposal that a later edit redoes', async () => {
    const { controller, replace } = setup(TEXT);
    await replace('two', 'TWO');
    const { report } = await replace('TWO', '2');
    expect(report.text).toContain('in place of 1 earlier proposed change');
    expect(controller.pending()).toHaveLength(1);
    expect(controller.outcome('e1')).toMatchObject({ pending: 0, replaced: 1 });
    expect((await controller.read()).text).toBe(
      'one 2 three\n\nsecond paragraph\n'
    );
  });

  test('applies edits at once when told to, each one undo step', async () => {
    const { controller, view, text, replace } = setup(TEXT, 'auto');
    const { report } = await replace('two', 'TWO');
    expect(report.status).toBe('applied');
    expect(text()).toBe('one TWO three\n\nsecond paragraph\n');
    expect(controller.pending()).toHaveLength(0);
    // What its own edit did is no news to the assistant.
    expect(await controller.notices()).toBeNull();
    undo(view.state, view.dispatch);
    expect(text()).toBe(TEXT);
    expect(await controller.notices()).toContain(
      'The user undid accepting 1 change of edit e1'
    );
  });

  test('tells a new conversation nothing of the edits before it', async () => {
    const { controller, replace } = setup(TEXT);
    await replace('two', 'TWO');
    controller.reset();
    controller.rejectEdit('e1');
    expect(await controller.notices()).toBeNull();
  });
});
