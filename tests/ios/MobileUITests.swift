import XCTest

final class MobileUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        // Tauri's debug stderr redirector recurses through Xcode 27's log mirror.
        app.launchEnvironment["OS_ACTIVITY_MODE"] = "disable"
        app.launch()
        XCTAssertTrue(button(["设置", "Settings"]).waitForExistence(timeout: 45))
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
        app.terminate()
    }

    private func button(_ labels: [String]) -> XCUIElement {
        // WebKit exposes pressed buttons as switches and menu buttons as popups.
        app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", labels)).firstMatch
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testLaunchAndFileSheet() throws {
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        capture("01-native-editor")
        button(["文件", "File"]).tap()
        XCTAssertTrue(button(["另存为", "Save As"]).waitForExistence(timeout: 5))
        capture("02-file-sheet")
        button(["关闭", "Close"]).tap()
        XCTAssertTrue(button(["设置", "Settings"]).isHittable)
    }

    func testSourceKeyboardAndOutline() throws {
        button(["源码", "Source"]).tap()
        let source = app.textViews.firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        source.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(app.keyboards.firstMatch.keys.count, 10)
        button(["Next keyboard", "下一个键盘", "下一键盘"]).press(forDuration: 1)
        let english = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS[c] 'English (US)' OR label CONTAINS '英语（美国）'"))
            .firstMatch
        XCTAssertTrue(english.waitForExistence(timeout: 5), app.debugDescription)
        english.tap()
        let markdown = "# Native keyboard test\n\nWriting on a small screen."
        source.typeText(markdown)
        XCTAssertEqual((source.value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), markdown)
        capture("03-source-with-keyboard")
        let hideKeyboard = button(["收起键盘", "Hide keyboard"])
        XCTAssertTrue(hideKeyboard.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(hideKeyboard.frame.minY, button(["保存", "Save"]).frame.maxY)
        hideKeyboard.tap()
        let hidden = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 5), .completed)
        button(["源码", "Source"]).tap()
        let outline = button(["大纲", "Outline"])
        XCTAssertTrue(outline.waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        outline.tap()
        let heading = button(["Native keyboard test"])
        capture("04-outline")
        XCTAssertTrue(heading.waitForExistence(timeout: 10), app.debugDescription)
        heading.tap()
        XCTAssertTrue(button(["设置", "Settings"]).waitForExistence(timeout: 5))
    }

    func testSettingsAndLandscape() throws {
        button(["设置", "Settings"]).tap()
        let cancel = button(["取消", "Cancel"])
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        XCTAssertTrue(cancel.isHittable)
        capture("05-settings")
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in self.app.frame.width > self.app.frame.height },
            object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 10), .completed)
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        XCTAssertTrue(cancel.isHittable)
        capture("06-settings-landscape")
        cancel.tap()
        XCTAssertTrue(button(["设置", "Settings"]).waitForExistence(timeout: 5))
    }

    func testAssistantSheetAndSettings() throws {
        button(["AI 助手", "AI assistant"]).tap()
        let settings = button(["打开 AI 设置", "Open AI settings"])
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture("07-assistant-sheet")
        settings.tap()
        let cancel = button(["取消", "Cancel"])
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        XCTAssertTrue(cancel.isHittable)
        cancel.tap()
        XCTAssertTrue(button(["设置", "Settings"]).waitForExistence(timeout: 5))
        XCTAssertFalse(settings.exists)
    }

    func testFormattingMenuAndFind() throws {
        app.textViews.firstMatch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        let format = button(["正文", "Text"])
        XCTAssertTrue(format.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(format.frame.minY, button(["保存", "Save"]).frame.maxY)
        XCTAssertLessThanOrEqual(format.frame.maxY, app.keyboards.firstMatch.frame.minY)
        format.tap()
        XCTAssertTrue(button(["标题 2", "Heading 2"]).waitForExistence(timeout: 5))
        capture("08-format-menu")
        format.tap()
        button(["收起键盘", "Hide keyboard"]).tap()
        XCTAssertTrue(button(["查找", "Find"]).waitForExistence(timeout: 5))
        button(["查找", "Find"]).tap()
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("test")
        let close = button(["关闭搜索", "Close search"])
        XCTAssertTrue(close.isHittable)
        capture("09-find")
        close.tap()
        let hidden = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 5), .completed)
    }

    func testNativeSelectionFormattingAndClipboard() throws {
        let rich = app.textViews.firstMatch
        rich.tap()
        rich.typeText("Mobile selection sample")
        let word = rich.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: 24, dy: 14))
        word.doubleTap()
        let copy = button(["复制", "Copy"])
        XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
        capture("10-native-selection")
        button(["Next Page", "下一页"]).tap()
        button(["格式", "Format"]).tap()
        button(["粗体", "Bold"]).tap()
        word.doubleTap()
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        copy.tap()
        button(["收起键盘", "Hide keyboard"]).tap()
        button(["源码", "Source"]).tap()
        let source = app.textViews.firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 5))
        XCTAssertEqual((source.value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                       "**Mobile** selection sample")
        // Select a different word in source and replace it through the system menu.
        let line = app.staticTexts["**Mobile** selection sample"].firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 5))
        line.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).doubleTap()
        let paste = button(["粘贴", "Paste"])
        XCTAssertTrue(paste.waitForExistence(timeout: 5), app.debugDescription)
        paste.tap()
        XCTAssertEqual((source.value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                       "**Mobile** selection Mobile")
        capture("11-native-clipboard")
    }

    func testNativeSelectionHandleDrag() throws {
        let rich = app.textViews.firstMatch
        rich.tap()
        rich.typeText("Mobile selection sample")
        let origin = rich.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: 24, dy: 14)).doubleTap()
        XCTAssertTrue(button(["复制", "Copy"]).waitForExistence(timeout: 5))
        origin.withOffset(CGVector(dx: 52, dy: 28)).press(
            forDuration: 0.15,
            thenDragTo: origin.withOffset(CGVector(dx: 210, dy: 14)))
        capture("12-native-selection-drag")
        rich.typeText("Replaced")
        XCTAssertEqual((rich.value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                       "Replaced")
    }
}
