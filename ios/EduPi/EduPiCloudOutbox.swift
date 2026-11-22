import CryptoKit
import Foundation

struct EduPiCloudAccount: Codable, Equatable {
    let issuer: String
    let accountID: String

    // Claims only partition local state. The server still authenticates every request.
    init(accessToken: String) throws {
        let parts = accessToken.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { throw EduPiRemoteAPIError.unauthorized }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
              let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let issuer = claims["iss"] as? String,
              let url = URLComponents(string: issuer), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              let accountID = claims["sub"] as? String,
              !accountID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EduPiRemoteAPIError.unauthorized
        }
        self.issuer = issuer
        self.accountID = accountID
    }
}

struct EduPiCloudScope: Codable, Equatable {
    let serverURL: String
    let account: EduPiCloudAccount
    let workspaceID: String

    var storageKey: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try! encoder.encode(self)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

enum EduPiCloudOutboxError: LocalizedError {
    case storageUnavailable
    case scopeChanged
    case requestConflict
    case taskPending
    case readbackMismatch
    case chatReadbackMismatch

    var errorDescription: String? {
        switch self {
        case .storageUnavailable: "无法读取或保存待同步任务，请保留当前内容后重试。"
        case .scopeChanged: "账号或工作区已切换，原请求已保留。"
        case .requestConflict: "此请求已保存过其他内容，原请求已保留。"
        case .taskPending: "此任务还有待同步的更改，请先同步。"
        case .readbackMismatch: "云端任务与本次更改不一致，原请求已保留。"
        case .chatReadbackMismatch: "云端会话与本次请求不一致，原消息已保留。"
        }
    }
}

struct EduPiCloudOutboxEntry: Codable, Identifiable {
    enum Mutation: Codable, Equatable {
        case create(title: String, note: String?)
        case move(stage: EduPiTaskStage, expectedRevision: Int)
        case chatCreate(sessionID: String, title: String)
        case chatPrompt(sessionID: String, message: String)
    }

    enum State: String, Codable {
        case queued, awaitingReadback, conflict, failed
    }

    let id: String
    let scope: EduPiCloudScope
    let taskID: String
    let taskTitle: String
    let mutation: Mutation
    let command: Data
    let messageID: String
    let issuedAt: String
    // The complete HTTP body is saved before the first command send, then immutable.
    var envelope: Data?
    var state: State = .queued
    var lastError: String?

    var isBlocked: Bool { state == .conflict || state == .failed }

    var statusLabel: String {
        switch state {
        case .queued: "待同步"
        case .awaitingReadback: "等待回读"
        case .conflict: "同步冲突"
        case .failed: "同步失败"
        }
    }

    var actionLabel: String {
        switch mutation {
        case .create: "新建任务"
        case let .move(stage, _): "改为\(stage.title)"
        case .chatCreate: "新建对话"
        case .chatPrompt: "发送消息"
        }
    }

    func matches(_ task: EduPiRemoteTask) -> Bool {
        guard task.id == taskID else { return false }
        switch mutation {
        case let .create(title, note):
            return task.title == title && task.note == note && task.dueDate == nil
                && task.stage == "todo" && task.status == "planned" && task.revision == 0
        case let .move(stage, revision):
            return task.stage == stage.rawValue && task.revision == revision + 1
        case .chatCreate, .chatPrompt: return false
        }
    }
}

struct EduPiCloudWriteResult {
    // pending means durable local acceptance; only task proves cloud readback.
    let requestID: String
    let task: EduPiRemoteTask?
    let pending: EduPiCloudOutboxEntry?
}

@MainActor
final class EduPiCloudOutbox {
    private struct Partition: Codable {
        let version: Int
        let scope: EduPiCloudScope
        var entries: [EduPiCloudOutboxEntry]
    }

    let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EduPi/CloudOutbox/v1", isDirectory: true)
    }

    func entries(in scope: EduPiCloudScope) throws -> [EduPiCloudOutboxEntry] {
        let url = partitionURL(scope)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do {
            let partition = try JSONDecoder().decode(Partition.self, from: Data(contentsOf: url))
            guard partition.version == 1, partition.scope == scope,
                  partition.entries.allSatisfy({ $0.scope == scope && !$0.command.isEmpty }),
                  Set(partition.entries.map(\.id)).count == partition.entries.count else {
                throw EduPiCloudOutboxError.storageUnavailable
            }
            return partition.entries
        } catch {
            // A damaged or foreign partition is never replaced with an empty queue.
            throw EduPiCloudOutboxError.storageUnavailable
        }
    }

    @discardableResult
    func enqueue(_ entry: EduPiCloudOutboxEntry) throws -> EduPiCloudOutboxEntry {
        var entries = try entries(in: entry.scope)
        if let existing = entries.first(where: { $0.id == entry.id }) {
            guard existing.command == entry.command, existing.mutation == entry.mutation,
                  existing.taskID == entry.taskID else { throw EduPiCloudOutboxError.requestConflict }
            return existing
        }
        if entry.chatSessionID == nil && entries.contains(where: { $0.chatSessionID == nil && $0.taskID == entry.taskID }) {
            throw EduPiCloudOutboxError.taskPending
        }
        entries.append(entry)
        try write(entries, in: entry.scope)
        return entry
    }

    func update(_ entry: EduPiCloudOutboxEntry) throws {
        var entries = try entries(in: entry.scope)
        guard let index = entries.firstIndex(where: { $0.id == entry.id }) else {
            throw EduPiCloudOutboxError.storageUnavailable
        }
        let original = entries[index]
        guard original.command == entry.command, original.mutation == entry.mutation,
              original.taskID == entry.taskID, original.messageID == entry.messageID,
              original.issuedAt == entry.issuedAt,
              original.envelope == nil || original.envelope == entry.envelope else {
            throw EduPiCloudOutboxError.requestConflict
        }
        entries[index] = entry
        try write(entries, in: entry.scope)
    }

    func complete(_ entry: EduPiCloudOutboxEntry, verifiedTask: EduPiRemoteTask) throws {
        guard entry.matches(verifiedTask), entry.state == .awaitingReadback else {
            throw EduPiCloudOutboxError.readbackMismatch
        }
        try removeVerified(entry)
    }

    func completeChat(_ entry: EduPiCloudOutboxEntry, conversation: EduPiCloudConversation) throws {
        guard entry.matches(conversation), entry.state == .awaitingReadback else {
            throw EduPiCloudOutboxError.chatReadbackMismatch
        }
        try removeVerified(entry)
    }

    private func removeVerified(_ entry: EduPiCloudOutboxEntry) throws {
        let entries = try entries(in: entry.scope)
        guard let saved = entries.first(where: { $0.id == entry.id }),
              saved.envelope == entry.envelope, saved.command == entry.command,
              saved.state == .awaitingReadback else { throw EduPiCloudOutboxError.requestConflict }
        try write(entries.filter { $0.id != entry.id }, in: entry.scope)
    }

    private func partitionURL(_ scope: EduPiCloudScope) -> URL {
        directory.appendingPathComponent("\(scope.storageKey).json")
    }

    private func write(_ entries: [EduPiCloudOutboxEntry], in scope: EduPiCloudScope) throws {
        do {
            let manager = FileManager.default
            try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var privateDirectory = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try privateDirectory.setResourceValues(values)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(Partition(version: 1, scope: scope, entries: entries))
            let url = partitionURL(scope)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch {
            throw EduPiCloudOutboxError.storageUnavailable
        }
    }
}
