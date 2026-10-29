import type { AiAskMode } from '../../editor/plugins/ai-entry';
import { store } from '../../state/store';
import type { NativeAiPanel } from './ai-panel';
import type { NativePanelsHost } from './index';
import { onPanel, postPanel } from './panels';
import { openNativeSettings } from './settings';

/** The assistant's code loads with the first thing the sheet asks of it. */
let panel: Promise<NativeAiPanel> | null = null;
let sheetOpen = false;

function load(host: NativePanelsHost): Promise<NativeAiPanel> {
  panel ??= import('./ai-panel').then(({ NativeAiPanel }) => {
    const editor = host.editor();
    if (!editor) throw new Error('No editor yet');
    return new NativeAiPanel({
      editor,
      sourceSelection: () => host.sourceMode()?.selectionInDocument() ?? null,
      flushSource: () => host.sourceMode()?.flush(),
      followSource: (before) => host.sourceMode()?.followEditor(before),
      documentPath: () => store.getState().filePath,
      openSettings: (service) =>
        openNativeSettings('ai', { addService: service }),
    });
  });
  return panel;
}

/**
 * The page's side of the native assistant: the sheet's messages reach the
 * conversation, which is built the first time the sheet opens.
 */
export function bindNativeAi(host: NativePanelsHost) {
  onPanel('ai', async (message) => {
    if (message.op === 'open') sheetOpen = true;
    else if (message.op === 'close') sheetOpen = false;
    try {
      (await load(host)).handle(message);
    } catch (error) {
      panel = null;
      console.error('[ai] The assistant failed to load', error);
    }
  });
}

/** Opens the assistant's sheet. */
export function openNativeAi() {
  if (!sheetOpen) postPanel('ai', 'present');
}

/** Opens the assistant's sheet for the AI menu's `mode`. */
export function askNativeAi(_mode: AiAskMode) {
  openNativeAi();
}
