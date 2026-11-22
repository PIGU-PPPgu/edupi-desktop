import Foundation

struct EduPiCloudContractIdentity: Decodable {
    let contractID: String
    let contractVersion: String
    let schemaHash: String

    enum CodingKeys: String, CodingKey {
        case contractID = "contract_id"
        case contractVersion = "contract_version"
        case schemaHash = "schema_hash"
    }

    var isSupported: Bool {
        contractID == "edupi-cloud-sync-v1" && contractVersion == "1.0"
            && schemaHash == "sha256:2ef7b7849941bc6fd1cb1cff884b9d5ba4f08b8cb83dadaf8968529f3509c197"
    }
}

struct EduPiCloudSession: Decodable, Identifiable {
    struct Model: Decodable {
        let provider: String
        let modelID: String

        enum CodingKeys: String, CodingKey {
            case provider
            case modelID = "modelId"
        }
    }

    let id: String
    let workspaceID: String
    let title: String
    let createdBy: String
    let model: Model?
    let thinkingLevel: String?
    let revision: Int?

    enum CodingKeys: String, CodingKey {
        case id = "session_id"
        case workspaceID = "workspace_id"
        case title
        case createdBy = "created_by"
        case model, revision
        case thinkingLevel = "thinking_level"
    }
}

struct EduPiCloudChatMessage: Decodable, Identifiable {
    struct Payload: Decodable {
        let role: String
        let text: String
        let timestamp: Double?

        private struct Block: Decodable {
            let type: String
            let text: String?
        }

        enum CodingKeys: String, CodingKey { case role, content, timestamp }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            role = try values.decode(String.self, forKey: .role)
            timestamp = try values.decodeIfPresent(Double.self, forKey: .timestamp)
            if let text = try? values.decode(String.self, forKey: .content) {
                self.text = text
            } else {
                let blocks = try values.decode([Block].self, forKey: .content)
                text = blocks.filter { $0.type == "text" }.compactMap(\.text).joined(separator: "\n")
            }
        }
    }

    let id: String
    let requestID: String
    let role: String
    let message: Payload

    enum CodingKeys: String, CodingKey {
        case id = "message_id"
        case requestID = "request_id"
        case role, message
    }
}

struct EduPiCloudChatRequest: Decodable, Identifiable {
    struct Command: Decodable {
        let type: String
        let message: String
        let clientRequestId: String?
    }

    let id: String
    let sessionID: String
    let actorID: String
    let command: Command
    let status: String
    let errorCode: String?

    enum CodingKeys: String, CodingKey {
        case id = "request_id"
        case sessionID = "session_id"
        case actorID = "actor_id"
        case command, status
        case errorCode = "error_code"
    }

    var statusLabel: String {
        switch status {
        case "queued": "已排队，等待桌面执行者"
        case "claimed", "running": "桌面正在处理"
        case "completed": "已完成"
        case "uncertain": "执行结果待确认，请先在桌面核对"
        case "cancelled": "已取消"
        default: "执行失败"
        }
    }
}

struct EduPiCloudChatEvent: Decodable, Identifiable {
    struct Payload: Decodable {
        let type: String
        let clientRequestId: String?
        let errorMessage: String?
    }

    let id: Int64
    let requestID: String
    let event: Payload

    enum CodingKeys: String, CodingKey {
        case id = "event_id"
        case requestID = "request_id"
        case event
    }
}

struct EduPiCloudConversation {
    let session: EduPiCloudSession
    let messages: [EduPiCloudChatMessage]
    let requests: [EduPiCloudChatRequest]
}

struct EduPiCloudChatResponse: Decodable {
    let ok: Bool
    let operation: String
    let action: String
    let contract: EduPiCloudContractIdentity
    let workspaceID: String?
    let requestID: String?
    let sessionID: String?
    let revision: Int?
    let externalSend: Bool
    let sessions: [EduPiCloudSession]?
    let session: EduPiCloudSession?
    let messages: [EduPiCloudChatMessage]?
    let requests: [EduPiCloudChatRequest]?
    let events: [EduPiCloudChatEvent]?

    enum CodingKeys: String, CodingKey {
        case ok, operation, action, contract, sessions, session, messages, requests, events
        case workspaceID = "workspace_id"
        case requestID = "request_id"
        case sessionID = "session_id"
        case revision
        case externalSend = "external_send"
    }
}

struct EduPiCloudChatWriteResult {
    let requestID: String
    let sessionID: String
    let pending: EduPiCloudOutboxEntry?
}

extension EduPiCloudOutboxEntry {
    var chatSessionID: String? {
        switch mutation {
        case let .chatCreate(sessionID, _), let .chatPrompt(sessionID, _): sessionID
        default: nil
        }
    }

    func matches(_ conversation: EduPiCloudConversation) -> Bool {
        guard conversation.session.workspaceID == scope.workspaceID, conversation.session.id == chatSessionID else { return false }
        switch mutation {
        case let .chatCreate(_, title):
            return conversation.session.title == title && conversation.session.createdBy == scope.account.accountID
        case let .chatPrompt(_, message):
            let requests = conversation.requests.filter { $0.id == id }
            let messages = conversation.messages.filter { $0.requestID == id && $0.role == "user" }
            guard requests.count == 1, messages.count == 1, let request = requests.first, let saved = messages.first else { return false }
            return request.actorID == scope.account.accountID && request.sessionID == chatSessionID
                && request.command.type == "prompt" && request.command.message == message && request.command.clientRequestId == id
                && saved.id == "\(id):user" && saved.message.role == "user" && saved.message.text == message
        default: return false
        }
    }
}
