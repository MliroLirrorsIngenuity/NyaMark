<div align="center">
  <h1 align="center">
    <img src="src-tauri/icons/banner.svg" alt="NyaMark Banner" width="600"><br>
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

  * **Mathematical Formulas**: Built-in KaTeX support for perfect LaTeX rendering.

  * **Diagram Rendering**: Integrated Mermaid support for flowcharts, sequence diagrams, Gantt charts, and more.

  * **Source Mode**: Powered by CodeMirror 6, so you can switch to source editing whenever you need it.

* **Cross-Platform**: Native support for Windows, macOS, and Linux.

* **Clean interface**: Built with TailwindCSS v4 to keep the UI simple and leave the focus on your writing.

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

The source code of this project is licensed under the [MIT License](LICENSE).

### License Notes

1. **Retain Copyright Notice**: You must include the original author's copyright and license notice in any copies or derivative software.
2. **Disclaimer**: This project is provided "as is," and the author assumes no legal liability for any issues arising from its use.
3. **Icon Resource Ownership (Important)**:

   * All icon files in the root directory (`.svg`, `.png`, `.icns`, `.icon`, etc.) and all resources in the `src-tauri/icons` directory **are not distributed under the MIT License**.

   * **The aforementioned icon resources are "All Rights Reserved"**. Unauthorized use, modification, or redistribution of these assets in other projects is strictly prohibited.

## Acknowledgments

* [Tauri](https://tauri.app/): An excellent framework for building cross-platform desktop applications.

* [Milkdown](https://milkdown.dev/): A modular WYSIWYG Markdown editor framework.

* [CodeMirror](https://codemirror.net/): The industry-leading code editor component.

* [TailwindCSS](https://tailwindcss.com/): A utility-first CSS framework for efficient UI development.
