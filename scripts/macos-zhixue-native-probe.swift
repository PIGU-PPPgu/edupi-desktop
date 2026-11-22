import AppKit
import ApplicationServices
import Foundation

private struct ProbeFailure: Error {
    let code: String
}

private enum Phase: String {
    case open, qr, success, restart
    case upgradeOld = "upgrade-old"
    case upgradeNew = "upgrade-new"
}

private let fixtureTitle = "智学网扫码验收"
private let fixturePrompt = "帮我看看智学网"
private let waiting = "正在打开智学网，请稍等。"
private let ready = "已确认登录。同步前请确认班级、学科和学段。"
private let close = "关闭扫码窗口"
private let image = "智学网登录"
private let openScan = "打开扫码窗口"
private let checkScan = "查看扫码结果"
private let aboutSettings = "关于与更新"
private let updateReminder = "有可用更新"
private let updatePreflight = "安装前确认"
private let checkingUpdates: Set<String> = ["检查中…", "Checking…"]
private let releaseLookupFailure: Set<String> = [
    "无法检查 GitHub 发布。", "Could not check GitHub releases.",
    "无法获取发布信息。", "Release information is unavailable.",
]
private let upgradeWindowLabels: Set<String> = [
    aboutSettings, "About & Updates", updateReminder, "Updates available", "设置", "稍后再说", updatePreflight,
]
private let clock = ProcessInfo.processInfo

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

private func hasNoChildren(_ value: Any) -> Bool {
    if value is NSNull { return true }
    let raw = value as CFTypeRef
    guard CFGetTypeID(raw) == AXValueGetTypeID() else { return false }
    let errorValue = raw as! AXValue
    var error = AXError.success
    return AXValueGetType(errorValue) == .axError
      && AXValueGetValue(errorValue, .axError, &error)
      && (error == .noValue || error == .attributeUnsupported)
}

private struct Node {
    let element: AXUIElement
    let parent: Int?
    let role: String
    let names: [String]

    func matches(_ name: String) -> Bool {
        names.contains(name) || name == fixtureTitle && names.contains { $0.contains(fixtureTitle) }
          || name == fixturePrompt && names.contains { $0.contains(fixturePrompt) }
    }
}

private struct Window {
    let nodes: [Node]
    let complete: Bool

    func containsAny(_ texts: Set<String>) -> Bool {
        nodes.contains { node in node.names.contains { texts.contains($0) } }
    }

    func button(_ name: String, parentLabel: String? = nil) throws -> AXUIElement? {
        var matches = Set<Int>()
        for index in nodes.indices where nodes[index].matches(name) {
            var current: Int? = index
            while let candidate = current {
                let node = nodes[candidate]
                if node.role == kAXButtonRole {
                    let parentMatches = parentLabel.map { label in
                        node.parent.map { nodes[$0].matches(label) } ?? false
                    } ?? true
                    if parentMatches && (attribute(node.element, kAXEnabledAttribute) as? Bool) != false {
                        matches.insert(candidate)
                    }
                    break
                }
                // A session row can expose its text as a child of a button.
                guard node.role == kAXStaticTextRole || node.role == kAXGroupRole else { break }
                current = node.parent
            }
        }
        guard matches.count <= 1 else { throw ProbeFailure(code: "ambiguous_fixture_button") }
        return matches.first.map { nodes[$0].element }
    }

    func showsText(_ text: String, prefix: Bool = false) -> Bool {
        nodes.contains { node in
            node.role == kAXStaticTextRole && node.names.contains { name in
                prefix ? name.hasPrefix(text) : name == text
            }
        }
    }

    var showsQR: Bool {
        nodes.contains { $0.role == kAXImageRole && $0.matches(image) }
    }

    func showsAboutVersion(_ current: String, latest: String? = nil) -> Bool {
        guard containsAny([aboutSettings, "About & Updates"]) else { return false }
        // The version chip names which version is running and which is offered.
        let labels = latest.map {
            ["当前版本: v\(current). 最新正式版: v\($0). ", "Current version: v\(current). Latest stable release: v\($0). "]
        } ?? ["版本: v\(current). ", "当前版本: v\(current). ", "Version: v\(current). ", "Current version: v\(current). "]
        for index in nodes.indices where nodes[index].role == "AXLink" {
            if nodes[index].names.contains(where: { name in
                labels.contains { name.hasPrefix($0) }
            }) { return true }

            // WebKit can expose the chip as several static text children.
            var chipText = Set<String>()
            for child in nodes.indices where nodes[child].role == kAXStaticTextRole {
                var parent = nodes[child].parent
                while let ancestor = parent {
                    if ancestor == index {
                        chipText.formUnion(nodes[child].names)
                        break
                    }
                    parent = nodes[ancestor].parent
                }
            }
            guard chipText.contains("v\(current)") else { continue }
            if let latest {
                if chipText.contains("v\(latest)") && !chipText.isDisjoint(with: ["最新正式版", "Latest stable release"]) {
                    return true
                }
            } else if !chipText.isDisjoint(with: ["版本", "当前版本", "Version", "Current version"]) {
                return true
            }
        }
        return false
    }
}

private final class NativeProbe {
    private let running: NSRunningApplication
    private let app: AXUIElement
    private let pid: pid_t

    init(pid: pid_t, path: String) throws {
        let url = URL(fileURLWithPath: path)
        guard path.hasPrefix("/private/tmp/edupi-installed-"),
              path.hasSuffix("/EduPi.app"),
              url.pathComponents.count >= 4,
              FileManager.default.fileExists(atPath: "\(path)/Contents/MacOS/pi-agent-desktop"),
              let running = NSRunningApplication(processIdentifier: pid),
              !running.isTerminated else {
            throw ProbeFailure(code: "unexpected_installed_app_path")
        }
        guard AXIsProcessTrusted() else { throw ProbeFailure(code: "native_accessibility_unavailable") }
        self.running = running
        self.pid = pid
        app = AXUIElementCreateApplication(pid)
        var axPid: pid_t = 0
        guard AXUIElementGetPid(app, &axPid) == .success, axPid == pid else {
            throw ProbeFailure(code: "unexpected_accessibility_app_identity")
        }
        _ = AXUIElementSetMessagingTimeout(app, 0.5)
        _ = NSRunningApplication(processIdentifier: pid)?.activate(options: [])
    }

    private func snapshot(preferring labels: Set<String>? = nil) throws -> Window? {
        guard !running.isTerminated, running.processIdentifier == pid else {
            throw ProbeFailure(code: "installed_app_exited_during_native_probe")
        }
        guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], !windows.isEmpty else {
            return nil
        }
        let fields = [kAXRoleAttribute, kAXTitleAttribute, kAXValueAttribute,
                      kAXDescriptionAttribute, kAXChildrenAttribute]
        var candidates: [Window] = []
        for window in windows {
            var windowPid: pid_t = 0
            guard AXUIElementGetPid(window, &windowPid) == .success, windowPid == pid,
                  (attribute(window, kAXMinimizedAttribute) as? Bool) != true else {
                continue
            }
            let scanDeadline = clock.systemUptime + 4
            var pending: [(AXUIElement, Int?, Int)] = [(window, nil, 0)]
            var nodes: [Node] = []
            var complete = true
            while let (element, parent, depth) = pending.popLast() {
                guard depth <= 48, nodes.count < 800, clock.systemUptime < scanDeadline else {
                    complete = false
                    break
                }
                _ = AXUIElementSetMessagingTimeout(element, 0.5)
                var result: CFArray?
                guard AXUIElementCopyMultipleAttributeValues(element, fields as CFArray, [], &result) == .success,
                      let values = result as? [Any], values.count == fields.count,
                      let role = values[0] as? String else {
                    complete = false
                    continue
                }
                let names = values[1...3].compactMap { value in
                    (value as? String)?.split(whereSeparator: \.isWhitespace).joined(separator: " ")
                }
                let index = nodes.count
                nodes.append(Node(element: element, parent: parent, role: role, names: names))
                if let children = values[4] as? [AXUIElement] {
                    guard children.count + nodes.count + pending.count <= 800 else {
                        complete = false
                        break
                    }
                    pending.append(contentsOf: children.reversed().map { ($0, index, depth + 1) })
                } else if !hasNoChildren(values[4]) {
                    complete = false
                }
            }
            if !nodes.isEmpty { candidates.append(Window(nodes: nodes, complete: complete)) }
        }
        let preferred = candidates.first {
            $0.containsAny(labels ?? [fixtureTitle, fixturePrompt, "AI 协作", "对话", waiting, ready, openScan, checkScan])
        }
        return preferred ?? candidates.max { $0.nodes.count < $1.nodes.count }
    }

    private func awaitWindow(_ code: String, seconds: TimeInterval = 13,
                             preferring labels: Set<String>? = nil,
                             predicate: (Window) throws -> Bool) throws {
        let deadline = clock.systemUptime + seconds
        repeat {
            if let window = try snapshot(preferring: labels), try predicate(window) { return }
            Thread.sleep(forTimeInterval: 0.25)
        } while clock.systemUptime < deadline
        throw ProbeFailure(code: code)
    }

    private func press(_ button: AXUIElement, failure: String) throws {
        var buttonPid: pid_t = 0
        guard !running.isTerminated, running.processIdentifier == pid,
              AXUIElementGetPid(button, &buttonPid) == .success, buttonPid == pid,
              AXUIElementPerformAction(button, kAXPressAction as CFString) == .success else {
            throw ProbeFailure(code: failure)
        }
    }

    private func selectFixture() throws {
        var skippedWelcome = false
        var selectedChat = false
        var revealedSidebar = false
        try awaitWindow("synthetic_chat_unavailable", seconds: 34) { window in
            if !skippedWelcome, let later = try window.button("稍后再说") {
                try press(later, failure: "welcome_dismiss_failed")
                skippedWelcome = true
            } else if let session = try window.button(fixtureTitle) {
                try press(session, failure: "synthetic_chat_select_failed")
                return true
            } else if !selectedChat, let chat = try window.button("AI 协作") {
                try press(chat, failure: "chat_navigation_failed")
                selectedChat = true
            } else if !revealedSidebar, let sidebar = try window.button("显示对话与文件") {
                try press(sidebar, failure: "chat_sidebar_open_failed")
                revealedSidebar = true
            }
            return false
        }
    }

    private func triggerUpgrade() throws {
        var skippedWelcome = false
        try awaitWindow("update_settings_unavailable", seconds: 40, preferring: upgradeWindowLabels) { window in
            if !skippedWelcome, let later = try window.button("稍后再说") {
                try press(later, failure: "welcome_dismiss_failed")
                skippedWelcome = true
                return false
            }
            if try window.button(aboutSettings) != nil || window.button("About & Updates") != nil { return true }
            let settings = try window.button("打开设置", parentLabel: updateReminder)
                ?? window.button("Open Settings", parentLabel: "Updates available")
                ?? window.button("设置") ?? window.button("Settings")
            guard let settings else { return false }
            try press(settings, failure: "open_update_settings_failed")
            return true
        }
        var openedAbout = false
        var checkedUpdates = false
        var checkVisible = false
        var releaseLookupFailed = false
        var expectedVersionsVisible = false
        do {
            try awaitWindow("expected_upgrade_versions_or_control_unavailable", seconds: 45,
                            preferring: upgradeWindowLabels) { window in
                let showsExpected = window.showsAboutVersion("0.3.122", latest: "0.3.123")
                expectedVersionsVisible = expectedVersionsVisible || showsExpected
                releaseLookupFailed = releaseLookupFailed || window.containsAny(releaseLookupFailure)
                if showsExpected, let update = try window.button("更新") ?? window.button("Update") {
                    try press(update, failure: "update_request_failed")
                    return true
                }
                let check = try window.button("检查更新") ?? window.button("Check for updates")
                if check != nil || window.containsAny(checkingUpdates) {
                    checkVisible = true
                }
                if !checkedUpdates, let check {
                    try press(check, failure: "check_updates_failed")
                    checkedUpdates = true
                } else if !openedAbout, !checkVisible,
                          let about = try window.button(aboutSettings) ?? window.button("About & Updates") {
                    try press(about, failure: "old_app_open_about_failed")
                    openedAbout = true
                }
                return false
            }
        } catch let error as ProbeFailure where error.code == "expected_upgrade_versions_or_control_unavailable" {
            if releaseLookupFailed { throw ProbeFailure(code: "old_app_release_lookup_failed") }
            if expectedVersionsVisible { throw ProbeFailure(code: "old_app_update_button_not_enabled") }
            if checkVisible { throw ProbeFailure(code: "old_app_expected_release_versions_not_visible") }
            throw ProbeFailure(code: "old_app_about_page_not_observed")
        }
        try awaitWindow("expected_upgrade_confirmation_unavailable", seconds: 18,
                        preferring: upgradeWindowLabels) { window in
            guard window.showsAboutVersion("0.3.122", latest: "0.3.123"),
                  window.containsAny([updatePreflight]),
                  let confirmation = try window.button("继续更新") else { return false }
            try press(confirmation, failure: "update_confirmation_failed")
            return true
        }
        print("upgrade_triggered")
    }

    private func verifyUpdatedVersion() throws {
        var skippedWelcome = false
        var openedSettings = false
        var openedAbout = false
        try awaitWindow("updated_version_not_visible", seconds: 38, preferring: upgradeWindowLabels) { window in
            if !skippedWelcome, let later = try window.button("稍后再说") {
                try press(later, failure: "welcome_dismiss_failed")
                skippedWelcome = true
            } else if window.showsAboutVersion("0.3.123") {
                return true
            } else if !openedAbout, let about = try window.button(aboutSettings) ?? window.button("About & Updates") {
                try press(about, failure: "updated_app_open_about_failed")
                openedAbout = true
            } else if !openedSettings, !openedAbout, let settings = try window.button("设置") {
                try press(settings, failure: "updated_app_open_settings_failed")
                openedSettings = true
            }
            return false
        }
        print("updated_version_visible")
    }

    func run(_ phase: Phase) throws {
        switch phase {
        case .open:
            try selectFixture()
            try awaitWindow("scan_waiting_or_action_missing") { window in
                guard window.showsText(waiting), let open = try window.button(openScan) else {
                    return false
                }
                try press(open, failure: "scan_open_failed")
                return true
            }
            try awaitWindow("scan_window_waiting_not_observed") { window in
                try window.button(close) != nil && window.showsText(waiting) && !window.showsQR
            }
        case .qr:
            var firstObservation: TimeInterval?
            try awaitWindow("scan_qr_not_observed") { window in
                guard try window.button(close) != nil, window.showsText("等待扫码。", prefix: true),
                      window.showsQR, !window.showsText("二维码暂时无法显示", prefix: true) else {
                    firstObservation = nil
                    return false
                }
                let observedAt = clock.systemUptime
                if firstObservation == nil { firstObservation = observedAt }
                return observedAt - (firstObservation ?? observedAt) >= 0.75
            }
        case .success:
            try awaitWindow("scan_success_or_qr_removal_not_observed") { window in
                guard let dismiss = try window.button(close), showsSettledLogin(window) else {
                    return false
                }
                try press(dismiss, failure: "scan_close_failed")
                return true
            }
            try awaitWindow("scan_success_missing_in_chat") { window in
                try window.button(close) == nil && showsSettledLogin(window)
            }
        case .restart:
            let initiallyVisible = try snapshot()?.showsText(ready) == true
            try selectFixture()
            try awaitWindow("original_message_missing_after_restart") { window in
                window.nodes.contains { $0.matches(fixturePrompt) }
            }
            var openedResult = false
            try awaitWindow("scan_success_missing_after_restart") { window in
                if showsSettledLogin(window) {
                    if let dismiss = try window.button(close) {
                        try press(dismiss, failure: "reopened_scan_result_close_failed")
                    }
                    return true
                }
                if !openedResult, let result = try window.button(checkScan) {
                    try press(result, failure: "reopen_scan_result_failed")
                    openedResult = true
                }
                return false
            }
            try awaitWindow("scan_success_missing_in_reopened_chat") { window in
                try window.button(close) == nil && showsSettledLogin(window)
                  && window.nodes.contains { $0.matches(fixturePrompt) }
            }
            let initial = initiallyVisible ? "visible_before_navigation" : "not_in_initial_snapshot"
            print("\(initial) \(openedResult ? "result_button" : "direct")")
        case .upgradeOld:
            try triggerUpgrade()
        case .upgradeNew:
            try verifyUpdatedVersion()
        }
    }

    private func showsSettledLogin(_ window: Window) -> Bool {
        window.complete && window.showsText(ready) && !window.showsQR
          && !window.containsAny([openScan, checkScan])
    }
}

do {
    let args = CommandLine.arguments
    guard args.count == 5, let pid = pid_t(args[1]), pid > 1,
          let phase = Phase(rawValue: args[3]), args[4] == fixtureTitle else {
        throw ProbeFailure(code: "invalid_native_probe_arguments")
    }
    try NativeProbe(pid: pid, path: args[2]).run(phase)
} catch {
    let code = (error as? ProbeFailure)?.code ?? "unexpected_native_probe_failure"
    FileHandle.standardError.write(Data("\(code)\n".utf8))
    exit(1)
}
