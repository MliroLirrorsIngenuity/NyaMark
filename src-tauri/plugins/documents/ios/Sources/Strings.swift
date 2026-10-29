import Foundation

/// The native screens' text in the app's three languages, worded as in the page's locale files.
enum L10n {
  /// `en`, `zh-CN` or `zh-TW`; the page reports the language chosen in Settings.
  static var language: String = {
    for preferred in Locale.preferredLanguages {
      if preferred.hasPrefix("zh-Hant") || preferred.hasPrefix("zh-TW") || preferred.hasPrefix("zh-HK") {
        return "zh-TW"
      }
      if preferred.hasPrefix("zh") { return "zh-CN" }
      if preferred.hasPrefix("en") { return "en" }
    }
    return "en"
  }()

  private static let table: [String: [String: String]] = [
    "documents": ["en": "Documents", "zh-CN": "文档", "zh-TW": "文件"],
    "back": ["en": "Back", "zh-CN": "返回", "zh-TW": "返回"],
    "file": ["en": "File", "zh-CN": "文件", "zh-TW": "檔案"],
    "new": ["en": "New", "zh-CN": "新建", "zh-TW": "新增"],
    "open": ["en": "Open", "zh-CN": "打开", "zh-TW": "開啟"],
    "recents": ["en": "Recent", "zh-CN": "最近", "zh-TW": "最近"],
    "recentsEmpty": [
      "en": "Documents you open appear here.", "zh-CN": "最近打开的文档将显示在此处。",
      "zh-TW": "最近打開的文件將顯示在此處。",
    ],
    "locations": ["en": "Locations", "zh-CN": "位置", "zh-TW": "位置"],
    "icloud": ["en": "iCloud Drive", "zh-CN": "iCloud 云盘", "zh-TW": "iCloud 雲碟"],
    "icloudUnavailable": [
      "en": "To use this location, sign in to iCloud and turn on iCloud Drive in Settings.",
      "zh-CN": "请在“设置”中登录 iCloud 并打开 iCloud 云盘，以使用此位置。",
      "zh-TW": "請在「設定」中登入 iCloud 並開啟 iCloud 雲碟，以使用此位置。",
    ],
    "onMyDevice": ["en": "On My %@", "zh-CN": "我的 %@", "zh-TW": "我的 %@"],
    "addFolder": ["en": "Add Folder…", "zh-CN": "添加文件夹…", "zh-TW": "加入資料夾…"],
    "openOther": ["en": "Open Other Document…", "zh-CN": "打开其他文档…", "zh-TW": "打開其他文件…"],
    "newDocument": ["en": "New Document", "zh-CN": "新建文档", "zh-TW": "新增文件"],
    "untitled": ["en": "Untitled", "zh-CN": "未命名", "zh-TW": "未命名"],
    "rename": ["en": "Rename", "zh-CN": "重命名", "zh-TW": "重新命名"],
    "delete": ["en": "Delete", "zh-CN": "删除", "zh-TW": "刪除"],
    "removeRecent": ["en": "Remove from Recent", "zh-CN": "从“最近”中移除", "zh-TW": "從「最近」中移除"],
    "removeLocation": ["en": "Remove Location", "zh-CN": "移除此位置", "zh-TW": "移除此位置"],
    "cancel": ["en": "Cancel", "zh-CN": "取消", "zh-TW": "取消"],
    "name": ["en": "Name", "zh-CN": "名称", "zh-TW": "名稱"],
    "deleteTitle": ["en": "Delete “%@”?", "zh-CN": "要删除“%@”吗？", "zh-TW": "要刪除「%@」嗎？"],
    "deleteBody": [
      "en":
        "If this location keeps recently deleted items, the item moves there. Otherwise, it is deleted permanently.",
      "zh-CN": "如果此位置提供“最近删除”，该项目将移至“最近删除”；否则将被永久删除。",
      "zh-TW": "如果此位置提供「最近刪除」，該項目將移至「最近刪除」；否則將被永久刪除。",
    ],
    "folderEmpty": [
      "en": "This folder contains no Markdown documents.", "zh-CN": "此文件夹中没有 Markdown 文档。",
      "zh-TW": "此資料夾中沒有 Markdown 文件。",
    ],
    "notDownloaded": ["en": "Not Downloaded", "zh-CN": "尚未下载", "zh-TW": "尚未下載"],
    "documentUnavailable": [
      "en": "This document cannot be accessed.", "zh-CN": "无法访问此文档。", "zh-TW": "無法存取此文件。",
    ],
    "folderUnavailable": [
      "en": "This folder cannot be accessed.", "zh-CN": "无法访问此文件夹。", "zh-TW": "無法存取此資料夾。",
    ],
    "failed": [
      "en": "The operation could not be completed. %@", "zh-CN": "无法完成此操作。%@", "zh-TW": "無法完成此操作。%@",
    ],
    "exists": [
      "en": "An item named “%@” already exists in this folder.", "zh-CN": "此文件夹中已存在名为“%@”的项目。",
      "zh-TW": "此資料夾中已存在名為「%@」的項目。",
    ],
    "invalidName": [
      "en": "A name cannot be empty or contain “/” or “:”.", "zh-CN": "名称不能为空，也不能包含“/”或“:”。",
      "zh-TW": "名稱不能為空，也不能包含「/」或「:」。",
    ],
    "search": ["en": "Search", "zh-CN": "搜索", "zh-TW": "搜尋"],
    "share": ["en": "Share…", "zh-CN": "共享…", "zh-TW": "分享…"],
    "exportPdf": ["en": "Export as PDF", "zh-CN": "导出为 PDF", "zh-TW": "匯出為 PDF"],
    "print": ["en": "Print…", "zh-CN": "打印…", "zh-TW": "列印…"],
    "outline": ["en": "Outline", "zh-CN": "大纲", "zh-TW": "大綱"],
    "find": ["en": "Find", "zh-CN": "查找", "zh-TW": "尋找"],
    "source": ["en": "Source", "zh-CN": "源码", "zh-TW": "原始碼"],
    "ai": ["en": "AI assistant", "zh-CN": "AI 助手", "zh-TW": "AI 助理"],
    "settings": ["en": "Settings", "zh-CN": "设置", "zh-TW": "設定"],
    "more": ["en": "More", "zh-CN": "更多", "zh-TW": "更多"],
    "undo": ["en": "Undo", "zh-CN": "撤销", "zh-TW": "復原"],
    "redo": ["en": "Redo", "zh-CN": "重做", "zh-TW": "重做"],
    "heading": ["en": "Heading", "zh-CN": "标题", "zh-TW": "標題"],
    "bulletList": ["en": "Bulleted List", "zh-CN": "无序列表", "zh-TW": "項目符號清單"],
    "taskList": ["en": "Task List", "zh-CN": "任务列表", "zh-TW": "待辦清單"],
    "orderedList": ["en": "Numbered List", "zh-CN": "有序列表", "zh-TW": "編號清單"],
    "indent": ["en": "Increase Indent", "zh-CN": "增加缩进", "zh-TW": "增加縮排"],
    "outdent": ["en": "Decrease Indent", "zh-CN": "减少缩进", "zh-TW": "減少縮排"],
    "bold": ["en": "Bold", "zh-CN": "粗体", "zh-TW": "粗體"],
    "italic": ["en": "Italic", "zh-CN": "斜体", "zh-TW": "斜體"],
    "strikethrough": ["en": "Strikethrough", "zh-CN": "删除线", "zh-TW": "刪除線"],
    "code": ["en": "Inline Code", "zh-CN": "行内代码", "zh-TW": "行內程式碼"],
    "link": ["en": "Link", "zh-CN": "链接", "zh-TW": "連結"],
    "image": ["en": "Image", "zh-CN": "图片", "zh-TW": "圖片"],
    "table": ["en": "Table", "zh-CN": "表格", "zh-TW": "表格"],
    "codeBlock": ["en": "Code Block", "zh-CN": "代码块", "zh-TW": "程式碼區塊"],
    "quote": ["en": "Quote", "zh-CN": "引用", "zh-TW": "引言"],
    "divider": ["en": "Divider", "zh-CN": "分隔线", "zh-TW": "分隔線"],
    "math": ["en": "Math", "zh-CN": "公式", "zh-TW": "公式"],
    "moveLeft": ["en": "Move Left", "zh-CN": "向左移动", "zh-TW": "向左移動"],
    "moveRight": ["en": "Move Right", "zh-CN": "向右移动", "zh-TW": "向右移動"],
    "hideKeyboard": ["en": "Hide keyboard", "zh-CN": "收起键盘", "zh-TW": "收起鍵盤"],
    "insert": ["en": "Insert “%@”", "zh-CN": "插入“%@”", "zh-TW": "插入「%@」"],
  ]

  static func text(_ key: String, _ arguments: CVarArg...) -> String {
    let template = table[key]?[language] ?? table[key]?["en"] ?? key
    return arguments.isEmpty ? template : String(format: template, arguments: arguments)
  }
}
