import Combine
import Foundation

@MainActor
final class EduPiAppState: ObservableObject {
    enum Phase {
        case restoring, login, ready
    }

    @Published private(set) var phase: Phase = .restoring
    @Published private(set) var dashboard = EduPiDashboard()
    @Published private(set) var accountName = ""
    @Published private(set) var isPreview = false
    @Published private(set) var isSigningIn = false
    @Published private(set) var isSyncing = false
    @Published private(set) var loginError: String?
    @Published private(set) var syncError: String?
    @Published private(set) var lastSync: Date?
    @Published private(set) var previewMessages: [EduPiChatMessage] = []
    @Published var selectedTab: EduPiTab = .home

    let settings: AppSettings
    private var api: EduPiRemoteAPI?
    private var sessionGeneration = 0

    init(settings: AppSettings) {
        self.settings = settings
    }

    func restore() async {
        guard phase == .restoring, api == nil else { return }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-edupi-offline") {
            continueWithPreview()
            return
        }
        #endif
        guard let candidate = try? EduPiRemoteAPI(baseURLString: settings.serverAddress),
              candidate.restoreSession() else {
            phase = .login
            return
        }
        api = candidate
        accountName = candidate.username
        await refresh()
    }

    func signIn(username: String, password: String, serverAddress: String) async {
        let username = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard phase == .login, !isSigningIn, !username.isEmpty, !password.isEmpty else { return }
        isSigningIn = true
        loginError = nil
        let generation = sessionGeneration
        defer {
            if generation == sessionGeneration { isSigningIn = false }
        }
        do {
            let candidate = try EduPiRemoteAPI(baseURLString: serverAddress)
            try await candidate.signIn(username: username, password: password)
            guard generation == sessionGeneration, !Task.isCancelled else { return }
            try candidate.activateSession()
            api = candidate
            accountName = candidate.username
            settings.username = username
            settings.serverAddress = candidate.baseURL.absoluteString
            await refresh()
        } catch {
            guard generation == sessionGeneration else { return }
            loginError = error is URLError ? "无法连接服务，请检查网络。" : error.localizedDescription
        }
    }

    func continueWithPreview() {
        guard !isSigningIn else { return }
        resetWorkbench()
        isPreview = true
        dashboard = .preview
        accountName = "本地预览"
        phase = .ready
    }

    func signOut() {
        api?.signOut()
        resetWorkbench()
        phase = .login
    }

    func updateServerAddress(_ value: String) throws {
        let next = try EduPiRemoteAPI(baseURLString: value).baseURL.absoluteString
        guard next != settings.serverAddress else { return }
        signOut()
        settings.serverAddress = next
    }

    func refresh() async {
        guard let api, !isSyncing else { return }
        let generation = sessionGeneration
        isSyncing = true
        defer {
            if generation == sessionGeneration { isSyncing = false }
        }
        do {
            let remote = try await api.loadDashboard()
            guard generation == sessionGeneration else { return }
            dashboard = mapDashboard(remote)
            lastSync = Date()
            syncError = nil
            phase = .ready
        } catch {
            guard generation == sessionGeneration else { return }
            if !endInvalidSession(error) {
                syncError = lastSync == nil ? "工作台暂时无法读取" : "同步失败，正在显示上次的数据"
                phase = .ready
            }
        }
    }

    func beginPreviewConversation() {
        guard isPreview else { return }
        previewMessages.removeAll()
    }

    func sendPreviewMessage(_ value: String) {
        let message = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isPreview, !message.isEmpty else { return }
        previewMessages.append(EduPiChatMessage(text: message))
    }

    func createPreviewTask(title: String, note: String) -> Bool {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isPreview, !title.isEmpty, title.count <= 240 else { return false }
        dashboard.tasks.insert(
            EduPiTaskItem(id: "preview-task-\(UUID().uuidString)", title: title, dueDate: nil, note: note.isEmpty ? nil : note, stage: .todo, revision: 0),
            at: 0
        )
        return true
    }

    func movePreviewTask(_ id: String, to stage: EduPiTaskStage) {
        guard isPreview, let index = dashboard.tasks.firstIndex(where: { $0.id == id }) else { return }
        dashboard.tasks[index].stage = stage
        dashboard.tasks[index].revision += 1
    }

    func studentEvents(studentID: String? = nil) async throws -> [EduPiRemoteStudentEvent] {
        try await readCloudList { try await $0.loadStudentEvents(studentID: studentID) }
    }

    func resources(_ shelf: EduPiResourceShelf) async throws -> [EduPiRemoteResource] {
        try await readCloudList { try await $0.loadResources(shelf) }
    }

    private func readCloudList<Item>(_ read: (EduPiRemoteAPI) async throws -> [Item]) async throws -> [Item] {
        if isPreview { return [] }
        guard let api else { throw EduPiRemoteAPIError.unauthorized }
        let generation = sessionGeneration
        do {
            let items = try await read(api)
            guard generation == sessionGeneration, !Task.isCancelled else { throw CancellationError() }
            return items
        } catch {
            if generation == sessionGeneration { _ = endInvalidSession(error) }
            throw error
        }
    }

    private func endInvalidSession(_ error: Error) -> Bool {
        let message: String
        switch error as? EduPiRemoteAPIError {
        case .unauthorized:
            message = "登录已过期，请重新登录。"
        case .workspaceForbidden:
            message = "此账号已无权访问原工作区。"
        default:
            return false
        }
        signOut()
        loginError = message
        return true
    }

    private func resetWorkbench() {
        sessionGeneration += 1
        api = nil
        isPreview = false
        isSigningIn = false
        isSyncing = false
        accountName = ""
        loginError = nil
        syncError = nil
        lastSync = nil
        previewMessages = []
        dashboard = EduPiDashboard()
        selectedTab = .home
    }

    private func mapDashboard(_ remote: EduPiRemoteDashboard) -> EduPiDashboard {
        EduPiDashboard(
            students: remote.students.map { student in
                let latest = student.profile?.trajectory
                    .filter { $0.note?.isEmpty == false || $0.event?.isEmpty == false }
                    .max { ($0.date ?? "") < ($1.date ?? "") }
                return EduPiStudentItem(
                    id: student.id,
                    name: student.name,
                    className: student.className ?? "未分班",
                    traits: student.profile?.traits.filter { !$0.isEmpty } ?? [],
                    latestNote: latest?.note ?? latest?.event
                )
            },
            tasks: remote.tasks.map { task in
                EduPiTaskItem(
                    id: task.id, title: task.title, dueDate: task.dueDate, note: task.note,
                    stage: EduPiTaskStage(rawValue: task.stage) ?? .todo, revision: task.revision
                )
            },
            schedule: remote.calendar.enumerated().map { index, item in
                EduPiScheduleItem(
                    id: "calendar-\(item.id)-\(index)", title: item.name, kind: .calendar,
                    date: item.date, endDate: item.endDate, detail: item.notes
                )
            } + remote.timetable.enumerated().map { index, item in
                EduPiScheduleItem(
                    id: "timetable-\(item.id)-\(index)", title: item.subject ?? "课程", kind: .timetable,
                    dayOfWeek: item.dayOfWeek, period: item.period, detail: item.notes, context: item.className
                )
            }
        )
    }
}
