use pulldown_cmark::{Parser, html, Event, Tag, HeadingLevel};

#[derive(Debug, Clone)]
pub struct Heading {
    pub level: u32,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct ParsedMarkdown {
    pub html: String,
    pub headings: Vec<Heading>,
}

fn preprocess_math(src: &str) -> String {
    // 简单处理 $...$ 与 $$...$$ 包裹的数学公式，转换为内联/块级 HTML
    // 不做转义与嵌套严格检查，追求易读简单。
    let mut out = String::with_capacity(src.len());
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' {
            // 检测 $$
            if i + 1 < chars.len() && chars[i + 1] == '$' {
                // 块级
                i += 2;
                let start = i;
                while i + 1 < chars.len() && !(chars[i] == '$' && chars[i + 1] == '$') { i += 1; }
                let content = chars[start..i].iter().collect::<String>();
                out.push_str(&format!("\n<div class=\"math-block\">{}</div>\n", content.trim()));
                if i + 1 < chars.len() { i += 2; } // 跳过结尾$$
                continue;
            } else {
                // 内联
                i += 1;
                let start = i;
                while i < chars.len() && chars[i] != '$' { i += 1; }
                let content = chars[start..i].iter().collect::<String>();
                out.push_str(&format!("<span class=\"math-inline\">{}</span>", content.trim()));
                if i < chars.len() { i += 1; } // 跳过结尾$
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

pub fn parse_markdown(md: &str) -> ParsedMarkdown {
    let processed = preprocess_math(md);
    let mut headings = Vec::new();
    let parser = Parser::new(&processed);

    let mut current_heading: Option<(u32, String)> = None;
    let mut events: Vec<Event> = Vec::new();
    for ev in parser {
        match &ev {
            Event::Start(Tag::Heading(level, ..)) => {
                let lvl_num = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                current_heading = Some((lvl_num, String::new()));
            }
            Event::End(Tag::Heading(..)) => {
                if let Some((lvl, text)) = current_heading.take() {
                    headings.push(Heading { level: lvl, text });
                }
            }
            Event::Text(t) => {
                if let Some((_lvl, ref mut acc)) = current_heading {
                    acc.push_str(t);
                }
            }
            _ => {}
        }
        events.push(ev);
    }
    // Render events back to HTML
    let mut html_output = String::new();
    html::push_html(&mut html_output, events.into_iter());
    ParsedMarkdown { html: html_output, headings }
}

pub fn markdown_to_html(md: &str) -> String {
    parse_markdown(md).html
}
