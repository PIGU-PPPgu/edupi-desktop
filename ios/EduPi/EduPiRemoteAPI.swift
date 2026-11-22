import Foundation
import Security

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
        dueDate = try? container.decode(String.self, forKey: .dueDate)
        note = try? container.decode(String.self, forKey: .note)
        stage = (try? container.decode(String.self, forKey: .stage)) ?? "todo"
        status = (try? container.decode(String.self, forKey: .status)) ?? "planned"
        revision = (try? container.decode(Int.self, forKey: .revision)) ?? 0
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

    private struct CreateWorkspaceResponse: Decodable {
        let workspaceID: String

        enum CodingKeys: String, CodingKey {
            case workspaceID = "workspace_id"
        }
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
        let snapshotID: String
        let stateHash: String

        enum CodingKeys: String, CodingKey {
            case snapshotID = "snapshot_id"
            case stateHash = "state_hash"
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
    }

    private static let keychainAccount = "edupi.remote.session"
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

    private let keychainService = "com.abcwyc.edupi"
    let baseURL: URL
    private(set) var username: String
    private let publishableKey: String?
    private(set) var workspaceID: String?
    private var accessToken: String?
    private var refreshToken: String?
    private var expiresAt: Date?
    private var sessionGeneration = UUID()
    private var tokenRevision = 0
    private var refreshTask: Task<Void, Error>?
    private var sessionActivated = false

    init(baseURLString: String) throws {
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
        self.username = username
        accessToken = response.accessToken
        refreshToken = response.refreshToken
        expiresAt = response.expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) }
        do {
            try await selectWorkspace()
            try requireCurrentSession(generation)
        } catch {
            if generation == sessionGeneration { invalidateSession() }
            throw error
        }
    }

    func activateSession() throws {
        try Task.checkCancellation()
        guard let workspaceID else {
            throw EduPiRemoteAPIError.noWorkspace
        }
        try persistSession()
        claimActiveSession()
        UserDefaults.standard.set(workspaceID, forKey: "\(Self.workspaceDefaultsPrefix)\(username)")
    }

    func restoreSession() -> Bool {
        guard !Task.isCancelled,
              let session = readPersistedSession(),
              session.baseURL == baseURL.absoluteString else {
            return false
        }
        invalidateSession()
        username = session.username
        accessToken = session.accessToken
        refreshToken = session.refreshToken
        expiresAt = session.expiresAt
        workspaceID = session.workspaceID
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
        accessToken = nil
        refreshToken = nil
        expiresAt = nil
        workspaceID = nil
    }

    private func requireCurrentSession(_ generation: UUID) throws {
        try Task.checkCancellation()
        guard generation == sessionGeneration else {
            throw CancellationError()
        }
    }

    func loadDashboard() async throws -> EduPiRemoteDashboard {
        let generation = sessionGeneration
        if workspaceID == nil {
            try await selectWorkspace()
        }
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

    func createTask(title: String, note: String?, requestID: String? = nil) async throws -> EduPiRemoteTask {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, trimmedTitle.count <= 240 else {
            throw EduPiRemoteAPIError.server(statusCode: 400, message: "任务名称无效。")
        }
        let snapshot: CloudSnapshotIdentity = try await send(
            path: "/functions/v1/edupi-core-broker",
            method: "POST",
            body: ["operation": "snapshot"],
            workspaceID: try requiredWorkspaceID()
        )
        let requestID = requestID ?? "ios-task-create-\(UUID().uuidString)"
        let taskNote: Any = note?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? note! : NSNull()
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
                "note": taskNote,
            ],
        ]
        try await sendCloudCommand(command, snapshot: snapshot, requestID: requestID, revision: 0)
        guard let task = try await loadDashboard().tasks.first(where: { $0.id == requestID }) else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return task
    }

    func moveTask(taskID: String, expectedRevision: Int, to stage: EduPiTaskStage) async throws -> EduPiRemoteTask {
        guard !taskID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, expectedRevision >= 0 else {
            throw EduPiRemoteAPIError.server(statusCode: 400, message: "任务身份无效。")
        }
        let snapshot: CloudSnapshotIdentity = try await send(
            path: "/functions/v1/edupi-core-broker",
            method: "POST",
            body: ["operation": "snapshot"],
            workspaceID: try requiredWorkspaceID()
        )
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
        try await sendCloudCommand(command, snapshot: snapshot, requestID: requestID, revision: expectedRevision)
        guard let task = try await loadDashboard().tasks.first(where: { $0.id == taskID && $0.stage == stage.rawValue && $0.revision == expectedRevision + 1 }) else {
            throw EduPiRemoteAPIError.invalidResponse
        }
        return task
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

    private func sendCloudCommand(
        _ command: [String: Any],
        snapshot: CloudSnapshotIdentity,
        requestID: String,
        revision: Int
    ) async throws {
        let response: CloudCommandResponse = try await send(
            path: "/functions/v1/edupi-core-broker",
            method: "POST",
            body: [
                "operation": "command",
                "envelope": [
                    "contract_version": "1.1",
                    "message_id": "ios-cloud-command-\(UUID().uuidString)",
                    "request_id": requestID,
                    "issued_at": ISO8601DateFormatter().string(from: Date()),
                    "producer": "edupi-ios",
                    "schema_hash": "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8",
                    "snapshot_id": snapshot.snapshotID,
                    "idempotency_key": requestID,
                    "provenance": [],
                    "teacher_review": [
                        "state": "pending_review",
                        "reviewer_id": NSNull(),
                        "reviewed_at": NSNull(),
                        "note": NSNull(),
                        "revision": revision,
                    ],
                    "external_send": false,
                    "command": command,
                ],
            ],
            workspaceID: try requiredWorkspaceID()
        )
        guard response.ok, response.operation == "command", response.requestID == requestID, response.externalSend == false else {
            throw EduPiRemoteAPIError.invalidResponse
        }
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

    private func selectWorkspace() async throws {
        let generation = sessionGeneration
        let response: WorkspaceResponse = try await send(
            path: "/functions/v1/edupi-account",
            method: "GET"
        )
        try requireCurrentSession(generation)
        let defaultsKey = "\(Self.workspaceDefaultsPrefix)\(username)"
        let storedWorkspaceID = UserDefaults.standard.string(forKey: defaultsKey)
        let selectedID: String
        if let workspace = response.workspaces.first(where: { $0.id == storedWorkspaceID }) ?? response.workspaces.first {
            selectedID = workspace.id
        } else {
            let created: CreateWorkspaceResponse = try await send(
                path: "/functions/v1/edupi-account",
                method: "POST",
                body: [
                    "action": "create_workspace",
                    "request_id": "ios-workspace-\(UUID().uuidString)",
                    "mode": "cloud",
                ]
            )
            try requireCurrentSession(generation)
            selectedID = created.workspaceID
        }
        workspaceID = selectedID
        if sessionActivated {
            UserDefaults.standard.set(selectedID, forKey: defaultsKey)
        }
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        body: [String: Any]? = nil,
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
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if let workspaceID {
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
        let (data, response) = try await Self.transport.data(for: request)
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
            workspaceID: workspaceID
        )
        let data = try JSONEncoder().encode(session)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
        ]
        let updated = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, updated as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else {
            throw EduPiRemoteAPIError.sessionStorageUnavailable
        }
        var item = query
        item[kSecValueData as String] = data
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw EduPiRemoteAPIError.sessionStorageUnavailable
        }
    }

    private func readPersistedSession() -> PersistedSession? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(PersistedSession.self, from: data)
    }

    private func deletePersistedSession() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }

}
