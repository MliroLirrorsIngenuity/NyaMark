use crate::markdown::{self, ParsedMarkdown};
use eframe::{egui, App as EframeApp};
use rfd::FileDialog;
use std::fs;
use std::path::PathBuf;

pub fn run_gui() {
    let app = GuiApp::default();
    let native_options = eframe::NativeOptions::default();
    if let Err(e) = eframe::run_native(
        "NyaMark GUI",
        native_options,
        Box::new(|cc| {
            configure_fonts(&cc.egui_ctx);
            Box::new(app)
        }),
    ) {
        eprintln!("Failed to start GUI: {e}");
    }
}

struct GuiApp {
    markdown: String,
    parsed: ParsedMarkdown,
    file_path: Option<PathBuf>,
    dirty: bool,
    dark_mode: bool,
    show_outline: bool,
    status_message: String,
    autosave: bool,
    last_edit_time: f64,
    // 搜索替换
    find_text: String,
    replace_text: String,
    show_find: bool,
    // layout
    editor_ratio: f32,
}

impl Default for GuiApp {
    fn default() -> Self {
        let md = "# Hello NyaMark!\n\n这是一个用Rust写的Markdown编辑器。\n\n## 小节\n一些文字。"
            .to_owned();
        let parsed = markdown::parse_markdown(&md);
        Self {
            markdown: md,
            parsed,
            file_path: None,
            dirty: true,
            dark_mode: false,
            show_outline: true,
            status_message: "Ready".to_string(),
            autosave: true,
            last_edit_time: 0.0,
            find_text: String::new(),
            replace_text: String::new(),
            show_find: false,
            editor_ratio: 0.5,
        }
    }
}

impl GuiApp {
    fn open_file(&mut self) {
        if let Some(path) = FileDialog::new()
            .add_filter("Markdown", &["md", "markdown"])
            .pick_file()
        {
            if let Ok(content) = fs::read_to_string(&path) {
                self.markdown = content;
                self.parsed = markdown::parse_markdown(&self.markdown);
                self.file_path = Some(path);
                self.dirty = false;
                self.status_message = "File loaded".into();
            }
        }
    }
    fn save_file(&mut self) {
        let target = if let Some(p) = &self.file_path {
            p.clone()
        } else if let Some(path) = FileDialog::new().set_file_name("note.md").save_file() {
            path
        } else {
            return;
        };
        if let Err(e) = fs::write(&target, &self.markdown) {
            self.status_message = format!("Save failed: {e}");
        } else {
            self.file_path = Some(target);
            self.dirty = false;
            self.status_message = "Saved".into();
        }
    }
    fn export_html(&mut self) {
        if let Some(path) = FileDialog::new().set_file_name("export.html").save_file() {
            if let Err(e) = fs::write(&path, &self.parsed.html) {
                self.status_message = format!("Export failed: {e}");
            } else {
                self.status_message = "HTML exported".into();
            }
        }
    }
    fn maybe_autosave(&mut self, now: f64) {
        if self.autosave
            && self.dirty
            && self.file_path.is_some()
            && (now - self.last_edit_time > 1.5)
        {
            // 简单节流：最后编辑 1.5s 后保存
            self.save_file();
            self.status_message = "Autosaved".into();
        }
    }
}

// 尝试加载系统中常见的中文字体，解决中文显示为方块的问题。
fn configure_fonts(ctx: &egui::Context) {
    use std::path::Path;
    // 1. Try embedded font bytes (compile-time include if user adds file and enables feature)
    #[cfg(feature = "embed-font")]
    {
        // User should place a CJK font at assets/fonts/cjk.ttf and enable feature embed-font
        const EMBED_FONT: &[u8] = include_bytes!("../assets/fonts/cjk.ttf");
        let mut f = egui::FontDefinitions::default();
        f.font_data
            .insert("cjk".into(), egui::FontData::from_static(EMBED_FONT));
        if let Some(fam) = f.families.get_mut(&egui::FontFamily::Proportional) {
            fam.insert(0, "cjk".into());
        }
        if let Some(fam) = f.families.get_mut(&egui::FontFamily::Monospace) {
            fam.insert(0, "cjk".into());
        }
        ctx.set_fonts(f);
        return;
    }

    // 2. Try runtime relative font (put fonts in ./fonts next to exe)
    if let Ok(exe) = std::env::current_exe() {
        let font_dir = exe.parent().map(|p| p.join("fonts"));
        if let Some(dir) = font_dir {
            let candidates = [
                "cjk.ttf",
                "cjk.ttc",
                "NotoSansCJK-Regular.ttc",
                "NotoSansSC-Regular.otf",
            ];
            for name in candidates {
                let p = dir.join(name);
                if p.exists() {
                    if let Ok(bytes) = std::fs::read(&p) {
                        let mut defs = egui::FontDefinitions::default();
                        defs.font_data
                            .insert("cjk".into(), egui::FontData::from_owned(bytes));
                        if let Some(fam) = defs.families.get_mut(&egui::FontFamily::Proportional) {
                            fam.insert(0, "cjk".into());
                        }
                        if let Some(fam) = defs.families.get_mut(&egui::FontFamily::Monospace) {
                            fam.insert(0, "cjk".into());
                        }
                        ctx.set_fonts(defs);
                        return;
                    }
                }
            }
        }
    }
    let candidate_paths: &[&str] = &[
        // Windows 常见
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttf",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        // macOS 常见
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        // Linux 常见 (可能需要根据发行版调整)
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    ];

    let mut font_defs = egui::FontDefinitions::default();
    let mut loaded_font = None;
    for path in candidate_paths {
        if Path::new(path).exists() {
            if let Ok(bytes) = std::fs::read(path) {
                font_defs
                    .font_data
                    .insert("cjk".to_string(), egui::FontData::from_owned(bytes));
                loaded_font = Some(*path);
                break;
            }
        }
    }

    if loaded_font.is_none() {
        // 仍然没有则直接返回，保持默认字体（英文正常，中文仍会是方块，用户可自行放置字体文件）
        ctx.set_fonts(font_defs); // 设置默认，避免未设置时潜在重复 clone
        return;
    }

    // 将自定义字体放前面作为主要字体
    if let Some(fam) = font_defs.families.get_mut(&egui::FontFamily::Proportional) {
        fam.insert(0, "cjk".to_string());
    }
    if let Some(fam) = font_defs.families.get_mut(&egui::FontFamily::Monospace) {
        fam.insert(0, "cjk".to_string());
    }
    ctx.set_fonts(font_defs);
}

// 简易 Markdown 预览（不直接显示原始 HTML，便于跨平台字体和主题）
fn render_markdown_preview(ui: &mut egui::Ui, src: &str) {
    let mut in_code = false;
    for line in src.lines() {
        if line.trim_start().starts_with("```") {
            in_code = !in_code;
            if in_code {
                ui.separator();
            }
            continue;
        }
        if in_code {
            ui.monospace(line);
            continue;
        }
        if let Some(rest) = line.strip_prefix("###### ") {
            ui.heading(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix("##### ") {
            ui.heading(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix("#### ") {
            ui.heading(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix("### ") {
            ui.heading(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix("## ") {
            ui.heading(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix("# ") {
            ui.heading(rest);
            continue;
        }
        if line.starts_with("- ") || line.starts_with("* ") {
            ui.label(line);
            continue;
        }
        ui.label(line);
    }
}

impl EframeApp for GuiApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if self.dark_mode != ctx.style().visuals.dark_mode {
            // theme sync
            let mut style = (*ctx.style()).clone();
            style.visuals = if self.dark_mode {
                egui::Visuals::dark()
            } else {
                egui::Visuals::light()
            };
            ctx.set_style(style);
        }

        // 快捷键处理（简单）
        if ctx.input(|i| {
            i.modifiers.matches_logically(egui::Modifiers::CTRL) && i.key_pressed(egui::Key::S)
        }) {
            self.save_file();
        }
        if ctx.input(|i| {
            i.modifiers.matches_logically(egui::Modifiers::CTRL) && i.key_pressed(egui::Key::F)
        }) {
            self.show_find = true;
        }
        // Ctrl+Q: close window by setting should_stop
        if ctx.input(|i| {
            i.modifiers.matches_logically(egui::Modifiers::CTRL) && i.key_pressed(egui::Key::Q)
        }) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }

        // Menu Bar (简化 & 修正分类)
        egui::TopBottomPanel::top("menu_bar").show(ctx, |ui| {
            egui::menu::bar(ui, |ui| {
                ui.menu_button("文件", |ui| {
                    if ui.button("打开...").clicked() {
                        self.open_file();
                        ui.close_menu();
                    }
                    if ui.button("保存").clicked() {
                        self.save_file();
                        ui.close_menu();
                    }
                    if ui.button("另存为...").clicked() {
                        self.file_path = None;
                        self.save_file();
                        ui.close_menu();
                    }
                    if ui.button("导出 HTML").clicked() {
                        self.export_html();
                        ui.close_menu();
                    }
                });
                ui.menu_button("编辑", |ui| {
                    if ui.button("搜索/替换").clicked() {
                        self.show_find = true;
                        ui.close_menu();
                    }
                    if ui.button("插入图片占位").clicked() {
                        self.markdown.push_str("\n![](path/to/image.png)\n");
                        self.parsed = markdown::parse_markdown(&self.markdown);
                        self.dirty = true;
                        ui.close_menu();
                    }
                    if ui.button("插入内联公式").clicked() {
                        self.markdown.push_str(" $a^2+b^2=c^2$ ");
                        self.parsed = markdown::parse_markdown(&self.markdown);
                        self.dirty = true;
                        ui.close_menu();
                    }
                    if ui.button("插入块级公式").clicked() {
                        self.markdown.push_str("\n$$\\int_0^1 x^2 dx$$\n");
                        self.parsed = markdown::parse_markdown(&self.markdown);
                        self.dirty = true;
                        ui.close_menu();
                    }
                });
                ui.menu_button("查看", |ui| {
                    ui.checkbox(&mut self.show_outline, "显示大纲");
                    ui.checkbox(&mut self.dark_mode, "暗色主题");
                    ui.checkbox(&mut self.autosave, "自动保存");
                });
                ui.menu_button("帮助", |ui| {
                    ui.label("NyaMark 0.1.0");
                    ui.label("看牛魔看");
                });
            });
        });

        // Status Bar bottom
        egui::TopBottomPanel::bottom("status_bar").show(ctx, |ui| {
            let file = self
                .file_path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or("未命名".into());
            ui.horizontal_wrapped(|ui| {
                ui.label(format!(
                    "{file}  行:{} 字:{} {}",
                    self.markdown.lines().count(),
                    self.markdown.chars().count(),
                    self.status_message
                ));
            });
        });

        // Panels layout: outline (optional) + resizable editor side + central preview auto fills
        // Outline side panel (optional)
        if self.show_outline {
            egui::SidePanel::left("outline_panel")
                .resizable(true)
                .default_width(170.0)
                .show(ctx, |ui| {
                    ui.heading("大纲");
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        for h in &self.parsed.headings {
                            let indent = (h.level.saturating_sub(1) as f32) * 8.0;
                            ui.horizontal(|ui| {
                                ui.add_space(indent);
                                let _ = ui.selectable_label(false, &h.text); // clickable handling TODO
                            });
                        }
                    });
                });
        }

        // Central: simple horizontal layout that auto-resizes with window
        egui::CentralPanel::default().show(ctx, |ui| {
            let full_w = ui.available_width();
            let min_editor = 150.0;
            let min_preview = 150.0;
            let (editor_w, preview_w) = if full_w < (min_editor + min_preview + 8.0) {
                let e = (full_w * 0.5).max(60.0);
                let p = (full_w - e - 4.0).max(40.0);
                (e, p)
            } else {
                let max_editor = full_w - min_preview;
                let e = (full_w * self.editor_ratio).clamp(min_editor, max_editor);
                let p = (full_w - e - 4.0).max(min_preview);
                (e, p)
            };
            if full_w > 0.0 {
                self.editor_ratio = (editor_w / full_w).clamp(0.1, 0.9);
            }
            ui.horizontal(|ui| {
                // Editor
                ui.allocate_ui_with_layout(
                    egui::vec2(editor_w, ui.available_height()),
                    egui::Layout::top_down(egui::Align::LEFT),
                    |ui| {
                        egui::ScrollArea::vertical().show(ui, |ui| {
                            if ctx.input(|i| !i.raw.dropped_files.is_empty()) {
                                let dropped = ctx.input(|i| i.raw.dropped_files.clone());
                                for f in dropped {
                                    if let Some(p) = f.path {
                                        if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                                            let ext_l = ext.to_lowercase();
                                            if matches!(
                                                ext_l.as_str(),
                                                "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp"
                                            ) {
                                                self.markdown
                                                    .push_str(&format!("\n![]({})\n", p.display()));
                                                self.parsed =
                                                    markdown::parse_markdown(&self.markdown);
                                                self.dirty = true;
                                            }
                                        }
                                    }
                                }
                            }
                            if ui.text_edit_multiline(&mut self.markdown).changed() {
                                self.parsed = markdown::parse_markdown(&self.markdown);
                                self.dirty = true;
                                self.last_edit_time = ctx.input(|i| i.time);
                            }
                            if self.show_find {
                                ui.separator();
                                ui.horizontal(|ui| {
                                    ui.label("查找:");
                                    ui.text_edit_singleline(&mut self.find_text);
                                    ui.label("替换为:");
                                    ui.text_edit_singleline(&mut self.replace_text);
                                    if ui.button("全部替换").clicked() && !self.find_text.is_empty()
                                    {
                                        self.markdown = self
                                            .markdown
                                            .replace(&self.find_text, &self.replace_text);
                                        self.parsed = markdown::parse_markdown(&self.markdown);
                                        self.dirty = true;
                                        self.last_edit_time = ctx.input(|i| i.time);
                                    }
                                    if ui.button("关闭").clicked() {
                                        self.show_find = false;
                                    }
                                });
                                if !self.find_text.is_empty() {
                                    let count = self.markdown.matches(&self.find_text).count();
                                    ui.label(format!("匹配: {count}"));
                                }
                            }
                        });
                    },
                );
                // Simple draggable ratio adjust area
                let drag_rect = ui.allocate_rect(
                    egui::Rect::from_min_size(
                        ui.cursor().min,
                        egui::vec2(4.0, ui.available_height()),
                    ),
                    egui::Sense::click_and_drag(),
                );
                if drag_rect.dragged() {
                    let delta = drag_rect.drag_delta().x;
                    let new_editor_w = (editor_w + delta).clamp(150.0, full_w - 150.0);
                    self.editor_ratio = (new_editor_w / full_w).clamp(0.15, 0.85);
                }
                ui.painter().rect_filled(
                    drag_rect.rect.shrink(0.5),
                    1.0,
                    ui.visuals().widgets.inactive.bg_fill,
                );
                // Preview
                ui.allocate_ui_with_layout(
                    egui::vec2(preview_w.max(100.0), ui.available_height()),
                    egui::Layout::top_down(egui::Align::LEFT),
                    |ui| {
                        ui.heading("预览");
                        egui::ScrollArea::vertical().show(ui, |ui| {
                            render_markdown_preview(ui, &self.markdown);
                        });
                    },
                );
            });
        });

        // autosave check
        let now = ctx.input(|i| i.time);
        self.maybe_autosave(now);
    }
}
