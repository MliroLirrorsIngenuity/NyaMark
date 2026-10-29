import type { NyaEditor } from '../../editor/editor';
import type { SourceModeController } from '../../editor/source-mode';
import { bindNativeOutline } from './outline';

/** What the page's sides of the native panels reach in the app. */
export type NativePanelsHost = {
  editor: () => NyaEditor | null;
  sourceMode: () => SourceModeController | null;
};

/** Connects the native panels on iOS to what they show and do on the page. */
export function bindNativePanels(host: NativePanelsHost) {
  bindNativeOutline(host);
}
