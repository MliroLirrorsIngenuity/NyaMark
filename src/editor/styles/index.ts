import { ensureStyle } from '../../style/register';
import { languageBadgeCss } from './language-badges';

// `?inline` hands over the processed CSS as a string instead of injecting it,
// so these sheets still land after Crepe's own and win ties in the cascade.
import crepeOverrides from './crepe-overrides.css?inline';
import cursorAndMarks from './cursor-and-marks.css?inline';
import imageMeta from './image-meta.css?inline';
import mermaid from './mermaid.css?inline';
import shared from './shared.css?inline';

export function registerEditorStyles() {
  ensureStyle('editor-shared-vars', shared);
  ensureStyle('editor-crepe-overrides', crepeOverrides);
  ensureStyle('editor-language-badges', languageBadgeCss);
  ensureStyle('editor-cursor-and-marks', cursorAndMarks);
  ensureStyle('editor-image-meta', imageMeta);
  ensureStyle('editor-mermaid', mermaid);
}
