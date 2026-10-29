import type { ProxySetting } from '../../bridge/ipc/ai';
import type { AiSettings } from '../../state/ai-settings';
import type { FormEvent, FormPage, FormSection, NativeForm } from './form';

/**
 * The settings' AI tab in the native form, as `renderAiSection` is on the
 * page: the same settings, held in the dialog's working copy until OK.
 */
export type NativeAiTab = {
  /** The tab's sections on the settings' first page. */
  sections: () => FormSection[];
  /** A page the tab pushed, by its id; null once it is gone. */
  page: (id: string) => FormPage | null;
  /** What the user did on the tab's rows or on a page it pushed. */
  handle: (event: FormEvent) => void | Promise<void>;
  /** As `AiSection.settled`. */
  settled: () => Promise<void>;
  /** As `AiSection.committed`. */
  committed: () => void;
  /** The dialog closed. */
  destroy: () => void;
  /** As `AiSection.addService`. */
  addService: (id: string) => void;
};

export type NativeAiTabOptions = {
  /** The proxy as the dialog has it now, saved or not. */
  proxy: () => ProxySetting;
  form: NativeForm;
  /** Pushes the page `id`, which `page` then builds. */
  push: (id: string) => void;
  /** Goes back from the page `id` and any above it. */
  pop: (id: string) => void;
};

export function createNativeAiTab(
  _current: AiSettings,
  _onChange: (next: AiSettings) => void,
  _options: NativeAiTabOptions
): NativeAiTab {
  return {
    sections: () => [],
    page: () => null,
    handle: () => undefined,
    settled: async () => undefined,
    committed: () => undefined,
    destroy: () => undefined,
    addService: () => undefined,
  };
}
