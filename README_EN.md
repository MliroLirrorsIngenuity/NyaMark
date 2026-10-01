<div align="center">
  <h1 align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="src-tauri/icons/banner-dark.svg">
      <img src="src-tauri/icons/banner.svg" alt="NyaMark Banner" width="600">
    </picture><br>
    NyaMark
  </h1>
  <p align="center">
    A lightweight Markdown editor that launches fast and gets out of your way.
    <br />
    <br />
    <a href="README.md">简体中文</a>
    |
    <a href="README_EN.md">English</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>

* [Features](#features)

* [Usage](#usage)

* [Development](#development)

* [License](#license)

* [Acknowledgments](#acknowledgments)

</details>

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

<p align="center">
  <a href="https://nm.lolicon.best/hero-editor.webp">
    <img src="https://nm.lolicon.best/hero-editor.webp" alt="NyaMark editor preview" width="920">
  </a>
</p>

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
