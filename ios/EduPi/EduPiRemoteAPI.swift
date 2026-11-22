import Foundation
import Security

@MainActor
protocol EduPiSessionStore {
    func read() -> Data?
    func write(_ data: Data) throws
    func delete()
}

@MainActor
private struct EduPiKeychainSessionStore: EduPiSessionStore {
    let service: String
    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "edupi.remote.session",
        ]
    }

    func write(_ data: Data) throws {
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw EduPiRemoteAPIError.sessionStorageUnavailable }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw EduPiRemoteAPIError.sessionStorageUnavailable
        }
    }

    func read() -> Data? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    func delete() {
        SecItemDelete(query as CFDictionary)
    }
}

struct EduPiRemoteWorkspace: Decodable, Identifiable {
    let id: String
    let mode: String
    let ownerAccountID: String?
    let createdAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case mode
        case ownerAccountID = "owner_account_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct EduPiRemoteProfile: Decodable {
    let traits: [String]
    let trajectory: [EduPiRemoteTrajectory]
    let parentNotes: [EduPiRemoteParentNote]

    enum CodingKeys: String, CodingKey {
        case traits
        case trajectory
        case parentNotes = "parent_notes"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        traits = (try? container.decode([String].self, forKey: .traits)) ?? []
        trajectory = (try? container.decode([EduPiRemoteTrajectory].self, forKey: .trajectory)) ?? []
        parentNotes = (try? container.decode([EduPiRemoteParentNote].self, forKey: .parentNotes)) ?? []
    }
}

struct EduPiRemoteTrajectory: Decodable {
    let date: String?
    let note: String?
    let score: Double?
    let event: String?
}

struct EduPiRemoteParentNote: Decodable {
    let date: String?
    let note: String?
}

struct EduPiRemoteStudent: Decodable, Identifiable {
    let id: String
    let name: String
    let className: String?
    let profile: EduPiRemoteProfile?
    let revision: Int

    enum CodingKeys: String, CodingKey {
        case id = "student_id"
        case name
        case className = "class_name"
        case profile
        case revision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        className = try? container.decode(String.self, forKey: .className)
        profile = try? container.decode(EduPiRemoteProfile.self, forKey: .profile)
        revision = (try? container.decode(Int.self, forKey: .revision)) ?? 0
    }
}

struct EduPiRemoteTask: Decodable, Identifiable {
    let id: String
    let title: String
    let dueDate: String?
    let note: String?
    let stage: String
    let status: String
    let revision: Int

    enum CodingKeys: String, CodingKey {
        case id = "task_id"
        case title
        case dueDate = "due_date"
        case note
        case stage
        case status
        case revision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        dueDate = try container.decodeIfPresent(String.self, forKey: .dueDate)
        note = try container.decodeIfPresent(String.self, forKey: .note)
        stage = try container.decode(String.self, forKey: .stage)
        status = try container.decode(String.self, forKey: .status)
        revision = try container.decode(Int.self, forKey: .revision)
    }
}

struct EduPiRemoteCalendarItem: Decodable, Identifiable {
    let id: String
    let date: String?
    let endDate: String?
    let name: String
    let notes: String?
    let type: String?

    enum CodingKeys: String, CodingKey {
        case id
        case eventID = "event_id"
        case date
        case endDate = "end_date"
        case name
        case notes
        case type
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? (try container.decodeIfPresent(String.self, forKey: .eventID))
            ?? UUID().uuidString
        date = try container.decodeIfPresent(String.self, forKey: .date)
        endDate = try container.decodeIfPresent(String.self, forKey: .endDate)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "校历安排"
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        type = try container.decodeIfPresent(String.self, forKey: .type)
    }
}

struct EduPiRemoteTimetableItem: Decodable, Identifiable {
    let id: String
    let dayOfWeek: Int?
    let period: Int?
    let subject: String?
    let className: String?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case id
        case slotID = "slot_id"
        case dayOfWeek = "day_of_week"
        case period
        case subject
        case className = "class_name"
        case notes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? (try container.decodeIfPresent(String.self, forKey: .slotID))
            ?? UUID().uuidString
        dayOfWeek = try container.decodeIfPresent(Int.self, forKey: .dayOfWeek)
        period = try container.decodeIfPresent(Int.self, forKey: .period)
        subject = try container.decodeIfPresent(String.self, forKey: .subject)
        className = try container.decodeIfPresent(String.self, forKey: .className)
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
    }
}

struct EduPiRemoteSnapshotPayload: Decodable {
    let workspaceID: String
    let students: [EduPiRemoteStudent]
    let tasks: [EduPiRemoteTask]
    let calendar: [EduPiRemoteCalendarItem]
    let timetable: [EduPiRemoteTimetableItem]

    enum CodingKeys: String, CodingKey {
        case workspaceID = "workspace_id"
        case students
        case tasks
        case calendar
        case timetable
    }

}

struct EduPiRemoteDashboard {
    let workspaceID: String
    let students: [EduPiRemoteStudent]
    let tasks: [EduPiRemoteTask]
    let calendar: [EduPiRemoteCalendarItem]
    let timetable: [EduPiRemoteTimetableItem]
}

enum EduPiResourceShelf: String {
    case materials, memories

    var fields: String {
        switch self {
        case .materials: "id:material_id,title,detail:subject"
        case .memories: "id:memory_id,title:content,detail:category"
        }
    }

    var order: String {
        switch self {
        case .materials: "updated_at.desc,material_id.asc"
        case .memories: "updated_at.desc,memory_id.asc"
        }
    }

    var statusFilter: URLQueryItem {
        switch self {
        case .materials: URLQueryItem(name: "intake_state", value: "eq.accepted")
        case .memories: URLQueryItem(name: "state", value: "eq.active")
        }
    }
}

struct EduPiRemoteResource: Decodable, Identifiable {
    let id: String
    let title: String
    let detail: String?
}

struct EduPiRemoteStudentEvent: Decodable, Identifiable {
    let id: String
    let kind: String
    let summary: String
    let topic: String?
    let observedOn: String?
    let className: String?
    let revision: Int

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case summary
        case topic
        case observedOn = "observed_on"
        case className = "class_name"
        case revision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(String.self, forKey: .kind)
        summary = try container.decode(String.self, forKey: .summary)
        topic = try? container.decode(String.self, forKey: .topic)
        observedOn = try? container.decode(String.self, forKey: .observedOn)
        className = try? container.decode(String.self, forKey: .className)
        revision = (try? container.decode(Int.self, forKey: .revision)) ?? 0
    }
}

enum EduPiRemoteAPIError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case invalidStudentID
    case unauthorized
    case workspaceForbidden
    case server(statusCode: Int, message: String)
    case noWorkspace
    case sessionStorageUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "请输入有效的 HTTPS 服务地址。"
        case .invalidResponse:
            return "服务返回的数据无法读取。"
        case .invalidStudentID:
            return "学生编号无效。"
        case .unauthorized:
            return "账号或密码不正确，或登录已过期。"
        case .workspaceForbidden:
            return "此账号已无权访问工作区。"
        case let .server(_, message):
            return message
        case .noWorkspace:
            return "账号还没有可用工作区。"
        case .sessionStorageUnavailable:
            return "无法将登录状态保存到钥匙串。"
        }
    }
}

@MainActor
final class EduPiRemoteAPI {
    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(
            _ session: URLSession,
            task: URLSessionTask,
            willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest,
            completionHandler: @escaping @Sendable (URLRequest?) -> Void
        ) {
            completionHandler(nil)
        }
    }

    private struct AuthResponse: Decodable {
        let accessToken: String
        let refreshToken: String?
        let expiresIn: Int?

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
        }
    }

    private struct WorkspaceResponse: Decodable {
        let workspaces: [EduPiRemoteWorkspace]
    }

    private struct SnapshotResponse: Decodable {
        let contract: Contract
        let payload: EduPiRemoteSnapshotPayload
        let externalSend: Bool

        struct Contract: Decodable {
            let contractID: String
            let contractVersion: String
            let schemaHash: String

            enum CodingKeys: String, CodingKey {
                case contractID = "contract_id"
                case contractVersion = "contract_version"
                case schemaHash = "schema_hash"
            }
        }

        enum CodingKeys: String, CodingKey {
            case contract
            case payload
            case externalSend = "external_send"
        }
    }

    private struct StudentEventsResponse: Decodable {
        let records: [EduPiRemoteStudentEvent]
    }

    private struct CloudSnapshotIdentity: Decodable {
        let ok: Bool
        let operation: String
        let snapshotID: String
        let stateHash: String
        let externalSend: Bool

        enum CodingKeys: String, CodingKey {
            case ok, operation
            case snapshotID = "snapshot_id"
            case stateHash = "state_hash"
            case externalSend = "external_send"
        }
    }

    private struct CloudCommandResponse: Decodable {
        let ok: Bool
        let operation: String
        let requestID: String
        let externalSend: Bool

        enum CodingKeys: String, CodingKey {
            case ok, operation
            case requestID = "request_id"
            case externalSend = "external_send"
        }
    }

    private struct StudentEventMutationResponse: Decodable {
        let ok: Bool
        let record: EduPiRemoteStudentEvent?
        let externalSend: Bool

        enum CodingKeys: String, CodingKey {
            case ok, record
            case externalSend = "external_send"
        }
    }

    private struct PersistedSession: Codable {
        let baseURL: String
        let username: String
        let accessToken: String
        let refreshToken: String?
        let expiresAt: Date?
        let workspaceID: String?
        let account: EduPiCloudAccount?
    }

    private static let workspaceDefaultsPrefix = "edupi.workspace."
    private static weak var activeSession: EduPiRemoteAPI?
    private static let transport: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    private let sessionStore: EduPiSessionStore
    private let transport: URLSession
    private let outbox: EduPiCloudOutbox
    private let defaults: UserDefaults
    let baseURL: URL
    private(set) var username: String
    private let publishableKey: String?
    private(set) var workspaceID: String?
    private(set) var workspaces: [EduPiRemoteWorkspace] = []
    private var account: EduPiCloudAccount?
    private var accessToken: String?
    private var refreshToken: String?
    private var expiresAt: Date?
    private var sessionGeneration = UUID()
    private var tokenRevision = 0
    private var refreshTask: Task<Void, Error>?
    private var replayTask: Task<[EduPiRemoteTask], Error>?
    private var chatReplayTask: Task<Void, Error>?
    private var sessionActivated = false

    init(
        baseURLString: String,
        transport: URLSession? = nil,
        sessionStore: EduPiSessionStore? = nil,
        outbox: EduPiCloudOutbox? = nil,
        defaults: UserDefaults = .standard
    ) throws {
        self.transport = transport ?? Self.transport
        self.sessionStore = sessionStore ?? EduPiKeychainSessionStore(service: "com.abcwyc.edupi")
        self.outbox = outbox ?? EduPiCloudOutbox()
        self.defaults = defaults
        let normalized = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: normalized),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil
        else {
            throw EduPiRemoteAPIError.invalidBaseURL
        }
        components.scheme = "https"
        while components.percentEncodedPath.hasSuffix("/") {
            components.percentEncodedPath.removeLast()
        }
        guard let url = components.url else {
            throw EduPiRemoteAPIError.invalidBaseURL
        }
        baseURL = url
        username = ""
        publishableKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String
    }

    var isAuthenticated: Bool {
        accessToken != nil
    }

    func signIn(username: String, password: String) async throws {
        try Task.checkCancellation()
        invalidateSession()
        let generation = sessionGeneration
        let account = username.contains("@") ? username : "\(username)@edupi.local"
        let response: AuthResponse = try await send(
            path: "/auth/v1/token",
            method: "POST",
            query: [URLQueryItem(name: "grant_type", value: "password")],
            body: ["email": account, "password": password],
            requiresAuthentication: false
        )
        try requireCurrentSession(generation)
        self.account = try EduPiCloudAccount(accessToken: response.accessToken)
        self.username = username
        accessToken = response.accessToken
        refreshToken = response.refreshToken
        expiresAt = response.expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) }
        do {
            try await loadWorkspaces()
            try requireCurrentSession(generation)
        } catch {
            if generation == sessionGeneration { invalidateSession() }
            throw error
        }
    }

    func activateSession() throws {
        try Task.checkCancellation()
        guard accessToken != nil, account != nil else { throw EduPiRemoteAPIError.unauthorized }
        try persistSession()
        claimActiveSession()
    }

    func restoreSession() -> Bool {
        guard !Task.isCancelled,
              let session = readPersistedSession(),
              session.baseURL == baseURL.absoluteString,
              let restoredAccount = try? EduPiCloudAccount(accessToken: session.accessToken),
              session.account == nil || session.account == restoredAccount else {
            return false
        }
        invalidateSession()
        username = session.username
        accessToken = session.accessToken
        refreshToken = session.refreshToken
        expiresAt = session.expiresAt
        workspaceID = session.workspaceID
        account = restoredAccount
        claimActiveSession()
        return true
    }

    func signOut() {
        invalidateSession()
        if Self.activeSession === self {
            deletePersistedSession()
            Self.activeSession = nil
        }
    }

    private func claimActiveSession() {
        if Self.activeSession !== self {
            Self.activeSession?.invalidateSession()
        }
        Self.activeSession = self
        sessionActivated = true
    }

    private func invalidateSession() {
        sessionGeneration = UUID()
        sessionActivated = false
        refreshTask?.cancel()
        refreshTask = nil
        replayTask?.cancel()
        replayTask = nil
        chatReplayTask?.cancel()
        chatReplayTask = nil
        accessToken = nil
        refreshToken = nil
        expiresAt = nil
        workspaceID = nil
        workspaces = []
        account = nil
    }

    private func requireCurrentSession(_ generation: UUID) throws {
        try Task.checkCancellation()
        guard generation == sessionGeneration else {
            throw CancellationError()
        }
    }

    func loadDashboard() async throws -> EduPiRemoteDashboard {
        let generation = sessionGeneration
        try requireCurrentSession(generation)
        guard let workspaceID else {
            throw EduPiRemoteAPIError.noWorkspace
        }

        let snapshot: SnapshotResponse = try await send(
            path: "/functions/v1/edupi-core-broker",
            method: "POST",
            body: ["operation": "mobile-dashboard"],
            workspaceID: workspaceID
        )
        try requireCurrentSession(generation)

        guard snapshot.contract.contractID == "edupi-mobile-dashboard-v1",
              snapshot.contract.contractVersion == "1.0",
              snapshot.contract.schemaHash == "sha256:454a9b7b092faffd480b5e4c8380553279fe5d7102e9ca4b44cf9d599cd282d8",
              snapshot.payload.workspaceID == workspaceID,
              snapshot.externalSend == false else {
            throw EduPiRemoteAPIError.invalidResponse
        }

        return EduPiRemoteDashboard(
            workspaceID: workspaceID,
            students: snapshot.payload.students,
            tasks: snapshot.payload.tasks,
            calendar: snapshot.payload.calendar,
            timetable: snapshot.payload.timetable
        )
    }

    func createTask(title: String, note: String?, requestID: String? = nil) async throws -> EduPiCloudWriteResult {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, trimmedTitle.count <= 240 else {
            throw EduPiRemoteAPIError.server(statusCode: 400, message: "任务名称无效。")
        }
        let scope = try currentScope()
        let requestID = requestID ?? "ios-task-create-\(UUID().uuidString)"
        let trimmedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let taskNote = trimmedNote?.isEmpty == false ? trimmedNote : nil
        let command: [String: Any] = [
            "command_type": "create_task",
            "source": [
                "source_id": requestID,
                "source_kind": "teacher_message",
                "source_hash": "sha256:\(String(repeating: "0", count: 64))",
                "evidence_ids": [requestID],
            ],
            "task": [
                "task_id": requestID,
                "title": trimmedTitle,
                "due_date": NSNull(),
                "note": taskNote as Any? ?? NSNull(),
            ],
        ]
        return try await submit(EduPiCloudOutboxEntry(
            id: requestID, scope: scope, taskID: requestID, taskTitle: trimmedTitle,
            mutation: .create(title: trimmedTitle, note: taskNote),
            command: JSONSerialization.data(withJSONObject: command, options: [.sortedKeys]),
            messageID: "ios-cloud-command-\(UUID().uuidString)",
            issuedAt: ISO8601DateFormatter().string(from: Date())
        ))
    }

    func moveTask(
        taskID: String, expectedRevision: Int, to stage: EduPiTaskStage, taskTitle: String? = nil
    ) async throws -> EduPiCloudWriteResult {
        guard !taskID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, expectedRevision >= 0 else {
            throw EduPiRemoteAPIError.server(statusCode: 400, message: "任务身份无效。")
        }
        let scope = try currentScope()
        let mutation = EduPiCloudOutboxEntry.Mutation.move(stage: stage, expectedRevision: expectedRevision)
        // A repeated tap (including after restart) reuses the original queued command.
        if let pending = try pendingWrites().first(where: { $0.taskID == taskID }) {
            guard pending.mutation == mutation else { throw EduPiCloudOutboxError.taskPending }
            return try await submit(pending)
        }
        let requestID = "ios-task-move-\(UUID().uuidString)"
        let command: [String: Any] = [
            "command_type": "move_task_stage",
            "source": [
                "source_id": taskID,
                "source_kind": "teacher_message",
                "source_hash": "sha256:\(String(repeating: "0", count: 64))",
                "evidence_ids": [taskID],
            ],
            "task_id": taskID,
            "expected_revision": expectedRevision,
            "to_stage": stage.rawValue,
            "note": NSNull(),
        ]
        return try await submit(EduPiCloudOutboxEntry(
            id: requestID, scope: scope, taskID: taskID, taskTitle: taskTitle ?? taskID, mutation: mutation,
            command: JSONSerialization.data(withJSONObject: command, options: [.sortedKeys]),
            messageID: "ios-cloud-command-\(UUID().uuidString)",
            issuedAt: ISO8601DateFormatter().string(from: Date())
        ))
    }

    func updateStudentEvent(eventID: String, expectedRevision: Int, summary: String, topic: String?, observedOn: String?) async throws -> EduPiRemoteStudentEvent {
        let response: StudentEventMutationResponse = try await send(
            path: "/functions/v1/edupi-student-events",
            method: "POST",
            body: [
                "action": "update_event",
                "event_id": eventID,
                "expected_revision": expectedRevision,
                "summary": summary,
                "topic": topic ?? NSNull(),
                "observed_on": observedOn ?? NSNull(),
                "request_id": "ios-student-event-\(UUID().uuidString)",
            ],
            workspaceID: try requiredWorkspaceID()
        )
        guard response.ok, response.externalSend == false, let record = response.record else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return record
    }

    func deleteStudentEvent(eventID: String, expectedRevision: Int) async throws {
        let response: StudentEventMutationResponse = try await send(
            path: "/functions/v1/edupi-student-events",
            method: "POST",
            body: [
                "action": "delete_event",
                "event_id": eventID,
                "expected_revision": expectedRevision,
                "request_id": "ios-student-event-delete-\(UUID().uuidString)",
            ],
            workspaceID: try requiredWorkspaceID()
        )
        guard response.ok, response.externalSend == false else {
            throw EduPiRemoteAPIError.invalidResponse
        }
    }

    private func requiredWorkspaceID() throws -> String {
        guard let workspaceID else { throw EduPiRemoteAPIError.noWorkspace }
        return workspaceID
    }

    func currentScope() throws -> EduPiCloudScope {
        guard sessionActivated, Self.activeSession === self, let account, accessToken != nil else {
            throw EduPiRemoteAPIError.unauthorized
        }
        return EduPiCloudScope(serverURL: baseURL.absoluteString, account: account, workspaceID: try requiredWorkspaceID())
    }

    func pendingWrites() throws -> [EduPiCloudOutboxEntry] {
        try outbox.entries(in: currentScope())
    }

    private func requireScope(_ scope: EduPiCloudScope, generation: UUID) throws {
        try requireCurrentSession(generation)
        guard try currentScope() == scope else { throw EduPiCloudOutboxError.scopeChanged }
    }

    private func submit(_ entry: EduPiCloudOutboxEntry) async throws -> EduPiCloudWriteResult {
        let generation = sessionGeneration
        try requireScope(entry.scope, generation: generation)
        try outbox.enqueue(entry)
        let tasks = try await replayOutbox(expectedScope: entry.scope)
        try requireScope(entry.scope, generation: generation)
        let pending = try pendingWrites().first { $0.id == entry.id }
        let task = tasks.first { $0.id == entry.taskID }
        guard pending != nil || task != nil else { throw EduPiRemoteAPIError.invalidResponse }
        return EduPiCloudWriteResult(requestID: entry.id, task: task, pending: pending)
    }

    // All callers join the same replay. Queue additions during an await are picked up
    // by the next iteration, so refresh and a save cannot send competing envelopes.
    func replayOutbox(expectedScope: EduPiCloudScope? = nil) async throws -> [EduPiRemoteTask] {
        let scope = try currentScope()
        if let expectedScope, expectedScope != scope { throw EduPiCloudOutboxError.scopeChanged }
        let generation = sessionGeneration
        if let replayTask { return try await replayTask.value }
        let task = Task { () async throws -> [EduPiRemoteTask] in
            defer {
                if generation == sessionGeneration { replayTask = nil }
            }
            var visited = Set<String>()
            var verified: [EduPiRemoteTask] = []
            while true {
                try requireScope(scope, generation: generation)
                guard var entry = try outbox.entries(in: scope).first(where: { $0.chatSessionID == nil && !$0.isBlocked && !visited.contains($0.id) }) else {
                    return verified
                }
                visited.insert(entry.id)
                do {
                    if entry.envelope == nil {
                        let snapshot: CloudSnapshotIdentity = try await send(
                            path: "/functions/v1/edupi-core-broker", method: "POST",
                            body: ["operation": "snapshot"], workspaceID: scope.workspaceID
                        )
                        try requireScope(scope, generation: generation)
                        guard snapshot.ok, snapshot.operation == "snapshot", !snapshot.snapshotID.isEmpty,
                              !snapshot.stateHash.isEmpty, snapshot.externalSend == false else {
                            throw EduPiRemoteAPIError.invalidResponse
                        }
                        entry.envelope = try makeEnvelope(entry, snapshotID: snapshot.snapshotID)
                        try outbox.update(entry)
                    }
                    if entry.state != .awaitingReadback {
                        try requireScope(scope, generation: generation)
                        let response: CloudCommandResponse = try await send(
                            path: "/functions/v1/edupi-core-broker", method: "POST",
                            rawBody: entry.envelope, workspaceID: scope.workspaceID
                        )
                        try requireScope(scope, generation: generation)
                        guard response.ok, response.operation == "command", response.requestID == entry.id,
                              response.externalSend == false else { throw EduPiRemoteAPIError.invalidResponse }
                        entry.state = .awaitingReadback
                        entry.lastError = nil
                        try outbox.update(entry)
                    }
                    let dashboard = try await loadDashboard()
                    try requireScope(scope, generation: generation)
                    guard let remote = dashboard.tasks.first(where: { $0.id == entry.taskID }),
                          dashboard.tasks.filter({ $0.id == entry.taskID }).count == 1,
                          entry.matches(remote) else { throw EduPiCloudOutboxError.readbackMismatch }
                    try outbox.complete(entry, verifiedTask: remote)
                    verified.append(remote)
                } catch {
                    try requireScope(scope, generation: generation)
                    if try retainFailedWrite(&entry, error: error) { return verified }
                }
            }
        }
        replayTask = task
        return try await task.value
    }

    private func makeEnvelope(_ entry: EduPiCloudOutboxEntry, snapshotID: String) throws -> Data {
        let revision: Int
        switch entry.mutation {
        case .create: revision = 0
        case let .move(_, expectedRevision): revision = expectedRevision
        case .chatCreate, .chatPrompt: throw EduPiRemoteAPIError.invalidResponse
        }
        return try JSONSerialization.data(withJSONObject: [
            "operation": "command",
            "envelope": [
                "contract_version": "1.1",
                "message_id": entry.messageID,
                "request_id": entry.id,
                "issued_at": entry.issuedAt,
                "producer": "edupi-ios",
                "schema_hash": "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8",
                "snapshot_id": snapshotID,
                "idempotency_key": entry.id,
                "provenance": [],
                "teacher_review": [
                    "state": "pending_review", "reviewer_id": NSNull(),
                    "reviewed_at": NSNull(), "note": NSNull(), "revision": revision,
                ],
                "external_send": false,
                "command": try JSONSerialization.jsonObject(with: entry.command),
            ],
        ], options: [.sortedKeys])
    }

    private func retainFailedWrite(_ entry: inout EduPiCloudOutboxEntry, error: Error) throws -> Bool {
        switch error {
        case EduPiRemoteAPIError.server(statusCode: 409, message: _),
             EduPiCloudOutboxError.readbackMismatch, EduPiCloudOutboxError.chatReadbackMismatch:
            entry.state = .conflict
        case EduPiRemoteAPIError.invalidResponse:
            entry.state = .failed
        case let EduPiRemoteAPIError.server(statusCode, _) where (400..<500).contains(statusCode):
            entry.state = .failed
        default: break
        }
        entry.lastError = error is URLError ? "网络不可用，已保存在本机，联网后可重试。" : error.localizedDescription
        try outbox.update(entry)
        switch error as? EduPiRemoteAPIError {
        case .unauthorized, .workspaceForbidden: throw error
        default: break
        }
        return !entry.isBlocked
    }

    func loadCloudSessions() async throws -> [EduPiCloudSession] {
        let scope = try currentScope()
        let response = try await sendChat(["action": "list"], scope: scope)
        guard let sessions = response.sessions,
              sessions.allSatisfy({ $0.workspaceID == scope.workspaceID }),
              Set(sessions.map(\.id)).count == sessions.count else { throw EduPiRemoteAPIError.invalidResponse }
        return sessions
    }

    func readCloudSession(_ id: String) async throws -> EduPiCloudConversation {
        let scope = try currentScope()
        let response = try await sendChat(["action": "read", "session_id": id], scope: scope)
        let statuses = ["queued", "claimed", "running", "completed", "failed", "uncertain", "cancelled"]
        guard let session = response.session, session.id == id, session.workspaceID == scope.workspaceID,
              let messages = response.messages, let requests = response.requests,
              messages.allSatisfy({ ["user", "assistant"].contains($0.role) && $0.message.role == $0.role }),
              requests.allSatisfy({ $0.sessionID == id && statuses.contains($0.status) }),
              Set(messages.map(\.id)).count == messages.count,
              Set(requests.map(\.id)).count == requests.count else { throw EduPiRemoteAPIError.invalidResponse }
        return EduPiCloudConversation(session: session, messages: messages, requests: requests)
    }

    func loadCloudEvents(sessionID: String, after: Int64) async throws -> [EduPiCloudChatEvent] {
        guard after >= 0 else { throw EduPiRemoteAPIError.invalidResponse }
        let response = try await sendChat(["action": "events", "session_id": sessionID, "after": after], scope: currentScope())
        guard let events = response.events, events.allSatisfy({ $0.id > after }),
              events.map(\.id) == events.map(\.id).sorted(), Set(events.map(\.id)).count == events.count else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return events
    }

    func configureCloudSession(
        sessionID: String,
        expectedRevision: Int,
        provider: String?,
        modelID: String?,
        thinkingLevel: String,
        requestID: String = "ios-chat-configure-\(UUID().uuidString)"
    ) async throws -> Int {
        guard expectedRevision >= 0,
              ["off", "minimal", "low", "medium", "high", "xhigh"].contains(thinkingLevel),
              (provider == nil) == (modelID == nil),
              provider?.isEmpty != true, modelID?.isEmpty != true else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        var body: [String: Any] = [
            "action": "configure",
            "session_id": sessionID,
            "request_id": requestID,
            "expected_revision": expectedRevision,
            "thinking_level": thinkingLevel,
        ]
        if let provider, let modelID {
            body["model"] = ["provider": provider, "modelId": modelID]
        }
        let response = try await sendChat(body, scope: currentScope())
        guard response.sessionID == sessionID, response.revision == expectedRevision + 1 else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return expectedRevision + 1
    }

    func cancelCloudSession(
        sessionID: String,
        requestID: String = "ios-chat-cancel-\(UUID().uuidString)"
    ) async throws -> Int {
        let response = try await sendChat([
            "action": "cancel",
            "session_id": sessionID,
            "request_id": requestID,
        ], scope: currentScope())
        guard response.sessionID == sessionID, let revision = response.revision else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return revision
    }

    func loadCloudStudents(
        requestID: String = "ios-students-list-\(UUID().uuidString)"
    ) async throws -> [EduPiCloudStudent] {
        let scope = try currentScope()
        let response: EduPiCloudStudentsResponse = try await send(
            path: "/functions/v1/edupi-students",
            method: "POST",
            body: ["action": "list", "request_id": requestID],
            workspaceID: scope.workspaceID
        )
        guard response.ok, response.operation == "students", response.action == "list",
              response.requestID == requestID, response.workspaceID == scope.workspaceID,
              response.contract.isSupported, response.externalSend == false,
              response.students.count <= 500,
              Set(response.students.map(\.id)).count == response.students.count else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return response.students
    }

    func createCloudSession(
        title: String = "新对话",
        sessionID: String = "ios-chat-\(UUID().uuidString)",
        requestID: String = "ios-chat-create-\(UUID().uuidString)"
    ) async throws -> EduPiCloudChatWriteResult {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard title.count <= 240 else { throw EduPiRemoteAPIError.invalidResponse }
        return try await submitChat(
            ["action": "create", "session_id": sessionID, "request_id": requestID, "title": title],
            mutation: .chatCreate(sessionID: sessionID, title: title), title: title
        )
    }

    func enqueueCloudPrompt(
        sessionID: String, message: String, requestID: String = "ios-chat-prompt-\(UUID().uuidString)"
    ) async throws -> EduPiCloudChatWriteResult {
        let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, message.utf16.count <= 64_000 else { throw EduPiRemoteAPIError.invalidResponse }
        return try await submitChat([
            "action": "enqueue", "session_id": sessionID, "request_id": requestID,
            "command": ["type": "prompt", "message": message, "clientRequestId": requestID],
        ], mutation: .chatPrompt(sessionID: sessionID, message: message), title: String(message.prefix(80)))
    }

    private func submitChat(
        _ body: [String: Any], mutation: EduPiCloudOutboxEntry.Mutation, title: String
    ) async throws -> EduPiCloudChatWriteResult {
        let scope = try currentScope()
        let generation = sessionGeneration
        guard let id = body["request_id"] as? String, let sessionID = body["session_id"] as? String,
              [id, sessionID].allSatisfy({ !$0.isEmpty && $0.utf16.count <= 160 && !$0.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) }) else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        let bytes = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        try outbox.enqueue(EduPiCloudOutboxEntry(
            id: id, scope: scope, taskID: sessionID, taskTitle: title, mutation: mutation,
            command: bytes, messageID: id, issuedAt: ISO8601DateFormatter().string(from: Date()), envelope: bytes
        ))
        try await replayChatOutbox(expectedScope: scope)
        try requireScope(scope, generation: generation)
        return EduPiCloudChatWriteResult(requestID: id, sessionID: sessionID, pending: try pendingWrites().first { $0.id == id })
    }

    func replayChatOutbox(expectedScope: EduPiCloudScope? = nil) async throws {
        let scope = try currentScope()
        if let expectedScope, expectedScope != scope { throw EduPiCloudOutboxError.scopeChanged }
        let generation = sessionGeneration
        if let chatReplayTask { return try await chatReplayTask.value }
        let task = Task { () async throws -> Void in
            defer {
                if generation == sessionGeneration { chatReplayTask = nil }
            }
            var visited = Set<String>()
            while true {
                try requireScope(scope, generation: generation)
                let entries = try pendingWrites()
                guard var entry = entries.first(where: { $0.chatSessionID != nil && !$0.isBlocked && !visited.contains($0.id) }),
                      let sessionID = entry.chatSessionID else { return }
                visited.insert(entry.id)
                if case .chatPrompt = entry.mutation,
                   entries.contains(where: {
                       if case let .chatCreate(dependencySession, _) = $0.mutation { return dependencySession == sessionID }
                       return false
                   }) {
                    // A failed create cannot cause a dependent prompt to be sent to
                    // another conversation. Independent sessions can still proceed.
                    continue
                }
                do {
                    if entry.state != .awaitingReadback {
                        let body = try JSONSerialization.jsonObject(with: entry.command) as? [String: Any]
                        guard let body, entry.envelope == entry.command else { throw EduPiRemoteAPIError.invalidResponse }
                        _ = try await sendChat(body, rawBody: entry.command, scope: scope)
                        try requireScope(scope, generation: generation)
                        entry.state = .awaitingReadback
                        entry.lastError = nil
                        try outbox.update(entry)
                    }
                    let readback = try await readCloudSession(sessionID)
                    try requireScope(scope, generation: generation)
                    try outbox.completeChat(entry, conversation: readback)
                } catch {
                    try requireScope(scope, generation: generation)
                    if try retainFailedWrite(&entry, error: error) { return }
                }
            }
        }
        chatReplayTask = task
        try await task.value
    }

    private func sendChat(
        _ body: [String: Any], rawBody: Data? = nil, scope: EduPiCloudScope
    ) async throws -> EduPiCloudChatResponse {
        let generation = sessionGeneration
        try requireScope(scope, generation: generation)
        let response: EduPiCloudChatResponse = try await send(
            path: "/functions/v1/edupi-sessions", method: "POST",
            body: rawBody == nil ? body : nil, rawBody: rawBody, workspaceID: scope.workspaceID
        )
        try requireScope(scope, generation: generation)
        guard response.ok, response.operation == "sessions", response.action == body["action"] as? String,
              response.contract.isSupported, response.externalSend == false,
              response.workspaceID == scope.workspaceID || (response.action == "enqueue" && response.workspaceID == nil) else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        if let requestID = body["request_id"] as? String {
            guard response.requestID == requestID else { throw EduPiRemoteAPIError.invalidResponse }
        }
        if response.action == "enqueue" {
            guard response.sessionID == body["session_id"] as? String else { throw EduPiRemoteAPIError.invalidResponse }
        }
        return response
    }

    func loadStudentEvents(studentID: String? = nil) async throws -> [EduPiRemoteStudentEvent] {
        guard let workspaceID else {
            throw EduPiRemoteAPIError.noWorkspace
        }
        var query = [URLQueryItem(name: "limit", value: "50")]
        if let studentID {
            guard !studentID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  studentID.utf16.count <= 160,
                  !studentID.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
                throw EduPiRemoteAPIError.invalidStudentID
            }
            query.append(URLQueryItem(name: "student_id", value: studentID))
        }
        let response: StudentEventsResponse = try await send(
            path: "/functions/v1/edupi-student-events",
            method: "GET",
            query: query,
            workspaceID: workspaceID
        )
        return response.records
    }

    func loadResources(_ shelf: EduPiResourceShelf) async throws -> [EduPiRemoteResource] {
        guard let workspaceID else {
            throw EduPiRemoteAPIError.noWorkspace
        }
        return try await send(
            path: "/rest/v1/\(shelf.rawValue)",
            method: "GET",
            query: [
                URLQueryItem(name: "select", value: shelf.fields),
                URLQueryItem(name: "workspace_id", value: "eq.\(workspaceID)"),
                URLQueryItem(name: "deleted_at", value: "is.null"),
                shelf.statusFilter,
                URLQueryItem(name: "order", value: shelf.order),
                URLQueryItem(name: "limit", value: "50"),
            ],
            acceptProfile: "edupi"
        )
    }

    func loadWorkspaces() async throws {
        let generation = sessionGeneration
        let response: WorkspaceResponse = try await send(
            path: "/functions/v1/edupi-account",
            method: "GET"
        )
        try requireCurrentSession(generation)
        workspaces = response.workspaces.filter { $0.mode == "cloud" }
        if let workspaceID {
            guard workspaces.contains(where: { $0.id == workspaceID }) else {
                throw EduPiRemoteAPIError.workspaceForbidden
            }
        } else if let key = workspacePreferenceKey,
                  let storedID = defaults.string(forKey: key),
                  workspaces.contains(where: { $0.id == storedID }) {
            workspaceID = storedID
        }
    }

    private var workspacePreferenceKey: String? {
        guard let account else { return nil }
        let identity = EduPiCloudScope(serverURL: baseURL.absoluteString, account: account, workspaceID: "selected-workspace")
        return "\(Self.workspaceDefaultsPrefix)\(identity.storageKey)"
    }

    func chooseWorkspace(_ id: String) throws {
        guard workspaces.contains(where: { $0.id == id && $0.mode == "cloud" }) else {
            throw EduPiRemoteAPIError.workspaceForbidden
        }
        guard id != workspaceID else { return }
        let previous = workspaceID
        sessionGeneration = UUID()
        replayTask?.cancel()
        replayTask = nil
        chatReplayTask?.cancel()
        chatReplayTask = nil
        refreshTask?.cancel()
        refreshTask = nil
        workspaceID = id
        do {
            if sessionActivated { try persistSession() }
        } catch {
            workspaceID = previous
            throw error
        }
        if let key = workspacePreferenceKey { defaults.set(id, forKey: key) }
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        body: [String: Any]? = nil,
        rawBody: Data? = nil,
        workspaceID: String? = nil,
        acceptProfile: String? = nil,
        requiresAuthentication: Bool = true
    ) async throws -> Response {
        let generation = sessionGeneration
        try requireCurrentSession(generation)
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw EduPiRemoteAPIError.invalidBaseURL
        }
        components.percentEncodedPath += path
        if !query.isEmpty {
            components.queryItems = query
            components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        guard let url = components.url else {
            throw EduPiRemoteAPIError.invalidBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let acceptProfile {
            request.setValue(acceptProfile, forHTTPHeaderField: "Accept-Profile")
        }
        if let publishableKey, !publishableKey.isEmpty {
            request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        } else if let rawBody {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = rawBody
        }
        if let workspaceID {
            guard workspaceID == self.workspaceID else { throw EduPiCloudOutboxError.scopeChanged }
            request.setValue(workspaceID, forHTTPHeaderField: "x-edupi-workspace-id")
        }

        let sentTokenRevision = tokenRevision
        if requiresAuthentication {
            try authorize(&request)
        }
        var (data, http) = try await execute(request, generation: generation)
        try requireCurrentSession(generation)
        if http.statusCode == 401, requiresAuthentication, refreshToken != nil {
            try await refreshAccessToken(for: sentTokenRevision)
            try requireCurrentSession(generation)
            try authorize(&request)
            (data, http) = try await execute(request, generation: generation)
            try requireCurrentSession(generation)
        }

        guard (200..<300).contains(http.statusCode) else {
            let failure = try? JSONDecoder().decode(RemoteErrorBody.self, from: data)
            let code = failure?.code ?? http.value(forHTTPHeaderField: "x-sb-error-code")
            let invalidAuthCodes = [
                "invalid_credentials", "refresh_token_not_found", "refresh_token_already_used",
                "session_not_found", "session_expired",
            ]
            if http.statusCode == 401 || (path == "/auth/v1/token" && invalidAuthCodes.contains(code ?? "")) {
                throw EduPiRemoteAPIError.unauthorized
            }
            if http.statusCode == 403 && code == "workspace_forbidden" {
                throw EduPiRemoteAPIError.workspaceForbidden
            }
            throw EduPiRemoteAPIError.server(statusCode: http.statusCode, message: failure?.message ?? "服务请求失败。")
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw EduPiRemoteAPIError.invalidResponse
        }
    }

    private func authorize(_ request: inout URLRequest) throws {
        guard let accessToken else {
            throw EduPiRemoteAPIError.unauthorized
        }
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    }

    private func execute(_ request: URLRequest, generation: UUID) async throws -> (Data, HTTPURLResponse) {
        try requireCurrentSession(generation)
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return (data, http)
    }

    private struct RemoteErrorBody: Decodable {
        let code: String?
        let message: String?

        enum CodingKeys: String, CodingKey {
            case code, error, msg, message
            case authCode = "error_code"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            code = (try? container.decode(String.self, forKey: .authCode))
                ?? (try? container.decode(String.self, forKey: .code))
            message = (try? container.decode(String.self, forKey: .error))
                ?? (try? container.decode(String.self, forKey: .msg))
                ?? (try? container.decode(String.self, forKey: .message))
        }
    }

    private func refreshAccessToken(for rejectedRevision: Int) async throws {
        guard rejectedRevision == tokenRevision else { return }
        if let refreshTask {
            try await refreshTask.value
            return
        }
        guard let refreshToken else {
            throw EduPiRemoteAPIError.unauthorized
        }
        let generation = sessionGeneration
        let task = Task {
            defer {
                if generation == sessionGeneration { refreshTask = nil }
            }
            try requireCurrentSession(generation)
            let response: AuthResponse = try await send(
                path: "/auth/v1/token",
                method: "POST",
                query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                body: ["refresh_token": refreshToken],
                requiresAuthentication: false
            )
            try requireCurrentSession(generation)
            guard try EduPiCloudAccount(accessToken: response.accessToken) == account else {
                throw EduPiRemoteAPIError.unauthorized
            }
            accessToken = response.accessToken
            self.refreshToken = response.refreshToken ?? refreshToken
            expiresAt = response.expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) }
            tokenRevision += 1
            if sessionActivated {
                try persistSession()
            }
        }
        refreshTask = task
        try await task.value
    }

    private func persistSession() throws {
        guard let accessToken else {
            throw EduPiRemoteAPIError.unauthorized
        }
        let session = PersistedSession(
            baseURL: baseURL.absoluteString,
            username: username,
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt,
            workspaceID: workspaceID,
            account: account
        )
        let data = try JSONEncoder().encode(session)
        try sessionStore.write(data)
    }

    private func readPersistedSession() -> PersistedSession? {
        guard let data = sessionStore.read() else { return nil }
        return try? JSONDecoder().decode(PersistedSession.self, from: data)
    }

    private func deletePersistedSession() {
        sessionStore.delete()
    }

}
