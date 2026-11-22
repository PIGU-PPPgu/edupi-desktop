import AppKit
import ApplicationServices
import Foundation

private struct ProbeFailure: Error {
    let code: String
}

private enum Phase: String {
    case open, qr, success, restart
}

private let fixtureTitle = "智学网扫码验收"
private let fixturePrompt = "帮我看看智学网"
private let waiting = "正在打开智学网，请稍等。"
private let ready = "已确认登录。同步前请确认班级、学科和学段。"
private let close = "关闭扫码窗口"
private let image = "智学网登录"
private let openScan = "打开扫码窗口"
private let checkScan = "查看扫码结果"
private let clock = ProcessInfo.processInfo

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
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

    func button(_ name: String) throws -> AXUIElement? {
        var matches = Set<Int>()
        for index in nodes.indices where nodes[index].matches(name) {
            var current: Int? = index
            while let candidate = current {
                let node = nodes[candidate]
                if node.role == kAXButtonRole {
                    if (attribute(node.element, kAXEnabledAttribute) as? Bool) != false {
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

    private func snapshot() throws -> Window? {
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
                }
            }
            if !nodes.isEmpty { candidates.append(Window(nodes: nodes, complete: complete)) }
        }
        let preferred = candidates.first {
            $0.containsAny([fixtureTitle, fixturePrompt, "AI 协作", "对话", waiting, ready, openScan, checkScan])
        }
        return preferred ?? candidates.max { $0.nodes.count < $1.nodes.count }
    }

    private func awaitWindow(_ code: String, seconds: TimeInterval = 13,
                             predicate: (Window) throws -> Bool) throws {
        let deadline = clock.systemUptime + seconds
        repeat {
            if let window = try snapshot(), try predicate(window) { return }
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
            }
            let initial = initiallyVisible ? "visible_before_navigation" : "not_in_initial_snapshot"
            print("\(initial) \(openedResult ? "result_button" : "direct")")
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
