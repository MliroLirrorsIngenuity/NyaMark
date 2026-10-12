<div align="center">
  <h1 align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="src-tauri/icons/banner-dark.svg">
      <img src="src-tauri/icons/banner.svg" alt="NyaMark Banner" width="600">
    </picture><br>
    NyaMark
  </h1>
  <p align="center">
    A lightweight Markdown editor that launches fast, with an AI writing assistant built in.
    <br />
    <br />
    <a href="README.md">简体中文</a>
    |
    <a href="README_EN.md">English</a>
  </p>
</div>

<p align="center">
  <a href="https://nm.lolicon.best/hero-assistant.webp">
    <img src="https://nm.lolicon.best/hero-assistant.webp" alt="NyaMark editor with the AI assistant" width="920">
  </a>
</p>

<details>
  <summary>Table of Contents</summary>

* [AI Writing Assistant](#ai-writing-assistant)

* [Features](#features)

* [Usage](#usage)

* [Development](#development)

* [License](#license)

* [Acknowledgments](#acknowledgments)

</details>

## AI Writing Assistant

Since 1.1, an AI assistant sits beside your document. It reads what you are writing and helps you draft, rewrite, proofread and research, and every change it suggests is marked in the text for you to keep or drop.

* **Review every change**: The assistant's edits show up in the text as insertions and deletions. Accept or reject each one on its own, and undo an accepted change as usual. Switch to auto mode to have edits written straight into the document.

* **Knows the context**: The assistant reads the whole document, its outline and your selection, and can look through and edit the other Markdown notes in the same folder. It asks before creating or changing another file.

* **Always at hand**: Select some text to polish, rewrite, shorten, expand, fix the grammar or translate it from the toolbar. Continue writing or summarize what came before from the slash menu. With autocomplete on, a grey suggestion appears after the caret when you pause; press Tab to take it.

* **Researches on the web**: The assistant searches the web and reads pages without a search API key. With Anthropic or OpenAI, it can use the provider's own web search instead.

* **Images and MCP**: Send screenshots and photos to models that support images, and connect MCP servers to give the assistant more tools.

* **Your choice of model**: OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, Qwen, Kimi, Zhipu GLM, SiliconFlow, Volcano Engine, local models through Ollama or LM Studio, and any OpenAI-compatible service. You can also sign in with ChatGPT (Plus or higher) to use your plan. Reasoning models let you choose how hard they think.

* **Keys and history stay on your computer**: API keys are kept in the system keychain and sent only to the service address you enter. Each document's conversations are saved locally and come back when you reopen it.

## Features

* **Lightweight by design**: Built with <a href="https://tauri.app/"><strong>Tauri v2</strong></a> and Rust for a small footprint and quick launch.

* **Focus-first editing**: Powered by <a href="https://milkdown.dev/"><strong>Milkdown</strong></a> (Crepe) for a smooth WYSIWYG flow that stays out of the way.

* **Useful essentials included**:

  * **Mathematical Formulas**: Built-in KaTeX for LaTeX rendering.

  * **Diagram Rendering**: Integrated Mermaid support for flowcharts, sequence diagrams, Gantt charts, and more.

  * **GitHub Alerts**: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` and `> [!CAUTION]` render the way GitHub shows them.

  * **Inline HTML**: HTML in a document is sanitized and rendered in place; inline tags stay inline.

  * **Source Mode**: Powered by CodeMirror 6, with source and preview side by side and scrolled together.

  * **Images and Attachments**: Pasted, dropped or picked local images keep their original path, or are copied next to the document, into `./assets` or a custom folder, or embedded as Base64, as you choose in settings.

  * **Outline, Find and PDF Export**: Jump between headings, highlight every match of a search, and export to PDF.

* **Safe Saving**: Optional auto-save, a prompt when another program changes the file, and the file's BOM and line endings kept on save.

* **Automatic Updates**: New versions are checked for, downloaded and installed from inside the app.

* **Localized Interface**: English, Simplified Chinese and Traditional Chinese, following the system language by default.

* **Cross-Platform**: Native support for Windows, macOS, and Linux.

* **Clean interface**: Light and dark themes that follow the system, an optional frosted-glass look, and the focus left on your writing.

## Usage

Go to the [Releases](https://github.com/MliroLirrorsIngenuity/NyaMark/releases) page to download the latest version for your **platform**.

## Development

This project is developed using Bun and Tauri:

```bash
# Install dependencies
bun install

# Start development environment
bun tauri dev

# Build for production
bun tauri build
```

## License

Except for the icon artwork listed below, this project is licensed under the [MIT License](LICENSE).

### License Notes

1. **Retain Copyright Notice**: You must include the original author's copyright and license notice in any copies or derivative software.
2. **Disclaimer**: This project is provided "as is," and the author assumes no legal liability for any issues arising from its use.
3. **Icon Resource Ownership (Important)**:

   * The NyaMark logo and icon artwork (every file in the `src-tauri/icons` directory and `public/favicon.svg`) **is not distributed under the MIT License**.

   * **The aforementioned icon resources are "All Rights Reserved"**. Unauthorized use, modification, or redistribution of these assets in other projects is strictly prohibited.

## Acknowledgments

* [Tauri](https://tauri.app/): An excellent framework for building cross-platform desktop applications.

* [Milkdown](https://milkdown.dev/): A modular WYSIWYG Markdown editor framework.

* [CodeMirror](https://codemirror.net/): The industry-leading code editor component.
