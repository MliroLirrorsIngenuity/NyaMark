<div align="center">
  <img src="src-tauri/icons/banner.svg" alt="NyaMark Banner" width="600">
  <h1 align="center">NyaMark</h1>
  <p align="center">
    一款基于 <a href="https://tauri.app/"><strong>Tauri v2</strong></a> 和 <a href="https://milkdown.dev/"><strong>Milkdown</strong></a> 开发的现代化 Markdown 编辑器。
    <br />
    <br />
    <a href="README.md">简体中文</a>
    |
    <a href="README_EN.md">English</a>
  </p>
</div>

<details>
  <summary>目录</summary>

* [特性](#特性)

* [使用方式](#使用方式)

* [开发调试](#开发调试)

* [提问前必看](#提问前必看)

* [开源协议](#开源协议)

* [致谢](#致谢)

</details>

## 特性

* **高性能渲染核心**：利用 Tauri v2 与 Rust 编写的后端，提供极速响应的桌面端应用体验。

* **现代化所见即所得 (WYSIWYG)**：基于 Milkdown (Crepe) 框架，提供流畅的“所见即所得”编辑体验，让创作回归内容。

* **强大的扩展支持**：

  * **数学公式**：内置 KaTeX 支持，完美渲染 LaTeX 公式。

  * **图表渲染**：集成 Mermaid，支持流程图、时序图、甘特图等多种图表。

  * **源码模式**：底层采用 CodeMirror 6，提供专业的 Markdown 源码编辑与语法高亮。

* **跨平台支持**：原生支持 Windows、macOS 和 Linux。

* **极致的视觉体验**：基于 TailwindCSS v4 构建，提供精致、现代且符合直觉的用户界面。

## 使用方式

前往 [Releases](https://github.com/MliroLirrorsIngenuity/NyaMark/releases) 页面下载**对应平台**的最新版本安装即可使用。

## 开发调试

本项目基于 Bun 和 Tauri 开发：

```bash
# 安装依赖
bun install

# 启动开发环境
bun tauri dev

# 构建生产版本
bun tauri build
```

## 提问前必看

在提问之前，请确保：

* 已经尝试了所有可能的解决方案

* 已经尝试搜索了解决方案（包括但不限于本仓库的 Issues）

* 你提供了**足够的信息**帮助开发人员定位问题，包括但不限于下列：

  * 软件版本

  * 操作系统版本

  * 复现步骤

* 提问渠道说明

  * **Bug/功能请求** → [Issues](https://github.com/MliroLirrorsIngenuity/NyaMark/issues)

## 开源协议

本项目代码部分遵循 [MIT License](LICENSE) 开源协议。

### 协议注意事项

1. **保留版权声明**：在您分发本项目的副本或基于本项目衍生的软件中，必须包含原作者的版权声明和许可声明。
2. **免责声明**：本项目按“原样”提供，作者不承担任何因使用本项目而产生的法律责任。
3. **图标资源所有权声明 (重要)**：

   * 根目录下的所有图标文件 (`.svg`, `.png`, `.icns`, `.icon` 等) 以及 `src-tauri/icons` 目录下的所有资源**不随 MIT 许可证一同发放**。

   * **上述图标资源保留所有权利 (All Rights Reserved)**，未经原作者明确许可，严禁在其他项目中使用、修改或重新分发这些图标资源。

## 致谢

* [Tauri](https://tauri.app/)：构建跨平台桌面应用的优秀框架

* [Milkdown](https://milkdown.dev/)：模块化的所见即所得 Markdown 编辑器框架

* [CodeMirror](https://codemirror.net/)：业界领先的代码编辑器组件

* [TailwindCSS](https://tailwindcss.com/)：让界面开发更高效的 CSS 框架

