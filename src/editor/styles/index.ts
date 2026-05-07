import { registerSharedStyles } from './shared.css';
import { registerCrepeOverrideStyles } from './crepe-overrides.css';
import { registerCursorAndMarksStyles } from './cursor-and-marks.css';
import { registerImageMetaStyles } from './image-meta.css';
import { registerMermaidStyles } from './mermaid.css';

export function registerEditorStyles() {
  registerSharedStyles();
  registerCrepeOverrideStyles();
  registerCursorAndMarksStyles();
  registerImageMetaStyles();
  registerMermaidStyles();
}
