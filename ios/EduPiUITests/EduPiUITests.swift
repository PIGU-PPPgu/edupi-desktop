import XCTest

@MainActor
final class EduPiUITests: XCTestCase {
    func testHomeTaskUpdateIsVisibleInWorkspace() {
        let app = launchPreview()
        let task = app.buttons["preview-task-1"]
        let detail = app.navigationBars["任务详情"]
        let content = app.scrollViews["task-detail"]
        let title = content.staticTexts["准备一次函数课堂练习"]
        let note = content.staticTexts["课堂练习加入两道从图像读斜率的题。"]

        expectVisible(task)
        capture("01-home", in: app)
        task.tap()
        expectVisible(detail)
        expectVisible(title)
        expectVisible(note)
        expectPresent(content.staticTexts["待确认"])
        capture("02-home-task-detail", in: app)

        app.buttons["更改状态"].tap()
        app.buttons["已完成"].tap()
        expectPresent(content.staticTexts["已完成"])
        detail.buttons["关闭"].tap()
        expectVisible(app.buttons["全部任务"])
        XCTAssertFalse(task.exists)

        selectTab("工作区", in: app)
        expectVisible(app.staticTexts["工作区"])
        expectVisible(task)
        capture("03-workspace", in: app)
        app.segmentedControls.buttons["已完成"].tap()
        expectVisible(task)
        XCTAssertFalse(app.buttons["preview-task-2"].exists)
        task.tap()
        expectVisible(detail)
        expectVisible(title)
        expectVisible(note)
        expectPresent(content.staticTexts["已完成"])
        capture("04-workspace-task-detail", in: app)

        detail.buttons["关闭"].tap()
        selectTab("首页", in: app)
        expectVisible(app.buttons["全部任务"])
        XCTAssertFalse(task.exists)
    }

    func testChatPreviewSendsAndStartsNewConversation() {
        let app = launchPreview()
        selectTab("AI 协作", in: app)
        expectVisible(app.staticTexts["本地对话预览"])
        capture("05-ai-chat", in: app)

        let message = "EduPi UI QA"
        let composer = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        let send = app.buttons["发送预览消息"]
        expectVisible(composer)
        XCTAssertFalse(send.isEnabled)
        composer.tap()
        composer.typeText(message)
        XCTAssertTrue(send.isEnabled)
        send.tap()
        expectVisible(app.staticTexts[message])
        XCTAssertFalse(send.isEnabled)
        capture("06-ai-chat-sent", in: app)

        app.buttons["新建"].tap()
        expectVisible(app.staticTexts["本地对话预览"])
        XCTAssertFalse(app.staticTexts[message].exists)
    }

    func testClassroomOpensStudentRecordAndReturns() {
        let app = launchPreview()
        selectTab("班级", in: app)
        expectVisible(app.textFields["student-search"])
        let student = app.buttons["preview-student-1"]
        expectVisible(student)
        capture("07-classroom", in: app)

        student.tap()
        let detail = app.navigationBars["学生档案"]
        expectVisible(detail)
        expectVisible(app.staticTexts["宋禾"])
        expectVisible(app.staticTexts["701 班"])
        let note = NSPredicate(format: "label CONTAINS %@", "下次课继续检查图像与解析式的对应。")
        expectVisible(app.staticTexts.containing(note).firstMatch)
        expectVisible(app.staticTexts["暂无记录"])
        capture("08-student-detail", in: app)

        detail.buttons.firstMatch.tap()
        expectVisible(student)
    }

    func testScheduleFiltersTimetableAndShowsLesson() {
        let app = launchPreview()
        selectTab("日程", in: app)
        let calendarItem = app.buttons["preview-calendar-1"]
        expectVisible(calendarItem)
        capture("09-schedule", in: app)

        let filters = app.segmentedControls
        filters.buttons["校历"].tap()
        expectVisible(calendarItem)
        filters.buttons["课表"].tap()
        let lesson = app.buttons["preview-slot-1"]
        expectVisible(lesson)
        expectVisible(app.buttons["preview-slot-2"])
        XCTAssertFalse(calendarItem.exists)
        capture("10-timetable", in: app)

        lesson.tap()
        let detail = app.navigationBars["课表安排"]
        let period = "周一 · 第2节"
        let content = app.scrollViews.containing(.staticText, identifier: period).firstMatch
        expectVisible(detail)
        expectVisible(content.staticTexts["数学"])
        expectPresent(content.staticTexts[period])
        expectPresent(content.staticTexts["701 班"])
        capture("11-lesson-detail", in: app)

        detail.buttons["关闭"].tap()
        expectVisible(lesson)
    }

    func testGuideCanCloseAndOpenDestination() {
        let app = launchPreview()
        let menu = app.buttons["本地预览菜单"]
        let guide = app.navigationBars["使用引导"]
        let scheduleLink = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "查看校历和每周课表")
        ).firstMatch

        menu.tap()
        app.buttons["使用引导"].tap()
        expectVisible(guide)
        expectVisible(scheduleLink)
        capture("12-guide", in: app)
        guide.buttons["关闭"].tap()
        expectVisible(menu)
        XCTAssertFalse(guide.exists)

        menu.tap()
        app.buttons["使用引导"].tap()
        expectVisible(scheduleLink)
        scheduleLink.tap()
        expectVisible(app.buttons["preview-calendar-1"])
        XCTAssertFalse(guide.exists)
    }

    private func launchPreview() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-edupi-offline"]
        app.launch()
        expectVisible(app.buttons["本地预览菜单"])
        return app
    }

    private func selectTab(_ title: String, in app: XCUIApplication) {
        let tab = app.tabBars.buttons[title]
        expectVisible(tab)
        tab.tap()
    }

    private func expectVisible(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        expectPresent(element, file: file, line: line)
        XCTAssertTrue(element.isHittable, "Not visible \(element)", file: file, line: line)
    }

    private func expectPresent(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 5), "Missing \(element)", file: file, line: line)
    }

    private func capture(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
