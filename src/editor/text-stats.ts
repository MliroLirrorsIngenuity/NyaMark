/**
 * Word count for mixed CJK and Latin text. Chinese and Japanese put no spaces
 * between words, so every Han, Hiragana and Katakana character counts as one,
 * the way word processors count them; everything else counts by runs of
 * letters and digits between spaces. Punctuation on its own counts for nothing.
 */
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+`, 'gu');
const HAS_WORD = /[\p{L}\p{N}]/u;
const IS_CJK = new RegExp(`^[${CJK}]$`, 'u');

export function countWords(text: string): number {
  let words = 0;
  for (const [token] of text.matchAll(TOKEN)) {
    if (IS_CJK.test(token) || HAS_WORD.test(token)) words += 1;
  }
  return words;
}
