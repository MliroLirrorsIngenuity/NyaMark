/** A message between the page and the native screens around it on iOS. */
export type NativeMessage = { type: string } & Record<string, unknown>;

type Bridged = Window & {
  webkit?: {
    messageHandlers?: {
      nyamark?: { postMessage: (message: NativeMessage) => void };
    };
  };
  __nyamarkNative?: { receive: (message: NativeMessage) => void };
};

export function postToNative(message: NativeMessage) {
  (window as Bridged).webkit?.messageHandlers?.nyamark?.postMessage(message);
}

/** Native code calls `window.__nyamarkNative.receive` with each message. */
export function onNativeMessage(handler: (message: NativeMessage) => void) {
  (window as Bridged).__nyamarkNative = { receive: handler };
}
