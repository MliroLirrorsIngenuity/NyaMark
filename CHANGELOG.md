# Changelog
## 1.0.0 (2026-10-03)

### ✨ Features

- *(updates)* Answer a manual update check with a note inside the window  @Lemon-miaow


### 🐛 Bug Fixes

- *(editor)* Set source mode in the code blocks' font on every system  @Lemon-miaow

- *(editor)* Keep link definitions no link uses  @Lemon-miaow

- *(editor)* Keep the label a rewritten link definition was written with  @Lemon-miaow

- *(editor)* Bracket a rewritten definition's address where it needs it  @Lemon-miaow

- *(editor)* Give links the first definition in the order written  @Lemon-miaow

- *(editor)* Keep brackets escaped where a kept definition has their label  @Lemon-miaow

- *(editor)* Keep a list item's line after a footnote out of it  @Lemon-miaow

- *(save)* Ask before writing over a file another program changed  @Lemon-miaow

- *(save)* Remove the empty file a failed first save created  @Lemon-miaow

- *(save)* Count keys typed in the source pane while the file is read  @Lemon-miaow

- *(save)* Save files whose names reach the length limit  @Lemon-miaow

- *(settings)* Close the open dropdown when another one opens  @Lemon-miaow

- *(titlebar)* Restore a maximized window on a double-click on Windows and Linux  @Lemon-miaow

- *(titlebar)* Keep the traffic lights in place under a new title on macOS  @Lemon-miaow


### 🚜 Refactor

- *(editor)* Share the options notes are written with  @Lemon-miaow


### 🎨 Styling

- *(titlebar)* Draw the Mac outline button as a small round icon  @Lemon-miaow

- *(titlebar)* Draw the window buttons on Windows and Linux as the system does  @Lemon-miaow

- *(titlebar)* Put settings beside the file menu on Windows and Linux  @Lemon-miaow


### 🧪 Testing

- *(editor)* Read link definitions through the editor's pipeline  @Lemon-miaow

- *(editor)* Fuzz link definitions against plain remark  @Lemon-miaow

- *(save)* Fuzz saves against another program writing the file  @Lemon-miaow

- *(save)* Fuzz writes against another program changing the file  @Lemon-miaow


### ⚙️ CI

- *(release)* Put download badges for each installer above the changes  @Lemon-miaow

- Build the installers of every commit and keep them as artifacts  @Lemon-miaow


### Build

- *(clippy)* Reject unwrap and expect outside tests  @Lemon-miaow


## 1.0.0-rc.1 (2026-10-03)

### ✨ Features

- *(editor)* Show a formula or diagram alone until the caret goes into it  @Lemon-miaow

- *(editor)* Turn typed [text](url) and ![alt](src) into links and images  @Lemon-miaow

- *(editor)* End a code block on Enter after a typed closing fence  @Lemon-miaow

- *(editor)* Make footnotes from [^1] and [^1]: typed in a line  @Lemon-miaow

- *(editor)* Make an address typed in a line a link on the space or Enter after it  @Lemon-miaow

- *(editor)* Open the link box with Cmd+K, on a link to change its address  @Lemon-miaow

- *(editor)* Make headings with Cmd+1 to Cmd+6 and text with Cmd+0 as in Typora  @Lemon-miaow

- *(editor)* Make the selected text a link when an address is pasted over it  @Lemon-miaow

- *(editor)* Open the slash menu on 、, which the Chinese input method types for /  @Lemon-miaow

- *(editor)* Make a rule of *** or ___ alone on a line on Enter  @Lemon-miaow

- *(editor)* Make text typed between three stars bold and italic  @Lemon-miaow

- *(errors)* Report uncaught errors and unhandled rejections in a dialog  @Lemon-miaow

- *(i18n)* Offer following the system language and keep it in sync  @Lemon-miaow

- *(outline)* Dock the outline beside the document and follow the reading position  @Lemon-miaow

- *(search)* Look for the selected text when find opens  @Lemon-miaow

- *(settings)* Ask for the custom folder only when images are to be copied into it  @Lemon-miaow

- *(table)* Turn a typed | a | b | line into a table on Enter  @Lemon-miaow

- *(updates)* Check for updates from the app menu or settings  @Lemon-miaow

- Add printing/exporting functionality (#1)  @Mashirl


### 🐛 Bug Fixes

- *(a11y)* Make the status bar theme and mode toggles real buttons  @Lemon-miaow

- *(alerts)* Keep the caret out of the hidden marker and let Backspace remove it  @Lemon-miaow

- *(alerts)* Keep the caret in an alert typed with nothing under it  @Lemon-miaow

- *(attachments)* Report paste, drop, upload and link failures to the user  @Lemon-miaow

- *(attachments)* Ask for the custom folder when missing and expose it in settings  @Lemon-miaow

- *(attachments)* Decode percent-escapes, keep UNC paths and expand ${filename}  @Lemon-miaow

- *(attachments)* Claim unique file names atomically, cap the search and pass bytes as Uint8Array  @Lemon-miaow

- *(attachments)* Pick images for the upload button natively so the insert policy applies  @Lemon-miaow

- *(attachments)* Refuse to embed images over 5 MiB as base64  @Lemon-miaow

- *(attachments)* Percent-encode spaces in paths instead of backslash escaping  @Lemon-miaow

- *(attachments)* Resolve file uris before formatting a reference and drop the duplicate external check  @Lemon-miaow

- *(attachments)* Sanitize extensions, windows device names and name length  @Lemon-miaow

- *(attachments)* Ask before copying into a front matter folder outside the document  @Lemon-miaow

- *(attachments)* Compare windows paths case-insensitively when relativizing  @Lemon-miaow

- *(attachments)* Leave a file dropped on a dialog out of the document  @Lemon-miaow

- *(autosave)* Keep the countdown running when an unrelated setting changes  @Lemon-miaow

- *(caret)* Follow the caret drawn at the end of a wrapped line  @Lemon-miaow

- *(caret)* Bring the caret leaving a code block upward into sight  @Lemon-miaow

- *(caret)* Redraw the caret once a picture in its line loads  @Lemon-miaow

- *(caret)* Keep the page still when a typed mark closes after a footnote  @Lemon-miaow

- *(ci)* Set GH_REPO so the publish job can run gh without a checkout  @Lemon-miaow

- *(ci)* Match CHANGELOG version headings exactly  @Lemon-miaow

- *(ci)* Fail on unsigned updater bundles and publish a beta updater feed  @Lemon-miaow

- *(code)* Select the whole document on a second Cmd+A in code  @Lemon-miaow

- *(code)* Let code grow with the text size  @Lemon-miaow

- *(code)* Carry a selection over whole code lines to the block's edge  @Lemon-miaow

- *(code)* Draw the language list's arrow in the colour of the language  @Lemon-miaow

- *(code-block)* Size math and mermaid previews to their content  @Lemon-miaow

- *(code-block)* Undo through the document history and stop at its start  @Lemon-miaow

- *(dialogs)* Open Settings and Export only when no other dialog is up  @Lemon-miaow

- *(dialogs)* Draw a dialog that opens over another on top of it  @Lemon-miaow

- *(document)* Refuse to open files over 20 MiB  @Lemon-miaow

- *(document)* Count a document undone back to the saved one as saved  @Lemon-miaow

- *(drag)* Drop a dragged block only where it can stand  @Lemon-miaow

- *(drag)* Drop dragged text where the pointer is  @Lemon-miaow

- *(drag)* Drop a dragged block over a table or code block  @Lemon-miaow

- *(drag)* Forget a block drag let go away from the text  @Lemon-miaow

- *(drag)* Drop a dragged block let go under or beside the text  @Lemon-miaow

- *(drag-guard)* Match the image meta panel by its real class name  @Lemon-miaow

- *(editor)* Wrap table text in markdown tables  @Lemon-miaow

- *(editor)* Improve source mode scroll sync  @Lemon-miaow

- *(editor)* Restore dirty tracking on input  @Lemon-miaow

- *(editor)* Make code blocks and block spacing behave like prose  @Lemon-miaow

- *(editor)* Forbid style and form tags in html blocks and stop link navigation  @Lemon-miaow

- *(editor)* Flush source pane and mark dirty synchronously before save or close  @Lemon-miaow

- *(editor)* Refresh the source pane when the document is reloaded from disk  @Lemon-miaow

- *(editor)* Keep external reloads out of the undo history  @Lemon-miaow

- *(editor)* Keep textarea input inside the html block node view  @Lemon-miaow

- *(editor)* Debounce mermaid previews and re-render them from the document  @Lemon-miaow

- *(editor)* Keep lists tight, '-' markers and alert markers intact on save  @Lemon-miaow

- *(editor)* Focus the editor when a window opens  @Lemon-miaow

- *(editor)* Draw the gap cursor in its gap and keep the next block's margin  @Lemon-miaow

- *(editor)* Keep the hidden block handle from stretching the page  @Lemon-miaow

- *(editor)* Let Backspace take a block out of its quote or list  @Lemon-miaow

- *(editor)* Stop Delete from pulling a code block into the paragraph above  @Lemon-miaow

- *(editor)* Keep the caret in the editor on Shift+Tab  @Lemon-miaow

- *(editor)* Stop a hidden block handle from holding a shortened page open  @Lemon-miaow

- *(editor)* Show an inline SVG that has only a viewBox  @Lemon-miaow

- *(editor)* Say when an image can't load and show the path tried  @Lemon-miaow

- *(editor)* Show the source of an HTML block that renders nothing  @Lemon-miaow

- *(editor)* Name the opening block in the format bar right away  @Lemon-miaow

- *(editor)* Colour code for the light theme instead of One Dark's pale ink  @Lemon-miaow

- *(editor)* Run the active line's band through to the line numbers  @Lemon-miaow

- *(editor)* Carry the caret past images and rules and into code under it  @Lemon-miaow

- *(editor)* Give the caret a place above a block that opens the document  @Lemon-miaow

- *(editor)* Step into a table from either side of it instead of deleting it  @Lemon-miaow

- *(editor)* Take a whole block into a shift-arrow selection  @Lemon-miaow

- *(editor)* Keep the caret's place going into a formula or diagram  @Lemon-miaow

- *(editor)* Stop losing the next arrow press just after leaving code  @Lemon-miaow

- *(editor)* Put the caret below a rule typed as ---  @Lemon-miaow

- *(editor)* Start a code block from a typed fence inside a list  @Lemon-miaow

- *(editor)* Keep the caret in a line made a numbered list after code  @Lemon-miaow

- *(editor)* Let a table pasted on an empty line take its place  @Lemon-miaow

- *(editor)* Make Backspace at a heading's start give a paragraph  @Lemon-miaow

- *(editor)* Let Enter after a typed rule leave no empty line  @Lemon-miaow

- *(editor)* Let Enter after a typed image leave no empty line  @Lemon-miaow

- *(editor)* Let Delete select a rule or image before taking it  @Lemon-miaow

- *(editor)* Set a heading to the level typed in front of it  @Lemon-miaow

- *(editor)* Move past, select and replace html blocks like images  @Lemon-miaow

- *(editor)* Leave seven or more hashes typed as text  @Lemon-miaow

- *(editor)* Keep prices and shell variables out of inline math  @Lemon-miaow

- *(editor)* Keep single tildes as text and strike out only between pairs  @Lemon-miaow

- *(editor)* Type bold and italic the way markdown reads them, never in code  @Lemon-miaow

- *(editor)* Let the caret step out of code and links at the ends of a line  @Lemon-miaow

- *(editor)* Paste lines of code as a code block, not as markdown  @Lemon-miaow

- *(editor)* Drop the blank line under html blocks  @Lemon-miaow

- *(editor)* Keep the block handle by its block over inline html and math  @Lemon-miaow

- *(editor)* Keep a block selected from its handle selected  @Lemon-miaow

- *(editor)* Ring a selected block of text round its text  @Lemon-miaow

- *(editor)* Drop bracket and match marks from a code block the caret left  @Lemon-miaow

- *(editor)* Keep a formula or diagram drawn while it is picked up whole  @Lemon-miaow

- *(editor)* Ring a code block, table or picture picked up whole as text is  @Lemon-miaow

- *(editor)* Stop the page jumping as arrow keys take the caret across blocks  @Lemon-miaow

- *(editor)* Follow the caret a line at a time, clear of the format bar  @Lemon-miaow

- *(editor)* Size table columns by what they hold  @Lemon-miaow

- *(editor)* Keep a link written bare bare through a save  @Lemon-miaow

- *(editor)* Close the gap after an inline formula  @Lemon-miaow

- *(editor)* Wrap long lines in a code block, a row at a time under the arrows  @Lemon-miaow

- *(editor)* Let Cmd+Up and Cmd+Down go on from a code block's ends to the document's  @Lemon-miaow

- *(editor)* Take the caret into a table's cell under it from code or an image  @Lemon-miaow

- *(editor)* Take back a line at a time on Cmd+Z, in text and in code  @Lemon-miaow

- *(editor)* Keep the lines of pasted plain text as lines  @Lemon-miaow

- *(editor)* Undo a paste on its own, apart from what was typed around it  @Lemon-miaow

- *(editor)* Keep a block pasted into a line of text a block  @Lemon-miaow

- *(editor)* Paste into a table cell as one line, leaving the table whole  @Lemon-miaow

- *(editor)* Take the caret into a table or formula put in from the toolbar  @Lemon-miaow

- *(editor)* Put a block in from the toolbar after a code block or a table, leaving it whole  @Lemon-miaow

- *(editor)* Keep the caret where it was in a code block quoted from the toolbar  @Lemon-miaow

- *(editor)* Leave the caret after a link put on from the link box, so typing keeps the link  @Lemon-miaow

- *(editor)* Put the address typed in the link box in at the caret when no text is selected  @Lemon-miaow

- *(editor)* Keep the slash menu inside the page, as tall as the room by its line  @Lemon-miaow

- *(editor)* Close the format bar's heading list on Escape or a key typed  @Lemon-miaow

- *(editor)* Rank the code block's language search, its own language kept in it  @Lemon-miaow

- *(editor)* Choose, move and close in a code block's language list from the keys  @Lemon-miaow

- *(editor)* Write a language chosen from the list as a fence word that reads back  @Lemon-miaow

- *(editor)* Open a code block's language list over its button where under has no room  @Lemon-miaow

- *(editor)* Highlight a code block fenced by its file extension, as py, rs and md  @Lemon-miaow

- *(editor)* Indent code by four spaces in Python, Rust and the C family, and by a tab in Go  @Lemon-miaow

- *(editor)* Start a code block in a list item on the space after its fence  @Lemon-miaow

- *(editor)* Leave the gap above a block in a list item below it too  @Lemon-miaow

- *(editor)* Start a formula from $$ and Enter in a list item  @Lemon-miaow

- *(editor)* Make a table of a row typed in a list item, under the item above  @Lemon-miaow

- *(editor)* Save a blank line after a table, quote or nested list in a tight list item  @Lemon-miaow

- *(editor)* Leave the caret on a line under a pasted image, in a list item too  @Lemon-miaow

- *(editor)* Delete the letter after the caret at the start of a list item  @Lemon-miaow

- *(editor)* Select an image above the line in a list item before Backspace takes it  @Lemon-miaow

- *(editor)* Move back a cell on Shift+Tab in a table in a list item  @Lemon-miaow

- *(editor)* Tint code, formulas and tables in a list or quote when the selection covers them  @Lemon-miaow

- *(editor)* Put a rule typed in a list item under the item above  @Lemon-miaow

- *(editor)* Put a block from the toolbar on an empty list line under the item above  @Lemon-miaow

- *(editor)* Make the first line of a list item code or a quote from the toolbar  @Lemon-miaow

- *(editor)* Start a quote from > typed at the start of a list item  @Lemon-miaow

- *(editor)* Toggle lists and quotes from the toolbar and light their buttons  @Lemon-miaow

- *(editor)* Pass over a footnote mark with the arrow keys as over a letter  @Lemon-miaow

- *(editor)* Leave the caret outside a link or code just pasted, for what is typed next  @Lemon-miaow

- *(editor)* Keep the column a run of up and down arrows set out from across tables and code  @Lemon-miaow

- *(editor)* Move a highlight down a code block's language list and keep typing in its search  @Lemon-miaow

- *(editor)* Keep the caret at a line's end on Cmd and an arrow beside an image or a rule  @Lemon-miaow

- *(editor)* Carry Option and an arrow past an image or a rule as the arrow alone goes  @Lemon-miaow

- *(editor)* Give a website typed bare in the link box its https and an email its mailto  @Lemon-miaow

- *(editor)* Take out the line the block handle's plus put in when the caret leaves it empty  @Lemon-miaow

- *(editor)* Draw the caret as a plain bar at the edge of a mark and blink it as the Mac does  @Lemon-miaow

- *(editor)* Give back the markdown typed on Cmd+Z straight after it became a heading, list, quote or mark  @Lemon-miaow

- *(editor)* Let the arrows pass the edges of bold, italic, strikes and links in one press  @Lemon-miaow

- *(editor)* Take the caret to the start and end of the line with Home and End in text as in code  @Lemon-miaow

- *(editor)* Draw the caret at the end of a wrapped line after End, a click past it or typing there  @Lemon-miaow

- *(editor)* Keep the column a run of up and down arrows set out from past code and formulas  @Lemon-miaow

- *(editor)* Let Option and an arrow leave a code block at its edge for the word past it  @Lemon-miaow

- *(editor)* Stop Option and an arrow on each side of a formula as on a word  @Lemon-miaow

- *(editor)* Step an empty item of a nested list out a level on Enter wherever it stands  @Lemon-miaow

- *(editor)* Join a line after a nested list to the line above on Backspace  @Lemon-miaow

- *(editor)* Take an empty line out of a quote on Enter wherever it stands  @Lemon-miaow

- *(editor)* Leave a task added under one ticked off open on Enter  @Lemon-miaow

- *(editor)* Move the caret on ⌃N ⌃P ⌃F ⌃B as the arrow keys do  @Lemon-miaow

- *(editor)* Pick the block whose name starts with what follows the slash  @Lemon-miaow

- *(editor)* Join an item to one ending in code on Backspace as to any other  @Lemon-miaow

- *(editor)* Hold Tab in an item that cannot go further in  @Lemon-miaow

- *(editor)* Place the caret on the line nearest a click beside or between the text  @Lemon-miaow

- *(editor)* Open a link's address selected for a new one to replace it  @Lemon-miaow

- *(editor)* Put the selection back when the link box is closed with Escape  @Lemon-miaow

- *(editor)* Start and end code at the caret with Cmd+E as the toolbar's button does  @Lemon-miaow

- *(editor)* Have the quote, list and code keys do what their toolbar buttons do  @Lemon-miaow

- *(editor)* Join a list made from the toolbar or its keys to a list of its kind beside it  @Lemon-miaow

- *(editor)* Stand the block handle beside the first line of a list item, quote or wrapped paragraph  @Lemon-miaow

- *(editor)* Carry the caret up out of an alert past its hidden marker  @Lemon-miaow

- *(editor)* Leave a table for the column the caret was in when a list or quote is next to it  @Lemon-miaow

- *(editor)* Go into the cell under the caret from a list or quote next to a table  @Lemon-miaow

- *(editor)* Start a new footnote when one is typed on the line under another  @Lemon-miaow

- *(editor)* Keep the column when the caret goes up or down onto a footnote  @Lemon-miaow

- *(editor)* Keep the column when the caret goes down onto an alert  @Lemon-miaow

- *(editor)* Run lines of Chinese on with no space where the Markdown breaks them  @Lemon-miaow

- *(editor)* Put bold and the other formats on all of a mixed selection  @Lemon-miaow

- *(editor)* Leave the start of a line be on Tab where its spaces cannot be saved  @Lemon-miaow

- *(editor)* Filter the slash menu by a word typed with an input method  @Lemon-miaow

- *(editor)* Keep an image's title its own when it is pasted  @Lemon-miaow

- *(editor)* Keep the language of code pasted from a web page and drop its trailing blank line  @Lemon-miaow

- *(editor)* Keep a code block at the edge of a paste a block of its own  @Lemon-miaow

- *(editor)* Keep a fence that pasted Markdown ends with a block of its own  @Lemon-miaow

- *(editor)* Keep the caret in code pasted on an empty line or at the end of one  @Lemon-miaow

- *(editor)* Leave the toolbar's link button idle in code, as Cmd+K is  @Lemon-miaow

- *(editor)* Keep the caret in the page on a press between the format bar's buttons  @Lemon-miaow

- *(editor)* Leave the caret under an image or a rule put in from the slash menu  @Lemon-miaow

- *(editor)* Give the caret to a table or formula put in from the slash menu above code  @Lemon-miaow

- *(editor)* Start a new line on Shift+Enter in a heading, as Enter does  @Lemon-miaow

- *(editor)* Open a link's box under a line just below the format bar  @Lemon-miaow

- *(editor)* Save a formula between $$ lines once the file is edited  @Lemon-miaow

- *(editor)* Draw an image's preview and confirm button as its address is typed  @Lemon-miaow

- *(editor)* Give the caret to the line under an image once its address is given  @Lemon-miaow

- *(editor)* Take a cmd-click on a link to #heading to that heading  @Lemon-miaow

- *(editor)* Put text typed over blocks where backspace leaves the caret  @Lemon-miaow

- *(editor)* Give each selected line its own item with the list buttons  @Lemon-miaow

- *(editor)* Type with the marks of the letter an arrow went over onto code's edge  @Lemon-miaow

- *(editor)* Drop the empty line under a pasted image once the caret leaves it  @Lemon-miaow

- *(editor)* Keep Tab out of a closed image panel's fields  @Lemon-miaow

- *(editor)* Bring the caret into sight after any edit from the keyboard  @Lemon-miaow

- *(editor)* Keep images, formulas and line breaks in a file when the text around them is made code  @Lemon-miaow

- *(editor)* Keep the bold and line breaks typed in a link's text  @Lemon-miaow

- *(editor)* Keep a slash menu closed by Escape closed  @Lemon-miaow

- *(editor)* Keep the icons of the handles in the middle at any type size  @Lemon-miaow

- *(editor)* Keep a small heading made of two lines on one line  @Lemon-miaow

- *(editor)* Bring the caret into sight on Home and End  @Lemon-miaow

- *(editor)* Keep numbered items typed over into a bulleted list numbered  @Lemon-miaow

- *(editor)* Bring the caret into sight on Cmd and an arrow  @Lemon-miaow

- *(export)* Keep print styles for the fallback print and always restore the editor afterwards  @Lemon-miaow

- *(export)* Default to the region's paper size and match the app's controls  @Lemon-miaow

- *(export)* Keep to the one PDF dialog when Cmd+P is pressed again  @Lemon-miaow

- *(export)* Print a PDF in the light theme while the window shows the dark one  @Lemon-miaow

- *(export)* Offer the PDF under the document's name  @Lemon-miaow

- *(export)* Leave a formula's source and find's highlights off the PDF  @Lemon-miaow

- *(export)* Print from source mode without rebuilding the source pane  @Lemon-miaow

- *(files)* Atomic save, strict UTF-8 read and BOM/EOL round trip  @Lemon-miaow

- *(files)* Rewrite local attachment references when the document is saved elsewhere  @Lemon-miaow

- *(files)* Move image and link paths only after Save As has written the file  @Lemon-miaow

- *(files)* Hold auto-save while the reload question for an outside change is open  @Lemon-miaow

- *(files)* Count a document whose file was deleted or moved away as unsaved  @Lemon-miaow

- *(files)* Move the addresses in HTML with the file on Save As  @Lemon-miaow

- *(files)* Leave a read-only file as it is on save and say why  @Lemon-miaow

- *(files)* Keep a file's Finder tags and other extended attributes through a save  @Lemon-miaow

- *(footnote)* Keep a line break typed inside a footnote mark's brackets  @Lemon-miaow

- *(footnote)* Keep a footnote mark that starts a line before a colon in its paragraph  @Lemon-miaow

- *(fs)* Give the fs capability a scope and allow document paths at runtime  @Lemon-miaow

- *(glass)* Blur the backdrop at a set radius so its shapes show through  @Lemon-miaow

- *(html)* Follow the UI language in the lang attribute and add a favicon  @Lemon-miaow

- *(html)* Render inline html tags inline instead of as a block  @Lemon-miaow

- *(html)* Show images an HTML block takes from beside the document  @Lemon-miaow

- *(i18n)* Translate the status bar mode and the untitled document name  @Lemon-miaow

- *(i18n)* Translate the editor's block menus, code block and link placeholders  @Lemon-miaow

- *(i18n)* Translate the release notes heading  @Lemon-miaow

- *(i18n)* Write one ellipsis character where menus and buttons trail off  @Lemon-miaow

- *(image)* Keep an image's alt text through a save  @Lemon-miaow

- *(image)* Tint just the picture when an image is selected  @Lemon-miaow

- *(image)* Hand the caret back to the document when the info panel closes  @Lemon-miaow

- *(image)* Follow undo and redo of a resize with the image's height  @Lemon-miaow

- *(image)* Open an image with no title or alt text with empty ones  @Lemon-miaow

- *(image-meta)* Locate images by dom position, batch rescans per frame and respect IME input  @Lemon-miaow

- *(images)* Stop Base64 embedding before a document outgrows what NyaMark opens  @Lemon-miaow

- *(images)* Keep the image dialog in reach in a short window  @Lemon-miaow

- *(ime)* Leave the Enter or Escape that commits a composition to the input method  @Lemon-miaow

- *(launch)* Open a relative path from the folder the second launch ran in  @Lemon-miaow

- *(links)* Open local attachments via scoped command and whitelist link schemes  @Lemon-miaow

- *(links)* Spell out a bold bare link that text follows past its stars  @Lemon-miaow

- *(links)* Keep a bare link bare when copied and pasted  @Lemon-miaow

- *(list)* Keep what is under an emptied list item on save  @Lemon-miaow

- *(list)* Keep a nested list under an empty line inside an item on save  @Lemon-miaow

- *(list)* Keep the boxes of a task list pasted from a page  @Lemon-miaow

- *(macos)* Mark windows with unsaved changes as edited  @Lemon-miaow

- *(markdown)* Drop empty lines at the end of a saved file  @Lemon-miaow

- *(markdown)* Leave out the space a split leaves at the start of a block  @Lemon-miaow

- *(markdown)* Keep an indent typed at the start of a paragraph  @Lemon-miaow

- *(markdown)* Line up saved CJK tables by display width  @Lemon-miaow

- *(markdown)* Save an emptied table cell blank instead of as a br tag  @Lemon-miaow

- *(markdown)* Save underscores inside words and hashtags unescaped  @Lemon-miaow

- *(markdown)* Save stars and underscores between spaces unescaped  @Lemon-miaow

- *(markdown)* Escape ampersands only where they would start a reference  @Lemon-miaow

- *(markdown)* Keep the bullet of a list opening a quote after a list  @Lemon-miaow

- *(markdown)* Save a link written bare without angle brackets again  @Lemon-miaow

- *(markdown)* Keep the front matter a file opens with through a save  @Lemon-miaow

- *(markdown)* Write a bracket that starts no link as typed  @Lemon-miaow

- *(markdown)* Write equals signs at the start of a line as typed when they underline nothing  @Lemon-miaow

- *(markdown)* Write an emptied list item as its bare marker  @Lemon-miaow

- *(markdown)* Keep an email address bare before Chinese punctuation  @Lemon-miaow

- *(markdown)* Write a rule that opens the file so it reopens as a rule  @Lemon-miaow

- *(markdown)* Escape text that ends in a space so it reopens as typed  @Lemon-miaow

- *(markdown)* Write a space typed in italics or bold as a plain space  @Lemon-miaow

- *(markdown)* Read bold beside Chinese punctuation as bold when a file reopens  @Lemon-miaow

- *(markdown)* Keep an emptied first sub-item from turning its parent into a heading  @Lemon-miaow

- *(markdown)* Keep bold, italics and links whole around the marks inside them on save  @Lemon-miaow

- *(markdown)* Keep bold and italics that end on a stop next to a letter on save  @Lemon-miaow

- *(markdown)* Keep italics on a link in bold on save  @Lemon-miaow

- *(markdown)* Open one tilde beside Chinese text as text  @Lemon-miaow

- *(markdown)* Save a paragraph that ends in line breaks without a stray backslash  @Lemon-miaow

- *(markdown)* Keep bold whole past a link all in bold  @Lemon-miaow

- *(markdown)* Escape a dollar before an escaped character as text  @Lemon-miaow

- *(markdown)* Keep what a code fence names after its language  @Lemon-miaow

- *(math)* Open a formula in a line for editing with Enter  @Lemon-miaow

- *(math)* Edit a formula in a line on a click or a key, and leave the caret past it once saved  @Lemon-miaow

- *(math)* Keep a line break or image typed between two dollars  @Lemon-miaow

- *(menu)* Open the macOS menu in the system language instead of English  @Lemon-miaow

- *(mermaid)* Keep the last diagram under a parse error while typing  @Lemon-miaow

- *(mermaid)* Drop a typing render the block has since outgrown  @Lemon-miaow

- *(outline)* Refresh from document changes instead of a one-second rebuild  @Lemon-miaow

- *(outline)* Take the source pane to a heading clicked in source mode  @Lemon-miaow

- *(outline)* Find a heading named like an app element in the document  @Lemon-miaow

- *(outline)* Show a heading of a formula or an image alone and go to it  @Lemon-miaow

- *(paste)* Treat plain text as a file list only when every line is a file uri  @Lemon-miaow

- *(paste)* Keep a list pasted from Word a list  @Lemon-miaow

- *(pdf)* Keep the top of the export dialog in sight in a short window  @Lemon-miaow

- *(platform)* Take the OS from the native side instead of the user agent  @Lemon-miaow

- *(quit)* Keep every window open when a quit's unsaved-changes prompt is cancelled  @Lemon-miaow

- *(release)* Ship a separate updater bundle for each Mac  @Lemon-miaow

- *(save)* Run saves one at a time so auto-save and manual save never race  @Lemon-miaow

- *(save)* Tell the user when auto-save fails, once per failure streak  @Lemon-miaow

- *(save)* Keep a bare link whole beside what follows it  @Lemon-miaow

- *(save)* Escape a stop before a www link written in brackets  @Lemon-miaow

- *(save)* Escape dollars on either side of a bold or link edge  @Lemon-miaow

- *(search)* Search the document model instead of window.find and keep the selection on close  @Lemon-miaow

- *(search)* Scroll to a match above or below the page  @Lemon-miaow

- *(search)* Hang the find bar under the formatting bar, clear of the outline  @Lemon-miaow

- *(search)* Open the document search with Cmd+F from a code block  @Lemon-miaow

- *(search)* Highlight matches inside code blocks  @Lemon-miaow

- *(search)* Let Escape close the box it is pressed in before the find bar  @Lemon-miaow

- *(search)* Give source mode its own find bar and close the preview's  @Lemon-miaow

- *(search)* Leave the hidden marker of an alert out of the matches  @Lemon-miaow

- *(search)* Scroll to a match far down a long code block  @Lemon-miaow

- *(search)* Count ?/N while no match is current  @Lemon-miaow

- *(search)* Step to the next match on Cmd+G and back on Cmd+Shift+G  @Lemon-miaow

- *(security)* Set CSP, drop withGlobalTauri, scope asset protocol and guard navigation  @Lemon-miaow

- *(sessions)* Recover poisoned locks instead of panicking on every later call  @Lemon-miaow

- *(settings)* Sync settings across windows and keep the theme preference in them  @Lemon-miaow

- *(settings)* Back up an unreadable settings file and say so instead of resetting silently  @Lemon-miaow

- *(settings)* Validate attachment settings and fall back on malformed values  @Lemon-miaow

- *(settings)* Draw the dropdown menu from theme tokens  @Lemon-miaow

- *(settings)* Give the dropdown listbox semantics and keyboard control  @Lemon-miaow

- *(settings)* Show the theme picked in the settings while they are open  @Lemon-miaow

- *(settings)* Write back only the settings changed in the dialog  @Lemon-miaow

- *(settings)* Put back a font size typed and then cancelled  @Lemon-miaow

- *(settings)* Press OK with Return in a number field  @Lemon-miaow

- *(shell)* Keep the window's styles off a heading named App or Statusbar  @Lemon-miaow

- *(shortcuts)* Route every shortcut through one controller with the platform modifier  @Lemon-miaow

- *(shortcuts)* Leave the keys to an open dialog  @Lemon-miaow

- *(shortcuts)* Read a shortcut's letter from the keyboard layout  @Lemon-miaow

- *(slash)* Filter the menu by the words an input method types  @Lemon-miaow

- *(slash)* Keep a dismissed menu closed when the find bar closes  @Lemon-miaow

- *(source)* Leave the source pane as typed through a save  @Lemon-miaow

- *(source)* Mark the document unsaved on the first key typed in the source pane  @Lemon-miaow

- *(source)* Indent with Tab in the source pane  @Lemon-miaow

- *(source)* Undo a source edit back at the change in the editor  @Lemon-miaow

- *(source)* Keep the caret and undo history through a reload from disk  @Lemon-miaow

- *(source)* Let the first line of code in the preview run to the edge  @Lemon-miaow

- *(source)* Read the source pane as GitHub Markdown  @Lemon-miaow

- *(source)* Leave a list with a blank line on Enter at an empty item  @Lemon-miaow

- *(source-mode)* Drop scroll listeners on exit and sync edits as minimal replace steps  @Lemon-miaow

- *(source-mode)* Let the synced pane reach its top and bottom with the other  @Lemon-miaow

- *(source-mode)* Wrap long lines and colour markdown with the app's tokens  @Lemon-miaow

- *(source-mode)* Keep the caret and selection in place when switching modes  @Lemon-miaow

- *(source-mode)* Find and replace in a panel that matches the app's search  @Lemon-miaow

- *(statusbar)* Count CJK characters as words and label the line count as a total  @Lemon-miaow

- *(statusbar)* Stop counting the trailing newline as a line  @Lemon-miaow

- *(statusbar)* Leave alert markers out of the word count  @Lemon-miaow

- *(style)* Stop the native selection tinting a washed block a second time  @Lemon-miaow

- *(style)* Show a rule inside the selection as selected  @Lemon-miaow

- *(styles)* Show link and formula boxes above the top bar  @Lemon-miaow

- *(styles)* Keep the formula box off the window edge  @Lemon-miaow

- *(styles)* Centre the selection toolbar on the first line selected  @Lemon-miaow

- *(styles)* Tint dialog veils with a background colour that exists  @Lemon-miaow

- *(styles)* Give dialog buttons readable labels and an accent focus ring  @Lemon-miaow

- *(table)* Line up the columns and tighten the cell padding  @Lemon-miaow

- *(table)* Keep the clicked caret in a cell and the column on ArrowUp/Down  @Lemon-miaow

- *(table)* Keep the caret's column when arrowing into and out of a table  @Lemon-miaow

- *(table)* Add a row on Tab in the last cell and reuse the line below on Enter  @Lemon-miaow

- *(table)* Leave a table from the start of a cell at the start of the line  @Lemon-miaow

- *(table)* Move Enter down a row and leave from an empty last row  @Lemon-miaow

- *(table)* Keep an unaligned column unaligned through copy and paste  @Lemon-miaow

- *(table)* Keep the alignment of a table pasted from a page made from Markdown  @Lemon-miaow

- *(table)* Move a row or column dragged by its handle  @Lemon-miaow

- *(tables)* Start a row added with Enter from its first cell  @Lemon-miaow

- *(theme)* Hand the window back to the system theme when following it  @Lemon-miaow

- *(theme)* Draw the icons of Crepe's menus in the toolbar's colours  @Lemon-miaow

- *(theme)* Draw the tick of the link and formula boxes in the page's greys  @Lemon-miaow

- *(toolbar)* Keep the selection toolbar and link popups off the window edge  @Lemon-miaow

- *(toolbar)* Keep the selection toolbar off the format bar  @Lemon-miaow

- *(toolbar)* Set the selection toolbar by the lines of text selected  @Lemon-miaow

- *(toolbar)* Hide the selection toolbar once an input method types over the selection  @Lemon-miaow

- *(ui)* Share modal focus, Escape and backdrop handling across dialogs  @Lemon-miaow

- *(ui)* Let Escape close only the most recently opened panel or dialog  @Lemon-miaow

- *(ui)* Keep the room under the end of a long document  @Lemon-miaow

- *(ui)* Keep Tab and Shift+Tab going round a dialog's own controls  @Lemon-miaow

- *(ui)* Pin or free the window when the theme setting changes and its mode does not  @Lemon-miaow

- *(ui)* Name the theme in the interface's language and say if it follows the system  @Lemon-miaow

- *(ui)* Ring a dialog's choice card and its checkbox line, and keep the ring as the arrows move  @Lemon-miaow

- *(ui)* Show an update's notes as headings and a list of changes  @Lemon-miaow

- *(ui)* Keep focus in the update dialog while its buttons are off, and give it back to them  @Lemon-miaow

- *(ui)* Say under the update's title when it failed or is installed  @Lemon-miaow

- *(ui)* Ring the PDF scale slider with its value in a rounded ring  @Lemon-miaow

- *(updates)* Check from one window only, skip dev builds and lock the dialog while downloading  @Lemon-miaow

- *(updates)* Ask for unsaved documents to be saved before the Windows installer runs  @Lemon-miaow

- *(updates)* Give up a download that stops receiving data  @Lemon-miaow

- *(watch)* Debounce external change events so a save in progress is not read half-written  @Lemon-miaow

- *(watch)* Watch the document's folder so rename-based saves from other editors keep being seen  @Lemon-miaow

- *(window)* Prompt for unsaved changes on close, quit and updater restart  @Lemon-miaow

- *(windows)* Report window build failures instead of only logging them  @Lemon-miaow

- *(windows)* Let a window close once its close request is answered  @Lemon-miaow

- *(windows)* Bring forward the window already editing a file that is opened again  @Lemon-miaow

- Fix tauri action ci  @Lemon-miaow

- File path  @Mashirl

- Add environment variables for Tauri signing  @Mashirl

- Update ci  @Mashirl

- Address audit P0/P1 findings (security, build config, attachment wiring) (#2)  @FLYEMOJ1

- Code Audit, Fixes, Security for Possible Code Injection, file-controller, Visual Diff (#4)  @FLYEMOJ1


### 🚜 Refactor

- *(app)* Move pdf export, auto-save, language sync and the theme toggle out of bootstrap  @Lemon-miaow

- *(attachments)* Use one basename helper for file names  @Lemon-miaow

- *(bridge)* Route every Tauri call through the bridge layer  @Lemon-miaow

- *(editor)* Drop the never-called destroy path  @Lemon-miaow

- *(lint)* Fix the remaining biome errors  @Lemon-miaow

- *(styles)* Move stylesheets into css files and honour reduced motion  @Lemon-miaow

- *(styles)* Name the page-level z-index layers and lift resize handles above the titlebar  @Lemon-miaow

- *(tauri)* Migrate custom backends to plugins  @Lemon-miaow

- *(tauri)* Clear clippy warnings  @Lemon-miaow

- *(ui)* Wait for the real exit animation instead of per-dialog sleeps  @Lemon-miaow


### 🚀 Performance

- *(alerts)* Update decorations only for changed blocks and localize alert labels  @Lemon-miaow

- *(mermaid)* Load mermaid on the first diagram instead of with the editor  @Lemon-miaow

- *(state)* Skip no-op store updates and reuse the serialized markdown for stats  @Lemon-miaow


### 📚 Documentation

- Update README.md  @Lemon-miaow

- List the current features and name the real icon paths in the license  @Lemon-miaow


### 🎨 Styling

- *(dialogs)* Size dialog buttons at 13px like the text around them  @Lemon-miaow

- *(editor)* Tie inline marks and list markers to the text metrics  @Lemon-miaow

- *(editor)* Set a formula in its block without KaTeX's display margins  @Lemon-miaow

- *(editor)* Give a table's handles and their menu an edge and readable icons in the dark  @Lemon-miaow

- *(editor)* Give the slash menu, the heading list and the link boxes an edge in the dark  @Lemon-miaow

- *(editor)* Set a footnote's number in front of its text  @Lemon-miaow

- *(editor)* Set an image's input hints lighter than what is typed  @Lemon-miaow

- *(editor)* Select text in the accent wash that code and tables take under a selection  @Lemon-miaow

- *(editor)* Draw the caret in code as thick as in text and blink it at the same pace  @Lemon-miaow

- *(editor)* Wash a formula in a line whole when a selection runs over it  @Lemon-miaow

- *(editor)* Wash a piece of code in a line whole when a selection takes it  @Lemon-miaow

- *(editor)* Take the page all the way up when the caret reaches the first line  @Lemon-miaow

- *(editor)* Hide the selection a code block had once the caret leaves it  @Lemon-miaow

- *(editor)* Leave the numbers of a list out of the selection as its bullets are  @Lemon-miaow

- *(editor)* Round a formula picked out alone as a piece of code is  @Lemon-miaow

- *(editor)* Take the page all the way down when the caret reaches the last line  @Lemon-miaow

- *(editor)* Show a picture in a line that fails to load as its name marked broken  @Lemon-miaow

- *(editor)* Give a formula in a line the colour of the text around it  @Lemon-miaow

- *(editor)* Space an alert from the blocks around it as evenly as a quote  @Lemon-miaow

- *(editor)* Space an HTML block from its neighbours as evenly as the other blocks  @Lemon-miaow

- *(editor)* Size the HTML source box as a code block, one line of source one line high  @Lemon-miaow

- *(editor)* Drop the selection wash over HTML source being edited  @Lemon-miaow

- *(editor)* Hold the slash menu under the slash while its filter is typed  @Lemon-miaow

- *(editor)* Name the code block or formula in the format bar's heading list  @Lemon-miaow

- *(editor)* Keep a list number of two digits or more on one line  @Lemon-miaow

- *(editor)* Back a diagram's edge labels so their lines stop at the text  @Lemon-miaow

- *(export)* Narrow the PDF dialog to 560px to keep its labels near their controls  @Lemon-miaow

- *(export)* End the scale value where the dropdowns and switch above it end  @Lemon-miaow

- *(glass)* Draw faint lines and labels in ink over the frosted window  @Lemon-miaow

- *(glass)* Tint the frosted window more so its text reads clearly  @Lemon-miaow

- *(i18n)* Word prompts and errors in a plain documentation tone  @Lemon-miaow

- *(search)* Keep the find field still as its count changes  @Lemon-miaow

- *(settings)* Show the image policy chosen in the accent, as the paste dialog does  @Lemon-miaow

- *(settings)* Start the fields where the title and the buttons start  @Lemon-miaow

- *(settings)* Show the range hint in the gap under its field to even out the rows  @Lemon-miaow

- *(source)* Show the fold arrows while the pointer is over the gutter  @Lemon-miaow

- *(titlebar)* Draw the Windows and Linux buttons as small round icons  @Lemon-miaow

- *(toolbar)* Set the block name against its chevron  @Lemon-miaow

- *(ui)* Ring every control a dialog's Tab reaches in the accent its buttons use  @Lemon-miaow

- Apply biome formatting and import order  @Lemon-miaow


### 🧪 Testing

- *(attachments)* Cover paste dedup, partial failures, the Base64 limit and the front matter folder  @Lemon-miaow

- *(editor)* Walk the marked line with for...of, as the linter asks  @Lemon-miaow

- *(files)* Cover save ordering, failure reporting and external changes  @Lemon-miaow

- *(i18n)* Keep translated strings out of innerHTML templates  @Lemon-miaow

- *(source-mode)* Cover the scroll sync mapping  @Lemon-miaow


### ⚙️ CI

- *(release)* Validate the tag, update the changelog on main and sync Cargo.lock  @Lemon-miaow

- Remove tauri action workflows  @Lemon-miaow

- Remove redundant artifact workflow  @Lemon-miaow

- Gate on biome, rustfmt, clippy and cargo test  @Lemon-miaow

- Drop the scheduled format job that pushed to main  @Lemon-miaow


### 🔧 Chore

- *(brand)* Switch to the cat-ear logo  @Lemon-miaow

- *(capabilities)* Drop the window default already covered by core:default  @Lemon-miaow

- *(patches)* Drop the empty bun tag files from the components patch  @Lemon-miaow

- Sync test workflow and upload artifacts  @Lemon-miaow

- Upgrade tauri action to v1  @Lemon-miaow

- Upload artifacts after a test is done  @Mashirl


### Build

- *(cargo)* Add a release profile with lto, single codegen unit, abort and strip  @Lemon-miaow

- *(vite)* Set the webview target, minify, sourcemap and env prefix  @Lemon-miaow


### 📦 Dependencies

- *(deps)* Drop unused packages and the CodeMirror version pins  @Lemon-miaow


## 1.0.0-beta.4 (2026-05-11)

### 🐛 Bug Fixes

- Dark mode transparency effects  @Lemon-miaow


### 🚜 Refactor

- Improve transparency effects  @Lemon-miaow

- Refine the settings panel style  @Lemon-miaow


### 🔧 Chore

- Update CHANGELOG.md [skip ci]  @github-actions[bot]

## 1.0.0-beta.3 (2026-05-10)

### 🐛 Bug Fixes

- Transparency rendering bug  @Lemon-miaow

## 1.0.0-beta.2 (2026-05-10)

### 🐛 Bug Fixes

- Transparency rendering bug  @Lemon-miaow


### ⚙️ CI

- Include the platform name in the artifact filename  @Lemon-miaow

## 1.0.0-beta.1 (2026-05-10)

### ✨ Features

- *(CI)* Add GitHub Actions workflow for release automation  @FLYEMOJ1

- *(CI)* Change Actions Checkout Version  @FLYEMOJ1

- [**breaking**] Re? RE!  @Lemon-miaow

- Configuration  @Lemon-miaow

- Add Linux-specific styles and resize handles, and configure Linux window settings  @FLYEMOJ1

- Save as  @Lemon-miaow

- Icons  @Lemon-miaow

- Implement disk file change detection and raw HTML block editing  @Lemon-miaow

- Source mode preview follow the scroll  @Lemon-miaow

- Biome & auto fmt ci  @Lemon-miaow

- Implement optional file associations and single-instance support  @Lemon-miaow

- I18n  @Lemon-miaow


### 🐛 Bug Fixes

- *(CI)* Tauri-action@v?  @FLYEMOJ1

- Clippy stfu  @FLYEMOJ1

- Make settings config actually work  @Lemon-miaow

- Target save actions to the focused window  @Lemon-miaow

- Missing files  @Lemon-miaow

- Target menu actions to the focused window  @Lemon-miaow

- Source mode style  @Lemon-miaow

- Ts lint  @Lemon-miaow

- Biome ignore  @Lemon-miaow

- Bubble menu style  @Lemon-miaow


### 📚 Documentation

- README.md  @Lemon-miaow

- LICENSE  @Lemon-miaow

- Update README.md  @Lemon-miaow

- Update README.md  @Lemon-miaow

- Update banner.svg  @Lemon-miaow

- Update README.md  @Lemon-miaow

- Update README_EN.md  @Lemon-miaow

- Update README.md  @Lemon-miaow


### ⚙️ CI

- Release ci  @Lemon-miaow

- Git cliff  @Lemon-miaow

- Test ci  @Lemon-miaow

- Fix ci version  @Lemon-miaow

- Fix linux arm64 build  @Lemon-miaow

- Auto update CHANGLOG.md  @Lemon-miaow

- Fix release  @Lemon-miaow


### 🔧 Chore

- Reset versions to dev  @Lemon-miaow

- Fmt  @Lemon-miaow

- Fmt  @Lemon-miaow


### 🔒 Security

- Project it self, Cargo, GUI, Markdown Modules, Action CI  @FLYEMOJ1


### Format

- Rustfmt stfu  @FLYEMOJ1

