import Foundation
import XCTest

@MainActor
final class TestSessionStore: EduPiSessionStore {
    var data: Data?
    func read() -> Data? { data }
    func write(_ data: Data) throws { self.data = data }
    func delete() { data = nil }
}

final class CloudURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    static var hold: ((URLRequest, CloudURLProtocol) -> Bool)?
    private var stopped = false
    private var capturedRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var stable = request
        if stable.httpBody == nil { stable.httpBody = EduPiCloudOutboxTests.requestData(request) }
        capturedRequest = stable
        if Self.hold?(stable, self) == true { return }
        resolve()
    }
    func resolve() {
        guard !stopped else { return }
        do {
            let (status, data) = try XCTUnwrap(Self.handler)(capturedRequest ?? request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() { stopped = true }
}

// Only the HTTPS boundary is replaced. Login, refresh, scoped disk persistence,
// command construction, response validation, and AppState are the production code.
private final class CloudServer {
    var accountID = "account-a"
    var issuer = "https://cloud.example.test/auth/v1"
    var offline = false
    var loseCommandResponse = false
    var forceConflict = false
    var unknownContract = false
    var corruptReadback = false
    var omitRevision = false
    var rejectCommandToken = false
    var refreshAccountID: String?
    var unknownChatContract = false
    var unknownChatHash = false
    var chatHashOverride: String?
    var corruptChatReadback = false
    var loseChatResponses = false
    var chatBodies: [Data] = []
    var chatActions: [String] = []
    var lastEventCursor: Int64?
    var sessions: [String: [String: [String: Any]]] = [:]
    var chatRequests: [String: [[String: Any]]] = [:]
    var chatMessages: [String: [[String: Any]]] = [:]
    var students: [[String: Any]] = [
        [
            "student_id": "student-a", "name": "合成学生", "class_name": "701",
            "traits": ["细致"], "parent_notes": ["合成备注"], "revision": 2,
            "profile_revision": 1, "updated_at": "2026-11-23T00:00:00Z",
        ],
    ]
    var workspaces: [[String: Any]] = [
        ["id": "workspace-a", "mode": "cloud"], ["id": "workspace-b", "mode": "cloud"],
        ["id": "local-workspace", "mode": "local"],
    ]
    var commandBodies: [Data] = []
    var commandWorkspaces: [String] = []
    var snapshots = 0
    var accountCreates = 0
    private var applied: [String: Data] = [:]
    var tasks: [String: [String: [String: Any]]] = [:]

    func handle(_ request: URLRequest) throws -> (Int, Data) {
        let body = try EduPiCloudOutboxTests.body(request)
        if offline { throw URLError(.notConnectedToInternet) }
        if request.url!.path == "/auth/v1/token" {
            let refreshed = body["refresh_token"] != nil
            let account = refreshed ? (refreshAccountID ?? accountID) : accountID
            return try EduPiCloudOutboxTests.json([
                "access_token": EduPiCloudOutboxTests.token(account: account, issuer: issuer),
                "refresh_token": "synthetic-refresh", "expires_in": 3600,
            ])
        }
        if request.url!.path == "/functions/v1/edupi-account" {
            if request.httpMethod == "POST" { accountCreates += 1 }
            return try EduPiCloudOutboxTests.json(["workspaces": workspaces])
        }
        let workspace = try XCTUnwrap(request.value(forHTTPHeaderField: "x-edupi-workspace-id"))
        if request.url!.path == "/functions/v1/edupi-sessions" {
            return try handleChat(body, bytes: XCTUnwrap(request.httpBody), workspace: workspace)
        }
        if request.url!.path == "/functions/v1/edupi-students" {
            return try handleStudents(body, workspace: workspace)
        }
        switch body["operation"] as? String {
        case "snapshot":
            snapshots += 1
            return try EduPiCloudOutboxTests.json([
                "ok": true, "operation": "snapshot", "snapshot_id": "snapshot-\(snapshots)",
                "state_hash": "sha256:synthetic-state", "external_send": false,
            ])
        case "command":
            if rejectCommandToken {
                return (401, Data("{\"code\":\"session_expired\"}".utf8))
            }
            let envelope = try XCTUnwrap(body["envelope"] as? [String: Any])
            let bytes = try XCTUnwrap(request.httpBody)
            let requestID = try XCTUnwrap(envelope["request_id"] as? String)
            commandBodies.append(bytes)
            commandWorkspaces.append(workspace)
            let key = "\(workspace):\(requestID)"
            if forceConflict || (applied[key] != nil && applied[key] != bytes) {
                return (409, Data("{\"code\":\"idempotency_conflict\",\"message\":\"合成冲突：原请求不得覆盖\"}".utf8))
            }
            if applied[key] == nil {
                let command = try XCTUnwrap(envelope["command"] as? [String: Any])
                if command["command_type"] as? String == "create_task" {
                    let task = try XCTUnwrap(command["task"] as? [String: Any])
                    let taskID = try XCTUnwrap(task["task_id"] as? String)
                    tasks[workspace, default: [:]][taskID] = [
                        "task_id": taskID, "title": task["title"]!, "note": task["note"] ?? NSNull(),
                        "due_date": NSNull(), "stage": "todo", "status": "planned", "revision": 0,
                    ]
                } else {
                    let id = try XCTUnwrap(command["task_id"] as? String)
                    let expected = try XCTUnwrap(command["expected_revision"] as? Int)
                    guard var task = tasks[workspace]?[id], task["revision"] as? Int == expected else {
                        return (409, Data("{\"message\":\"stale_revision\"}".utf8))
                    }
                    task["stage"] = command["to_stage"]
                    task["revision"] = expected + 1
                    task["status"] = "accepted"
                    tasks[workspace]?[id] = task
                }
                applied[key] = bytes
            }
            if loseCommandResponse { throw URLError(.networkConnectionLost) }
            return try EduPiCloudOutboxTests.json([
                "ok": true, "operation": "command", "request_id": requestID, "external_send": false,
            ])
        case "mobile-dashboard":
            var rows = Array((tasks[workspace] ?? [:]).values)
            if corruptReadback {
                rows = rows.map { row in var row = row; row["title"] = "其他内容"; return row }
            }
            if omitRevision {
                rows = rows.map { row in var row = row; row.removeValue(forKey: "revision"); return row }
            }
            return try EduPiCloudOutboxTests.json([
                "contract": [
                    "contract_id": unknownContract ? "unknown-dashboard" : "edupi-mobile-dashboard-v1",
                    "contract_version": "1.0",
                    "schema_hash": "sha256:454a9b7b092faffd480b5e4c8380553279fe5d7102e9ca4b44cf9d599cd282d8",
                ],
                "payload": ["workspace_id": workspace, "tasks": rows, "students": [], "calendar": [], "timetable": []],
                "external_send": false,
            ])
        default: throw URLError(.badServerResponse)
        }
    }

    private func handleChat(_ body: [String: Any], bytes: Data, workspace: String) throws -> (Int, Data) {
        let action = try XCTUnwrap(body["action"] as? String)
        let sessionID = body["session_id"] as? String ?? ""
        let key = "\(workspace):\(sessionID)"
        var response: [String: Any] = [
            "ok": true, "operation": "sessions", "action": action, "workspace_id": workspace, "external_send": false,
            "contract": [
                "contract_id": unknownChatContract ? "unknown-cloud-sync" : "edupi-cloud-sync-v1",
                "contract_version": "1.0",
                "schema_hash": unknownChatHash ? "sha256:unknown" : (chatHashOverride ?? "sha256:2ef7b7849941bc6fd1cb1cff884b9d5ba4f08b8cb83dadaf8968529f3509c197"),
            ],
        ]
        switch action {
        case "list":
            response["sessions"] = Array((sessions[workspace] ?? [:]).values)
        case "create":
            chatBodies.append(bytes)
            chatActions.append(action)
            if sessions[workspace]?[sessionID] == nil {
                sessions[workspace, default: [:]][sessionID] = [
                    "session_id": sessionID, "workspace_id": workspace, "title": body["title"] ?? "",
                    "created_by": accountID,
                ]
            }
            response["session"] = sessions[workspace]?[sessionID]
            response["request_id"] = body["request_id"]
        case "configure":
            guard let session = sessions[workspace]?[sessionID] else {
                return (404, Data("{\"message\":\"session_not_found\"}".utf8))
            }
            let expected = try XCTUnwrap(body["expected_revision"] as? Int)
            let current = session["revision"] as? Int ?? 0
            guard expected == current else {
                return (409, Data("{\"message\":\"chat_request_changed\"}".utf8))
            }
            if let model = body["model"] { sessions[workspace]?[sessionID]?["model"] = model }
            sessions[workspace]?[sessionID]?["thinking_level"] = body["thinking_level"] ?? "off"
            sessions[workspace]?[sessionID]?["revision"] = expected + 1
            response["request_id"] = body["request_id"]
            response["session_id"] = sessionID
            response["revision"] = expected + 1
            chatBodies.append(bytes)
            chatActions.append(action)
        case "cancel":
            guard sessions[workspace]?[sessionID] != nil else {
                return (404, Data("{\"message\":\"session_not_found\"}".utf8))
            }
            for index in chatRequests[key, default: []].indices {
                chatRequests[key]?[index]["status"] = "cancelled"
            }
            let revision = (sessions[workspace]?[sessionID]?["revision"] as? Int ?? 0) + 1
            sessions[workspace]?[sessionID]?["revision"] = revision
            response["request_id"] = body["request_id"]
            response["session_id"] = sessionID
            response["revision"] = revision
            chatBodies.append(bytes)
            chatActions.append(action)
        case "enqueue":
            guard sessions[workspace]?[sessionID] != nil else {
                return (404, Data("{\"message\":\"session_not_found\"}".utf8))
            }
            chatBodies.append(bytes)
            chatActions.append(action)
            let requestID = try XCTUnwrap(body["request_id"] as? String)
            let command = try XCTUnwrap(body["command"] as? [String: Any])
            let existing = chatRequests[key, default: []].first { $0["request_id"] as? String == requestID }
            if let existing {
                let previous = try JSONSerialization.data(withJSONObject: existing["command"]!, options: [.sortedKeys])
                let current = try JSONSerialization.data(withJSONObject: command, options: [.sortedKeys])
                if previous != current { return (409, Data("{\"message\":\"idempotency_conflict\"}".utf8)) }
            } else {
                chatRequests[key, default: []].append([
                    "request_id": requestID, "session_id": sessionID, "actor_id": accountID,
                    "command": command, "status": "queued",
                ])
                chatMessages[key, default: []].append([
                    "message_id": "\(requestID):user", "request_id": requestID, "role": "user",
                    "message": ["role": "user", "content": command["message"]!, "timestamp": 1_700_000_000_000],
                ])
            }
            response["session_id"] = sessionID
            response["request_id"] = requestID
            response["status"] = "queued"
        case "read":
            guard let session = sessions[workspace]?[sessionID] else {
                return (404, Data("{\"message\":\"session_not_found\"}".utf8))
            }
            response["session"] = session
            response["messages"] = (chatMessages[key] ?? []).map { row in
                guard corruptChatReadback else { return row }
                var row = row
                row["message"] = ["role": "user", "content": "被改过的消息", "timestamp": 1_700_000_000_000] as [String: Any]
                return row
            }
            response["requests"] = chatRequests[key] ?? []
        case "events":
            lastEventCursor = (body["after"] as? NSNumber)?.int64Value
            response["events"] = (chatRequests[key] ?? []).enumerated().compactMap { index, request -> [String: Any]? in
                guard Int64(index + 1) > (lastEventCursor ?? 0) else { return nil }
                return [
                    "event_id": index + 1, "request_id": request["request_id"]!,
                    "event": ["type": "cloud_prompt_queued", "clientRequestId": request["request_id"]!],
                ]
            }
        default: throw URLError(.unsupportedURL)
        }
        if loseChatResponses && ["create", "enqueue"].contains(action) { throw URLError(.networkConnectionLost) }
        return try EduPiCloudOutboxTests.json(response)
    }

    private func handleStudents(_ body: [String: Any], workspace: String) throws -> (Int, Data) {
        guard body["action"] as? String == "list", let requestID = body["request_id"] as? String else {
            return (400, Data("{\"message\":\"invalid_request\"}".utf8))
        }
        return try EduPiCloudOutboxTests.json([
            "ok": true, "operation": "students", "action": "list", "request_id": requestID,
            "workspace_id": workspace, "students": students, "external_send": false,
            "contract": [
                "contract_id": "edupi-cloud-sync-v1",
                "contract_version": "1.0",
                "schema_hash": "sha256:2ef7b7849941bc6fd1cb1cff884b9d5ba4f08b8cb83dadaf8968529f3509c197",
            ],
        ])
    }
}

@MainActor
final class EduPiCloudOutboxTests: XCTestCase {
    private var transport: URLSession!
    private var sessionStore: TestSessionStore!
    private var server: CloudServer!
    private var directory: URL!
    private var defaults: UserDefaults!
    private var defaultsName: String!

    override func setUp() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudURLProtocol.self]
        transport = URLSession(configuration: configuration)
        sessionStore = TestSessionStore()
        server = CloudServer()
        CloudURLProtocol.handler = server.handle
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("edupi-outbox-test-\(UUID().uuidString)")
        defaultsName = "edupi.cloud.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: defaultsName)!
    }

    override func tearDown() async throws {
        transport.invalidateAndCancel()
        CloudURLProtocol.handler = nil
        CloudURLProtocol.hold = nil
        defaults.removePersistentDomain(forName: defaultsName)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    func testRetryKeepsFirstEnvelopeWhenCommandResponseIsLost() async throws {
        let api = try await login()
        server.loseCommandResponse = true
        let first = try await api.createTask(title: "合成测试任务", note: "不含教师数据", requestID: "retry-create")
        XCTAssertEqual(first.pending?.state, .queued)
        server.loseCommandResponse = false
        let second = try await api.createTask(title: "合成测试任务", note: "不含教师数据", requestID: "retry-create")
        XCTAssertEqual(second.task?.id, "retry-create")
        XCTAssertEqual(server.commandBodies.count, 2)
        XCTAssertEqual(server.commandBodies.first, server.commandBodies.last, "重试必须发送首次保存的完整 envelope")
        XCTAssertEqual(server.snapshots, 1, "重试不得重新生成快照")
        XCTAssertTrue(try api.pendingWrites().isEmpty)
        XCTAssertEqual(server.tasks["workspace-a"]?.count, 1)
        api.signOut()
    }

    func testLoginQueueReconstructReplayAndReadbackUsesDiskEnvelope() async throws {
        var api: EduPiRemoteAPI? = try await login()
        server.loseCommandResponse = true
        _ = try await api!.createTask(title: "重启回读", note: " 合成备注 ", requestID: "restart-create")
        let saved = try XCTUnwrap(api!.pendingWrites().first)
        let originalScope = try api!.currentScope()
        api = nil

        // A new API and a new outbox object read the saved session and bytes.
        let reconstructed = try makeAPI()
        XCTAssertTrue(reconstructed.restoreSession())
        XCTAssertEqual(try reconstructed.pendingWrites().first?.envelope, saved.envelope)
        server.loseCommandResponse = false
        let tasks = try await reconstructed.replayOutbox(expectedScope: originalScope)
        XCTAssertEqual(tasks.first?.note, "合成备注")
        XCTAssertEqual(server.commandBodies.count, 2)
        XCTAssertEqual(server.commandBodies[0], server.commandBodies[1])
        XCTAssertEqual(server.snapshots, 1)
        XCTAssertTrue(try reconstructed.pendingWrites().isEmpty)
        let readback = try await reconstructed.loadDashboard()
        XCTAssertEqual(readback.tasks.map(\.id), ["restart-create"])
    }

    func testOfflineQueueSurvivesReconstructionBeforeAnySnapshot() async throws {
        let api = try await login()
        server.offline = true
        let result = try await api.createTask(title: "离线任务", note: nil, requestID: "offline-create")
        let saved = try XCTUnwrap(result.pending)
        XCTAssertNil(saved.envelope)
        XCTAssertFalse(saved.command.isEmpty)
        XCTAssertNotNil(saved.lastError)
        XCTAssertEqual(server.snapshots, 0)
        let restored = try makeAPI()
        XCTAssertTrue(restored.restoreSession())
        XCTAssertEqual(try restored.pendingWrites().first?.id, "offline-create")
        XCTAssertEqual(try restored.pendingWrites().first?.command, saved.command)
        server.offline = false
        _ = try await restored.replayOutbox()
        XCTAssertTrue(try restored.pendingWrites().isEmpty)
        XCTAssertEqual(server.commandBodies.count, 1)
        XCTAssertEqual(server.tasks["workspace-a"]?["offline-create"]?["title"] as? String, "离线任务")
    }

    func testPrivatePartitionHasNoCredentialsAndIsExcludedFromBackup() async throws {
        let api = try await login()
        server.offline = true
        _ = try await api.createTask(title: "合成隐私测试", note: nil)
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        XCTAssertEqual(files.count, 1)
        let url = try XCTUnwrap(files.first)
        let bytes = try Data(contentsOf: url)
        let text = String(decoding: bytes, as: UTF8.self)
        for forbidden in ["access_token", "refresh_token", "fixture-password", "synthetic-refresh", "Authorization"] {
            XCTAssertFalse(text.contains(forbidden))
        }
        let mode = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(mode?.intValue, 0o600)
        let directoryMode = try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(directoryMode?.intValue, 0o700)
        XCTAssertEqual(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testSameRequestWithChangedCommandIsRejectedWithoutSending() async throws {
        let api = try await login()
        server.offline = true
        _ = try await api.createTask(title: "原任务", note: nil, requestID: "immutable")
        server.offline = false
        do {
            _ = try await api.createTask(title: "覆盖任务", note: nil, requestID: "immutable")
            XCTFail("不得覆盖首次命令")
        } catch {
            XCTAssertTrue(error is EduPiCloudOutboxError)
        }
        XCTAssertEqual(server.commandBodies.count, 0)
        XCTAssertEqual(try api.pendingWrites().first?.taskTitle, "原任务")
    }

    func testConflictStaysOnDiskAndDoesNotBlockIndependentTask() async throws {
        let api = try await login()
        server.forceConflict = true
        _ = try await api.createTask(title: "冲突任务", note: nil, requestID: "conflict")
        let original = try XCTUnwrap(api.pendingWrites().first)
        XCTAssertEqual(original.state, .conflict)
        XCTAssertTrue(original.lastError?.contains("合成冲突") == true)
        server.forceConflict = false
        _ = try await api.replayOutbox()
        XCTAssertEqual(server.commandBodies.count, 1, "刷新不得自动改写冲突请求")
        let result = try await api.createTask(title: "独立任务", note: nil, requestID: "independent")
        XCTAssertEqual(result.task?.id, "independent")
        XCTAssertEqual(try api.pendingWrites().map(\.id), ["conflict"])
        XCTAssertEqual(try api.pendingWrites().first?.envelope, original.envelope)
    }

    func testExactReadbackRejectsMatchingIDWithDifferentContent() async throws {
        let api = try await login()
        server.corruptReadback = true
        let result = try await api.createTask(title: "应保留的内容", note: nil)
        XCTAssertNil(result.task)
        XCTAssertEqual(result.pending?.state, .conflict)
        XCTAssertEqual(try api.pendingWrites().count, 1)
    }

    func testUnknownContractAndMissingRevisionNeverClearQueue() async throws {
        for malformedContract in [true, false] {
            let api = try await login()
            server.unknownContract = malformedContract
            server.omitRevision = !malformedContract
            let result = try await api.createTask(title: "合同校验", note: nil)
            XCTAssertNil(result.task)
            XCTAssertEqual(result.pending?.state, .failed)
            XCTAssertFalse(try api.pendingWrites().isEmpty)
            do {
                _ = try await api.loadDashboard()
                XCTFail("未知合同或缺少 revision 必须拒绝")
            } catch {
                guard case EduPiRemoteAPIError.invalidResponse = error else { return XCTFail("必须报告合同数据无效") }
            }
            api.signOut()
        }
    }

    func testMoveLostResponseReusesOriginalRevisionAndEnvelopeAfterRestart() async throws {
        let api = try await login()
        _ = try await api.createTask(title: "移动任务", note: nil, requestID: "move-target")
        server.loseCommandResponse = true
        let pending = try await api.moveTask(taskID: "move-target", expectedRevision: 0, to: .progress)
        let id = try XCTUnwrap(pending.pending?.id)
        let envelope = try XCTUnwrap(pending.pending?.envelope)
        let restored = try makeAPI()
        XCTAssertTrue(restored.restoreSession())
        server.loseCommandResponse = false
        let result = try await restored.moveTask(taskID: "move-target", expectedRevision: 0, to: .progress)
        XCTAssertEqual(result.requestID, id)
        XCTAssertEqual(result.task?.stage, "progress")
        XCTAssertEqual(result.task?.revision, 1)
        XCTAssertEqual(server.commandBodies.last, envelope)
        XCTAssertEqual(server.commandBodies[1], server.commandBodies[2])
        XCTAssertTrue(try restored.pendingWrites().isEmpty)
    }

    func testPendingMoveCannotBeReplacedByAnotherStage() async throws {
        let api = try await login()
        server.offline = true
        _ = try await api.moveTask(taskID: "move-target", expectedRevision: 4, to: .done)
        do {
            _ = try await api.moveTask(taskID: "move-target", expectedRevision: 4, to: .progress)
            XCTFail("不得替换待同步的移动命令")
        } catch {
            guard case EduPiCloudOutboxError.taskPending = error else { return XCTFail("应报告任务待同步") }
        }
        XCTAssertEqual(try api.pendingWrites().count, 1)
    }

    func testAccountIssuerServerAndWorkspacePartitionsCannotReplayEachOther() async throws {
        let original = try await login()
        let scope = try original.currentScope()
        server.offline = true
        _ = try await original.createTask(title: "隔离任务", note: nil, requestID: "isolated")
        server.offline = false

        for change in ["account", "issuer", "server", "workspace"] {
            server.accountID = change == "account" ? "account-b" : "account-a"
            server.issuer = change == "issuer" ? "https://other.example.test/auth/v1" : "https://cloud.example.test/auth/v1"
            let next = try await login(baseURL: change == "server" ? "https://other.example.test" : "https://cloud.example.test",
                                       workspace: change == "workspace" ? "workspace-b" : "workspace-a")
            XCTAssertTrue(try next.pendingWrites().isEmpty)
            do {
                _ = try await next.replayOutbox(expectedScope: scope)
                XCTFail("跨 scope 必须拒绝")
            } catch {
                guard case EduPiCloudOutboxError.scopeChanged = error else { return XCTFail("应报告 scope 已切换") }
            }
        }
        XCTAssertTrue(server.commandBodies.isEmpty)
        XCTAssertEqual(try EduPiCloudOutbox(directory: directory).entries(in: scope).map(\.id), ["isolated"])
    }

    func testWorkspaceSelectionNeverDefaultsToFirstOrCreatesWorkspace() async throws {
        let api = try makeAPI()
        try await api.signIn(username: "synthetic-teacher", password: "fixture-password")
        try api.activateSession()
        XCTAssertNil(api.workspaceID)
        XCTAssertEqual(api.workspaces.map(\.id), ["workspace-a", "workspace-b"])
        do {
            try api.chooseWorkspace("local-workspace")
            XCTFail("本地工作区不得作为云端写入目标")
        } catch {}
        try api.chooseWorkspace("workspace-b")
        XCTAssertEqual(try api.currentScope().workspaceID, "workspace-b")
        XCTAssertEqual(server.accountCreates, 0)
        api.signOut()
        server.accountID = "account-b"
        let another = try makeAPI()
        try await another.signIn(username: "synthetic-teacher", password: "fixture-password")
        XCTAssertNil(another.workspaceID, "同名的其他账号不得继承工作区选择")
    }

    func testScopeChangeDuringSnapshotPreventsCommandSend() async throws {
        let api = try await login()
        let waiting = expectation(description: "snapshot suspended")
        var held: CloudURLProtocol?
        CloudURLProtocol.hold = { request, loader in
            guard (try? Self.body(request)["operation"] as? String) == "snapshot" else { return false }
            held = loader
            waiting.fulfill()
            return true
        }
        let writing = Task { try await api.createTask(title: "旧 scope 命令", note: nil) }
        await fulfillment(of: [waiting], timeout: 3)
        try api.chooseWorkspace("workspace-b")
        CloudURLProtocol.hold = nil
        held?.resolve()
        do { _ = try await writing.value; XCTFail("旧 scope 请求必须停止") } catch {}
        XCTAssertTrue(server.commandBodies.isEmpty)
    }

    func testForegroundRefreshReplaysOfflineQueueAndUpdatesAppState() async throws {
        let state = try await signedInState()
        server.offline = true
        let accepted = await state.createTask(title: "前台恢复", note: "", requestID: "foreground")
        XCTAssertTrue(accepted, "已持久保存的离线任务可以关闭编辑器")
        XCTAssertEqual(state.pendingWrites.map(\.id), ["foreground"])
        XCTAssertTrue(state.dashboard.tasks.isEmpty)
        server.offline = false
        await state.becameActive()
        XCTAssertTrue(state.pendingWrites.isEmpty)
        XCTAssertEqual(state.dashboard.tasks.map(\.id), ["foreground"])
        XCTAssertNil(state.syncError)
    }

    func testVerifiedTaskWriteClearsEarlierNetworkError() async throws {
        let state = try await signedInState()
        server.offline = true
        await state.refresh()
        XCTAssertNotNil(state.syncError)
        server.offline = false
        let created = await state.createTask(title: "联网后保存", note: "", requestID: "online-write")
        XCTAssertTrue(created)
        XCTAssertNil(state.syncError, "写入和工作台合同回读成功后，不应继续提示网络不可用")
        server.offline = true
        await state.refresh()
        XCTAssertNotNil(state.syncError)
        server.offline = false
        let moved = await state.moveTask("online-write", to: .progress)
        XCTAssertTrue(moved)
        XCTAssertNil(state.syncError)
    }

    func testBusyCreateRejectsSecondTapAndOldAccountResponseCannotChangeNewUI() async throws {
        let state = try await signedInState()
        let waiting = expectation(description: "command suspended")
        var held: CloudURLProtocol?
        CloudURLProtocol.hold = { request, loader in
            guard (try? Self.body(request)["operation"] as? String) == "command" else { return false }
            held = loader
            waiting.fulfill()
            return true
        }
        let writing = Task { await state.createTask(title: "旧账号任务", note: "", requestID: "old-account") }
        await fulfillment(of: [waiting], timeout: 3)
        XCTAssertTrue(state.isCreatingTask)
        let second = await state.createTask(title: "重复点击", note: "")
        XCTAssertFalse(second)
        state.signOut()
        server.accountID = "account-b"
        await state.signIn(username: "second-teacher", password: "fixture-password", serverAddress: "https://cloud.example.test")
        await state.chooseWorkspace("workspace-a")
        CloudURLProtocol.hold = nil
        held?.resolve()
        let accepted = await writing.value
        XCTAssertFalse(accepted)
        XCTAssertEqual(state.accountName, "second-teacher")
        XCTAssertTrue(state.dashboard.tasks.isEmpty)
        XCTAssertTrue(state.pendingWrites.isEmpty)
        XCTAssertNil(state.mutationError)
        XCTAssertFalse(state.isCreatingTask)
    }

    func testLateMoveAfterSignOutDoesNotUseOldTaskIndexOrSetError() async throws {
        let state = try await signedInState()
        let created = await state.createTask(title: "移动隔离", note: "", requestID: "old-move")
        XCTAssertTrue(created)
        let waiting = expectation(description: "move suspended")
        var held: CloudURLProtocol?
        CloudURLProtocol.hold = { request, loader in
            guard (try? Self.body(request)["operation"] as? String) == "command" else { return false }
            held = loader
            waiting.fulfill()
            return true
        }
        let moving = Task { await state.moveTask("old-move", to: .done) }
        await fulfillment(of: [waiting], timeout: 3)
        XCTAssertTrue(state.movingTaskIDs.contains("old-move"))
        state.signOut()
        server.accountID = "account-b"
        server.tasks = [:]
        await state.signIn(username: "second-teacher", password: "fixture-password", serverAddress: "https://cloud.example.test")
        await state.chooseWorkspace("workspace-b")
        CloudURLProtocol.hold = nil
        held?.resolve()
        let accepted = await moving.value
        XCTAssertFalse(accepted)
        XCTAssertTrue(state.dashboard.tasks.isEmpty)
        XCTAssertNil(state.mutationError)
        XCTAssertTrue(state.movingTaskIDs.isEmpty)
    }

    func testCorruptQueueIsVisibleAndNeverOverwritten() async throws {
        let state = try await signedInState()
        server.offline = true
        _ = await state.createTask(title: "原内容", note: "", requestID: "corrupt")
        let url = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        let damaged = Data("synthetic-damaged-queue".utf8)
        try damaged.write(to: url)
        let accepted = await state.createTask(title: "不能覆盖", note: "")
        XCTAssertFalse(accepted)
        XCTAssertNotNil(state.mutationError)
        XCTAssertEqual(try Data(contentsOf: url), damaged)
    }

    func testTokenRefreshCannotChangeQueueAccount() async throws {
        let api = try await login()
        server.rejectCommandToken = true
        server.refreshAccountID = "account-b"
        do {
            _ = try await api.createTask(title: "令牌身份保持", note: nil, requestID: "refresh-scope")
            XCTFail("刷新令牌不得切换账号")
        } catch {
            guard case EduPiRemoteAPIError.unauthorized = error else { return XCTFail("必须重新登录") }
        }
        XCTAssertEqual(try api.pendingWrites().count, 1)
        XCTAssertTrue(server.commandBodies.isEmpty)
        XCTAssertEqual(try api.currentScope().account.accountID, "account-a")
    }

    func testOfflineChatCreateAndPromptRebuildReplayInOrderWithoutFakeReply() async throws {
        let api = try await login()
        server.offline = true
        let create = try await api.createCloudSession(title: "合成会话", sessionID: "offline-chat", requestID: "chat-create")
        XCTAssertNotNil(create.pending)
        let prompt = try await api.enqueueCloudPrompt(sessionID: "offline-chat", message: "合成消息", requestID: "chat-prompt")
        XCTAssertNotNil(prompt.pending)
        let originals = try api.pendingWrites()
        XCTAssertEqual(originals.count, 2)
        let restored = try makeAPI()
        XCTAssertTrue(restored.restoreSession())
        server.offline = false
        try await restored.replayChatOutbox()
        XCTAssertEqual(server.chatActions, ["create", "enqueue"])
        XCTAssertEqual(server.chatBodies, originals.map(\.command))
        XCTAssertTrue(try restored.pendingWrites().isEmpty)
        let chat = try await restored.readCloudSession("offline-chat")
        XCTAssertEqual(chat.messages.map(\.message.text), ["合成消息"])
        XCTAssertFalse(chat.messages.contains(where: { $0.role == "assistant" }))
        XCTAssertEqual(chat.requests.first?.status, "queued")
        XCTAssertEqual(chat.requests.first?.statusLabel, "已排队，等待桌面执行者")
        let list = try await restored.loadCloudSessions()
        XCTAssertEqual(list.map(\.id), ["offline-chat"])
    }

    func testLostChatPromptResponseReplaysSameRequestAndDoesNotDuplicateMessage() async throws {
        let api = try await login()
        _ = try await api.createCloudSession(title: "消息重试", sessionID: "retry-chat", requestID: "create-retry-chat")
        server.loseChatResponses = true
        _ = try await api.enqueueCloudPrompt(sessionID: "retry-chat", message: "第一次内容", requestID: "retry-prompt")
        let original = try XCTUnwrap(api.pendingWrites().first?.command)
        let restored = try makeAPI()
        XCTAssertTrue(restored.restoreSession())
        server.loseChatResponses = false
        try await restored.replayChatOutbox()
        XCTAssertEqual(server.chatBodies.last, original)
        XCTAssertEqual(server.chatBodies[1], server.chatBodies[2])
        let read = try await restored.readCloudSession("retry-chat")
        XCTAssertEqual(read.messages.count, 1)
        XCTAssertEqual(read.requests.count, 1)
        XCTAssertTrue(try restored.pendingWrites().isEmpty)
    }

    func testChatUnknownContractRejectsReadAndKeepsPendingRequest() async throws {
        let api = try await login()
        server.unknownChatContract = true
        let result = try await api.createCloudSession(title: "未知合同", sessionID: "unknown-chat", requestID: "unknown-chat-create")
        XCTAssertEqual(result.pending?.state, .failed)
        XCTAssertFalse(try api.pendingWrites().isEmpty)
        do {
            _ = try await api.loadCloudSessions()
            XCTFail("聊天也必须拒绝未知合同")
        } catch {
            guard case EduPiRemoteAPIError.invalidResponse = error else { return XCTFail("应报告合同无效") }
        }
    }

    func testChatScopeRefusesReplayBeforeAnyHTTPCall() async throws {
        let api = try await login()
        let scope = try api.currentScope()
        server.offline = true
        _ = try await api.createCloudSession(title: "旧账号会话", sessionID: "old-chat", requestID: "old-chat-create")
        server.offline = false
        server.accountID = "account-b"
        let another = try await login()
        do {
            try await another.replayChatOutbox(expectedScope: scope)
            XCTFail("跨账号聊天重放必须拒绝")
        } catch {
            guard case EduPiCloudOutboxError.scopeChanged = error else { return XCTFail("应报告 scope 已改变") }
        }
        XCTAssertTrue(server.chatBodies.isEmpty)
        XCTAssertTrue(try another.pendingWrites().isEmpty)
    }

    func testReadCloudMessagesAreRealRowsAndEventCursorIsForwarded() async throws {
        let api = try await login()
        _ = try await api.createCloudSession(title: "桌面回读", sessionID: "read-chat", requestID: "read-create")
        _ = try await api.enqueueCloudPrompt(sessionID: "read-chat", message: "合成用户消息", requestID: "read-prompt")
        server.chatMessages["workspace-a:read-chat", default: []].append([
            "message_id": "read-prompt:assistant", "request_id": "read-prompt", "role": "assistant",
            "message": ["role": "assistant", "content": [["type": "text", "text": "合成桌面回执"]], "timestamp": 1_700_000_000_001],
        ])
        server.chatRequests["workspace-a:read-chat"]?[0]["status"] = "completed"
        let read = try await api.readCloudSession("read-chat")
        XCTAssertEqual(read.messages.map(\.message.text), ["合成用户消息", "合成桌面回执"])
        XCTAssertEqual(read.requests.first?.status, "completed")
        let events = try await api.loadCloudEvents(sessionID: "read-chat", after: 0)
        XCTAssertEqual(events.first?.id, 1)
        _ = try await api.loadCloudEvents(sessionID: "read-chat", after: 1)
        XCTAssertEqual(server.lastEventCursor, 1)
    }

    func testOfflineChatAppStateShowsPendingAndForegroundReadsQueuedStatus() async throws {
        let state = try await signedInState()
        state.selectedTab = .chat
        server.offline = true
        let created = await state.createCloudConversation()
        XCTAssertTrue(created)
        let sent = await state.sendCloudMessage("离线合成消息")
        XCTAssertTrue(sent)
        XCTAssertNil(state.cloudConversation)
        XCTAssertEqual(state.pendingWrites.filter { $0.chatSessionID != nil }.count, 2)
        server.offline = false
        await state.becameActive()
        XCTAssertTrue(state.pendingWrites.isEmpty)
        XCTAssertEqual(state.cloudConversation?.messages.map(\.role), ["user"])
        XCTAssertEqual(state.cloudConversation?.requests.last?.status, "queued")
        state.signOut()
        XCTAssertNil(state.activeCloudSessionID)
        XCTAssertNil(state.cloudConversation)
        XCTAssertTrue(state.cloudSessions.isEmpty)
    }

    func testChatHashMismatchIsRejectedEvenWhenIDAndVersionMatch() async throws {
        let api = try await login()
        server.unknownChatHash = true
        do {
            _ = try await api.loadCloudSessions()
            XCTFail("未知 hash 不得因 id/version 相同而放行")
        } catch {
            guard case EduPiRemoteAPIError.invalidResponse = error else { return XCTFail("应报告合同无效") }
        }
    }

    func testPreviousCloudContractHashIsExplicitlyRejected() async throws {
        let api = try await login()
        server.chatHashOverride = "sha256:08d075f95b1cb86dbdc2f50ed5fbd72726a863b43d5df005b0b6888473f5b1c0"
        do {
            _ = try await api.loadCloudSessions()
            XCTFail("最终合同已变更，旧 hash 也必须拒绝")
        } catch {
            guard case EduPiRemoteAPIError.invalidResponse = error else { return XCTFail("应报告合同无效") }
        }
    }

    func testConfiguredSessionAndRecoveryStatusesDecodeWithoutAutomaticExecution() async throws {
        let api = try await login()
        _ = try await api.createCloudSession(title: "合同最终状态", sessionID: "final-chat", requestID: "final-create")
        _ = try await api.enqueueCloudPrompt(sessionID: "final-chat", message: "状态回读", requestID: "final-prompt")
        server.sessions["workspace-a"]?["final-chat"]?["model"] = ["provider": "synthetic-provider", "modelId": "synthetic-model"]
        server.sessions["workspace-a"]?["final-chat"]?["thinking_level"] = "high"
        server.sessions["workspace-a"]?["final-chat"]?["revision"] = 3
        for (status, label) in [
            ("uncertain", "执行结果待确认，请先在桌面核对"),
            ("running", "桌面正在处理"),
            ("cancelled", "已取消"),
        ] {
            server.chatRequests["workspace-a:final-chat"]?[0]["status"] = status
            let read = try await api.readCloudSession("final-chat")
            XCTAssertEqual(read.session.model?.modelID, "synthetic-model")
            XCTAssertEqual(read.session.thinkingLevel, "high")
            XCTAssertEqual(read.session.revision, 3)
            XCTAssertEqual(read.requests.first?.statusLabel, label)
            XCTAssertEqual(read.messages.map(\.role), ["user"])
            try await api.replayChatOutbox()
        }
        XCTAssertEqual(server.chatActions, ["create", "enqueue"], "恢复和取消状态只回读，不自动再次执行")
        server.chatRequests["workspace-a:final-chat"]?[0]["status"] = "unknown-state"
        do {
            _ = try await api.readCloudSession("final-chat")
            XCTFail("未知状态也不得当成成功")
        } catch {
            guard case EduPiRemoteAPIError.invalidResponse = error else { return XCTFail("应报告状态无效") }
        }
    }

    func testConfigureAndCancelUseFinalSessionActionsAndRevisionReadback() async throws {
        let api = try await login()
        _ = try await api.createCloudSession(title: "配置会话", sessionID: "configure-chat", requestID: "configure-create")
        let configured = try await api.configureCloudSession(
            sessionID: "configure-chat", expectedRevision: 0,
            provider: "synthetic-provider", modelID: "synthetic-model", thinkingLevel: "high",
            requestID: "configure-request"
        )
        XCTAssertEqual(configured, 1)
        let cancelled = try await api.cancelCloudSession(sessionID: "configure-chat", requestID: "cancel-request")
        XCTAssertEqual(cancelled, 2)
        let read = try await api.readCloudSession("configure-chat")
        XCTAssertEqual(read.session.model?.provider, "synthetic-provider")
        XCTAssertEqual(read.session.model?.modelID, "synthetic-model")
        XCTAssertEqual(read.session.thinkingLevel, "high")
        XCTAssertEqual(read.session.revision, 2)
        XCTAssertEqual(server.chatActions, ["create", "configure", "cancel"])
    }

    func testStudentsListUsesFinalContractIdentityAndRejectsDuplicateRows() async throws {
        let api = try await login()
        let students = try await api.loadCloudStudents(requestID: "students-list")
        XCTAssertEqual(students.map(\.id), ["student-a"])
        XCTAssertEqual(students.first?.className, "701")
        server.students.append(server.students[0])
        do {
            _ = try await api.loadCloudStudents(requestID: "students-duplicate")
            XCTFail("重复学生身份必须拒绝")
        } catch {
            guard case EduPiRemoteAPIError.invalidResponse = error else { return XCTFail("应报告学生列表无效") }
        }
    }

    func testChatExactReadbackKeepsRequestWhenUserMessageChanged() async throws {
        let api = try await login()
        _ = try await api.createCloudSession(title: "严格回读", sessionID: "strict-chat", requestID: "strict-create")
        server.corruptChatReadback = true
        let result = try await api.enqueueCloudPrompt(sessionID: "strict-chat", message: "首次原文", requestID: "strict-prompt")
        XCTAssertEqual(result.pending?.state, .conflict)
        let saved = try XCTUnwrap(api.pendingWrites().first?.command)
        server.corruptChatReadback = false
        try await api.replayChatOutbox()
        XCTAssertEqual(try api.pendingWrites().first?.command, saved)
        XCTAssertEqual(server.chatActions, ["create", "enqueue"])
    }

    func testBlockedChatCreatePreventsDependentPromptAndTasksStillSync() async throws {
        let api = try await login()
        server.unknownChatHash = true
        _ = try await api.createCloudSession(title: "被阻止会话", sessionID: "blocked-chat", requestID: "blocked-create")
        server.unknownChatHash = false
        _ = try await api.enqueueCloudPrompt(sessionID: "blocked-chat", message: "不得越过创建失败", requestID: "blocked-prompt")
        XCTAssertEqual(server.chatActions, ["create"])
        let task = try await api.createTask(title: "独立任务仍可同步", note: nil, requestID: "task-with-chat-conflict")
        XCTAssertEqual(task.task?.id, "task-with-chat-conflict")
        XCTAssertEqual(try api.pendingWrites().count, 2)
    }

    func testMultipleOfflinePromptsPreserveOrderAndTaskReplayDoesNotSendThem() async throws {
        let api = try await login()
        _ = try await api.createCloudSession(title: "多条离线消息", sessionID: "multi-chat", requestID: "multi-create")
        server.offline = true
        _ = try await api.enqueueCloudPrompt(sessionID: "multi-chat", message: "第一条", requestID: "first-prompt")
        _ = try await api.enqueueCloudPrompt(sessionID: "multi-chat", message: "第二条", requestID: "second-prompt")
        server.offline = false
        _ = try await api.replayOutbox()
        XCTAssertEqual(server.chatActions, ["create"])
        try await api.replayChatOutbox()
        let read = try await api.readCloudSession("multi-chat")
        XCTAssertEqual(read.messages.map(\.message.text), ["第一条", "第二条"])
        XCTAssertEqual(read.requests.map(\.id), ["first-prompt", "second-prompt"])
    }

    private func makeAPI(baseURL: String = "https://cloud.example.test") throws -> EduPiRemoteAPI {
        try EduPiRemoteAPI(baseURLString: baseURL, transport: transport, sessionStore: sessionStore,
                           outbox: EduPiCloudOutbox(directory: directory), defaults: defaults)
    }

    private func login(baseURL: String = "https://cloud.example.test", workspace: String = "workspace-a") async throws -> EduPiRemoteAPI {
        let api = try makeAPI(baseURL: baseURL)
        try await api.signIn(username: "synthetic-teacher", password: "fixture-password")
        try api.activateSession()
        try api.chooseWorkspace(workspace)
        return api
    }

    private func signedInState() async throws -> EduPiAppState {
        let state = EduPiAppState(settings: AppSettings(defaults: defaults)) { [self] address in try makeAPI(baseURL: address) }
        await state.restore()
        await state.signIn(username: "synthetic-teacher", password: "fixture-password", serverAddress: "https://cloud.example.test")
        await state.chooseWorkspace("workspace-a")
        XCTAssertEqual(state.phase, .ready)
        XCTAssertNil(state.syncError)
        return state
    }

    nonisolated static func body(_ request: URLRequest) throws -> [String: Any] {
        guard let data = requestData(request), !data.isEmpty else { return [:] }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    nonisolated static func requestData(_ request: URLRequest) -> Data? {
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            var collected = Data()
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                collected.append(buffer, count: count)
            }
            data = collected
        }
        return data
    }

    nonisolated static func json(_ object: [String: Any]) throws -> (Int, Data) {
        (200, try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
    }

    nonisolated static func token(account: String = "account-a", issuer: String = "https://cloud.example.test/auth/v1") -> String {
        let claims = try! JSONSerialization.data(withJSONObject: ["sub": account, "iss": issuer])
        let payload = claims.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return "synthetic.\(payload).signature"
    }
}
