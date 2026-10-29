import { type NativeMessage, postToNative } from '../../bridge/native-shell';

/** A message between a native panel and the page's side of it. */
export type PanelMessage = NativeMessage & { panel: string; op: string };

type Handler = (message: PanelMessage) => unknown;

const handlers = new Map<string, Handler>();

/** Has the messages of the native panel named `panel` reach `handler`. */
export function onPanel(panel: string, handler: Handler): () => void {
  handlers.set(panel, handler);
  return () => {
    if (handlers.get(panel) === handler) handlers.delete(panel);
  };
}

export async function dispatchPanel(message: NativeMessage) {
  const handler = handlers.get(String(message.panel));
  await handler?.(message as PanelMessage);
}

export function postPanel(
  panel: string,
  op: string,
  data: Record<string, unknown> = {}
) {
  postToNative({ ...data, type: 'panel', panel, op });
}
