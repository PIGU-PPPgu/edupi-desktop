import Combine
import Foundation

@MainActor
final class EduPiAppState: ObservableObject {
    enum Phase {
        case restoring, login, workspaceSelection, ready
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
    @Published private(set) var workspaces: [EduPiRemoteWorkspace] = []
    @Published private(set) var selectedWorkspaceID: String?
    @Published private(set) var pendingWrites: [EduPiCloudOutboxEntry] = []
    @Published private(set) var isCreatingTask = false
    @Published private(set) var movingTaskIDs = Set<String>()
    @Published private(set) var mutationError: String?
    @Published private(set) var scopeID = UUID()
    @Published private(set) var cloudSessions: [EduPiCloudSession] = []
    @Published private(set) var activeCloudSessionID: String?
    @Published private(set) var cloudConversation: EduPiCloudConversation?
    @Published private(set) var isLoadingCloudChat = false
    @Published private(set) var isSendingCloudChat = false
    @Published private(set) var chatError: String?
    @Published private(set) var previewMessages: [EduPiChatMessage] = []
    @Published var selectedTab: EduPiTab = .home

    let settings: AppSettings
    private var api: EduPiRemoteAPI?
    private var sessionGeneration = 0
    private var chatSelectionGeneration = UUID()
    private var chatEventCursor: Int64 = 0
    private let apiFactory: @MainActor (String) throws -> EduPiRemoteAPI

    var isWriting: Bool { isCreatingTask || !movingTaskIDs.isEmpty || isSendingCloudChat }
    var canWriteTasks: Bool { isPreview || (api != nil && selectedWorkspaceID != nil) }
    var pendingTaskWrites: [EduPiCloudOutboxEntry] { pendingWrites.filter { $0.chatSessionID == nil } }
    var pendingChatWrites: [EduPiCloudOutboxEntry] { pendingWrites.filter { $0.chatSessionID == activeCloudSessionID && $0.chatSessionID != nil } }

    init(settings: AppSettings, apiFactory: @escaping @MainActor (String) throws -> EduPiRemoteAPI = { try EduPiRemoteAPI(baseURLString: $0) }) {
        self.settings = settings
        self.apiFactory = apiFactory
    }

    func restore() async {
        guard phase == .restoring, api == nil else { return }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-edupi-offline") {
            continueWithPreview()
            return
        }
        #endif
        guard let candidate = try? apiFactory(settings.serverAddress),
              candidate.restoreSession() else {
            phase = .login
            return
        }
        api = candidate
        accountName = candidate.username
        selectedWorkspaceID = candidate.workspaceID
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
            let candidate = try apiFactory(serverAddress)
            try await candidate.signIn(username: username, password: password)
            guard generation == sessionGeneration, !Task.isCancelled else { return }
            try candidate.activateSession()
            api = candidate
            accountName = candidate.username
            settings.username = username
            settings.serverAddress = candidate.baseURL.absoluteString
            selectedWorkspaceID = candidate.workspaceID
            workspaces = candidate.workspaces
            if candidate.workspaceID == nil {
                phase = .workspaceSelection
            } else {
                await refresh()
            }
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
        guard let api, !isSyncing, !isWriting else { return }
        let generation = sessionGeneration
        isSyncing = true
        defer {
            if generation == sessionGeneration { isSyncing = false }
        }
        do {
            if api.workspaceID != nil {
                pendingWrites = try api.pendingWrites()
            }
            try await api.loadWorkspaces()
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return }
            workspaces = api.workspaces
            selectedWorkspaceID = api.workspaceID
            guard api.workspaceID != nil else {
                syncError = nil
                phase = .workspaceSelection
                return
            }
            _ = try await api.replayOutbox()
            try await api.replayChatOutbox()
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return }
            pendingWrites = try api.pendingWrites()
            let remote = try await api.loadDashboard()
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return }
            dashboard = mapDashboard(remote)
            lastSync = Date()
            syncError = nil
            phase = .ready
            if selectedTab == .chat { await refreshCloudChat() }
        } catch {
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return }
            if !endInvalidSession(error) {
                syncError = error is URLError
                    ? (pendingWrites.isEmpty ? "网络不可用，请稍后重试。" : "网络不可用，待同步内容已保留。")
                    : error.localizedDescription
                phase = api.workspaceID == nil ? .workspaceSelection : .ready
            }
        }
    }

    func becameActive() async {
        guard phase != .restoring, !isPreview else { return }
        await refresh()
    }

    func showWorkspaceSelection() {
        guard !isPreview, !isWriting, !isSyncing else { return }
        phase = .workspaceSelection
    }

    func cancelWorkspaceSelection() {
        if selectedWorkspaceID != nil { phase = .ready }
    }

    func chooseWorkspace(_ id: String) async {
        guard let api, !isWriting, !isSyncing else { return }
        do {
            try api.chooseWorkspace(id)
            sessionGeneration += 1
            scopeID = UUID()
            dashboard = EduPiDashboard()
            lastSync = nil
            syncError = nil
            mutationError = nil
            resetCloudChat()
            selectedWorkspaceID = api.workspaceID
            pendingWrites = try api.pendingWrites()
            phase = .ready
            await refresh()
        } catch {
            syncError = error.localizedDescription
        }
    }

    func isTaskBusy(_ id: String) -> Bool {
        movingTaskIDs.contains(id) || pendingTaskWrites.contains(where: { $0.taskID == id })
    }

    func refreshCloudChat() async {
        guard !isPreview, let api, selectedWorkspaceID != nil, !isLoadingCloudChat, !isSendingCloudChat else { return }
        let generation = sessionGeneration
        let selection = chatSelectionGeneration
        let sessionID = activeCloudSessionID
        isLoadingCloudChat = true
        defer {
            if generation == sessionGeneration { isLoadingCloudChat = false }
        }
        do {
            try await api.replayChatOutbox()
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return }
            pendingWrites = try api.pendingWrites()
            let sessions = try await api.loadCloudSessions()
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return }
            cloudSessions = sessions
            if let sessionID, !pendingWrites.contains(where: {
                if case let .chatCreate(id, _) = $0.mutation { return id == sessionID }
                return false
            }) {
                let events = try await api.loadCloudEvents(sessionID: sessionID, after: chatEventCursor)
                let conversation = try await api.readCloudSession(sessionID)
                guard generation == sessionGeneration, self.api === api, selection == chatSelectionGeneration,
                      activeCloudSessionID == sessionID, !Task.isCancelled else { return }
                chatEventCursor = events.last?.id ?? chatEventCursor
                cloudConversation = conversation
            }
            if selection == chatSelectionGeneration { chatError = nil }
        } catch {
            guard generation == sessionGeneration, self.api === api, selection == chatSelectionGeneration,
                  !Task.isCancelled else { return }
            if !endInvalidSession(error) {
                chatError = error is URLError
                    ? (pendingChatWrites.isEmpty ? "网络不可用，请稍后重试。" : "网络不可用，待发送消息已保存在本机。")
                    : error.localizedDescription
            }
        }
    }

    func openCloudSession(_ id: String) async {
        guard !isSendingCloudChat else { return }
        activeCloudSessionID = id
        cloudConversation = nil
        chatSelectionGeneration = UUID()
        chatEventCursor = 0
        await refreshCloudChat()
    }

    func createCloudConversation() async -> Bool {
        await writeCloudChat { try await $0.createCloudSession() }
    }

    func sendCloudMessage(_ value: String) async -> Bool {
        guard let id = activeCloudSessionID else { return false }
        return await writeCloudChat { try await $0.enqueueCloudPrompt(sessionID: id, message: value) }
    }

    private func writeCloudChat(_ write: (EduPiRemoteAPI) async throws -> EduPiCloudChatWriteResult) async -> Bool {
        guard !isPreview, let api, selectedWorkspaceID != nil, !isWriting, !isSyncing, !isLoadingCloudChat else { return false }
        let generation = sessionGeneration
        isSendingCloudChat = true
        chatError = nil
        defer {
            if generation == sessionGeneration { isSendingCloudChat = false }
        }
        do {
            let result = try await write(api)
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return false }
            if activeCloudSessionID != result.sessionID {
                cloudConversation = nil
                chatEventCursor = 0
                chatSelectionGeneration = UUID()
            }
            activeCloudSessionID = result.sessionID
            pendingWrites = try api.pendingWrites()
            if let pending = result.pending {
                chatError = pending.lastError
                return !pending.isBlocked
            }
            // The write already passed its exact readback. A later read failure
            // keeps that success, so a retry cannot create a second prompt.
            do {
                let conversation = try await api.readCloudSession(result.sessionID)
                let sessions = try await api.loadCloudSessions()
                guard generation == sessionGeneration, self.api === api, activeCloudSessionID == result.sessionID,
                      !Task.isCancelled else { return false }
                cloudConversation = conversation
                cloudSessions = sessions
            } catch {
                guard generation == sessionGeneration, self.api === api else { return false }
                if !endInvalidSession(error) { chatError = error.localizedDescription }
            }
            return true
        } catch {
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return false }
            if !endInvalidSession(error) { chatError = error.localizedDescription }
            return false
        }
    }

    private func resetCloudChat() {
        cloudSessions = []
        activeCloudSessionID = nil
        cloudConversation = nil
        isLoadingCloudChat = false
        isSendingCloudChat = false
        chatError = nil
        chatSelectionGeneration = UUID()
        chatEventCursor = 0
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

    func createTask(title: String, note: String, requestID: String? = nil) async -> Bool {
        if isPreview { return createPreviewTask(title: title, note: note) }
        guard let api else {
            mutationError = "云端账号未登录"
            return false
        }
        guard !isWriting, !isSyncing else { return false }
        let generation = sessionGeneration
        isCreatingTask = true
        mutationError = nil
        defer {
            if generation == sessionGeneration { isCreatingTask = false }
        }
        do {
            let result = try await api.createTask(title: title, note: note, requestID: requestID)
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return false }
            if let task = result.task {
                apply(task)
                syncError = nil
            }
            pendingWrites = try api.pendingWrites()
            mutationError = result.pending?.isBlocked == true ? result.pending?.lastError : nil
            return result.pending?.isBlocked != true
        } catch {
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return false }
            if !endInvalidSession(error) { mutationError = error.localizedDescription }
            return false
        }
    }

    func moveTask(_ id: String, to stage: EduPiTaskStage) async -> Bool {
        if isPreview {
            movePreviewTask(id, to: stage)
            return true
        }
        guard let api, let current = dashboard.tasks.first(where: { $0.id == id }) else {
            mutationError = "任务已不可用"
            return false
        }
        guard !isWriting, !isSyncing, !isTaskBusy(id) else { return false }
        let generation = sessionGeneration
        movingTaskIDs.insert(id)
        mutationError = nil
        defer {
            if generation == sessionGeneration { movingTaskIDs.remove(id) }
        }
        do {
            let result = try await api.moveTask(taskID: id, expectedRevision: current.revision, to: stage, taskTitle: current.title)
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return false }
            if let task = result.task {
                apply(task)
                syncError = nil
            }
            pendingWrites = try api.pendingWrites()
            mutationError = result.pending?.isBlocked == true ? result.pending?.lastError : nil
            return result.pending?.isBlocked != true
        } catch {
            guard generation == sessionGeneration, self.api === api, !Task.isCancelled else { return false }
            if !endInvalidSession(error) { mutationError = error.localizedDescription }
            return false
        }
    }

    private func apply(_ task: EduPiRemoteTask) {
        let item = EduPiTaskItem(id: task.id, title: task.title, dueDate: task.dueDate, note: task.note,
                                 stage: EduPiTaskStage(rawValue: task.stage) ?? .todo, revision: task.revision)
        if let index = dashboard.tasks.firstIndex(where: { $0.id == task.id }) {
            dashboard.tasks[index] = item
        } else {
            dashboard.tasks.insert(item, at: 0)
        }
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
        scopeID = UUID()
        api = nil
        isPreview = false
        isSigningIn = false
        isSyncing = false
        accountName = ""
        loginError = nil
        syncError = nil
        lastSync = nil
        workspaces = []
        selectedWorkspaceID = nil
        pendingWrites = []
        isCreatingTask = false
        movingTaskIDs = []
        mutationError = nil
        resetCloudChat()
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
