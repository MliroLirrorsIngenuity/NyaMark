import { ensureStyle } from '../../style/register';

const css = `
.ny-editor-root .milkdown .nyamark-mermaid-preview {
  display: flex;
  justify-content: center;
  margin: 0 !important;
  padding: 2px 0 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}

.ny-editor-root .milkdown .nyamark-mermaid-preview svg {
  display: block;
  width: auto !important;
  max-width: 100%;
  max-height: 152px !important;
  height: auto !important;
  margin-left: auto;
  margin-right: auto;
}

:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node rect,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node circle,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node ellipse,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node polygon,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node path {
  fill: #eef2ff !important;
  stroke: #8b7cf6 !important;
}

:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .edgePath .path,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .flowchart-link {
  stroke: #3f3f46 !important;
}

:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview marker path {
  fill: #3f3f46 !important;
  stroke: #3f3f46 !important;
}

:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .nodeLabel,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .nodeLabel p,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .label,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview text,
:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .edgeLabel {
  fill: #1f2937 !important;
  color: #1f2937 !important;
}

:root[data-theme="light"] .ny-editor-root .milkdown .nyamark-mermaid-preview .cluster rect {
  fill: #fafaf9 !important;
  stroke: rgba(139, 124, 246, 0.3) !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node rect,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node circle,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node ellipse,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node polygon,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .node path {
  fill: #243446 !important;
  stroke: #8db4c8 !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .edgePath .path,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .flowchart-link {
  stroke: #a5b8c9 !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview marker path {
  fill: #a5b8c9 !important;
  stroke: #a5b8c9 !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .nodeLabel,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .nodeLabel p,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .label,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview text,
:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .edgeLabel {
  fill: #edf3f8 !important;
  color: #edf3f8 !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-preview .cluster rect {
  fill: #1c2733 !important;
  stroke: rgba(141, 180, 200, 0.3) !important;
}

.ny-editor-root .milkdown .nyamark-mermaid-error {
  margin-top: 0.25rem !important;
  padding: 14px 16px !important;
  border: 1px solid color-mix(in srgb, #b42318, transparent 72%) !important;
  border-radius: 0.75rem !important;
  background: color-mix(in srgb, #b42318, white 96%) !important;
  color: #b42318 !important;
  white-space: pre-wrap !important;
  font: 12px/1.5 var(--crepe-font-code) !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .nyamark-mermaid-error {
  background: color-mix(in srgb, #b42318, #131a22 88%) !important;
  color: #f97066 !important;
  border-color: color-mix(in srgb, #b42318, transparent 58%) !important;
}
`;

export function registerMermaidStyles() {
  ensureStyle('editor-mermaid', css);
}
