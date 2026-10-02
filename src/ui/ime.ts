/**
 * Whether a key press goes to an input method. WebKit ends a composition
 * before the keydown of the key that commits it, Enter for kana or for the
 * letters of a pinyin IME, so that keydown reads `isComposing` false; its
 * keyCode, 229, still tells. A find field took that Enter for the next
 * match, and the replace field replaced one.
 */
export function forInputMethod(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}
