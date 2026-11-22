import AppKit
import ApplicationServices
import Darwin
import Foundation

private struct ProbeFailure: Error {
    let code: String
}

private enum Phase: String {
    case open, qr, success, restart
}

private let fixtureTitle = "智学网扫码验收"
private let waiting = "正在打开智学网，请稍等。"
private let ready = "已确认登录。同步前请确认班级、学科和学段。"
private let close = "关闭扫码窗口"
private let image = "智学网登录"
private let clock = ProcessInfo.processInfo

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

private func runningExecutable(_ pid: pid_t) -> String? {
    var bytes = [UInt8](repeating: 0, count: 4096)
    let length = bytes.withUnsafeMutableBytes { buffer in
        proc_pidpath(pid, buffer.baseAddress, UInt32(buffer.count))
    }
    guard length > 0, let path = String(bytes: bytes.prefix(while: { $0 != 0 }), encoding: .utf8) else {
        return nil
    }
    return URL(fileURLWithPath: path).resolvingSymlinksInPath().path
}

private struct Node {
    let element: AXUIElement
    let parent: Int?
    let role: String
    let names: [String]

    func matches(_ name: String) -> Bool { names.contains(name) }
}

private struct Window {
    let nodes: [Node]

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
    private let app: AXUIElement
    private let pid: pid_t
    private let executable: String

    init(pid: pid_t, path: String) throws {
        let url = URL(fileURLWithPath: path)
        executable = "\(path)/Contents/MacOS/pi-agent-desktop"
        guard path.hasPrefix("/private/tmp/edupi-installed-"),
              path.hasSuffix("/EduPi.app"),
              url.pathComponents.count >= 4,
              FileManager.default.fileExists(atPath: executable) else {
            throw ProbeFailure(code: "unexpected_installed_app_path")
        }
        guard runningExecutable(pid) == executable else {
            throw ProbeFailure(code: "unexpected_installed_app_identity")
        }
        guard AXIsProcessTrusted() else { throw ProbeFailure(code: "native_accessibility_unavailable") }
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
        guard runningExecutable(pid) == executable else {
            throw ProbeFailure(code: "installed_app_exited_during_native_probe")
        }
        guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], !windows.isEmpty else {
            return nil
        }
        guard windows.count == 1 else { throw ProbeFailure(code: "unexpected_installed_app_windows") }
        let window = windows[0]
        var windowPid: pid_t = 0
        guard AXUIElementGetPid(window, &windowPid) == .success, windowPid == pid,
              (attribute(window, kAXMinimizedAttribute) as? Bool) != true else {
            return nil
        }

        let scanDeadline = clock.systemUptime + 4
        let fields = [kAXRoleAttribute, kAXTitleAttribute, kAXValueAttribute,
                      kAXDescriptionAttribute, kAXChildrenAttribute]
        var pending: [(AXUIElement, Int?, Int)] = [(window, nil, 0)]
        var nodes: [Node] = []
        while let (element, parent, depth) = pending.popLast() {
            guard depth <= 48, nodes.count < 800, clock.systemUptime < scanDeadline else {
                return nil
            }
            _ = AXUIElementSetMessagingTimeout(element, 0.5)
            var result: CFArray?
            guard AXUIElementCopyMultipleAttributeValues(element, fields as CFArray, [], &result) == .success,
                  let values = result as? [Any], values.count == fields.count,
                  let role = values[0] as? String else {
                return nil
            }
            let names = values[1...3].compactMap { value in
                (value as? String)?.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            }
            let index = nodes.count
            nodes.append(Node(element: element, parent: parent, role: role, names: names))
            if let children = values[4] as? [AXUIElement] {
                guard children.count + nodes.count + pending.count <= 800 else { return nil }
                pending.append(contentsOf: children.reversed().map { ($0, index, depth + 1) })
            }
        }
        return Window(nodes: nodes)
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
        guard runningExecutable(pid) == executable,
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
                guard window.showsText(waiting), let open = try window.button("打开扫码窗口") else {
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
                guard let dismiss = try window.button(close), window.showsText(ready), !window.showsQR else {
                    return false
                }
                try press(dismiss, failure: "scan_close_failed")
                return true
            }
            try awaitWindow("scan_success_missing_in_chat") { window in
                try window.button(close) == nil && window.showsText(ready) && !window.showsQR
            }
        case .restart:
            try selectFixture()
            try awaitWindow("scan_success_missing_after_restart") { window in
                try window.button(close) == nil && window.showsText(ready) && !window.showsQR
            }
        }
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
