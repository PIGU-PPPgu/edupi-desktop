import Foundation

struct EduPiCloudStudent: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let className: String?
    let traits: [String]
    let parentNotes: [String]
    let revision: Int
    let profileRevision: Int
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id = "student_id"
        case name
        case className = "class_name"
        case traits
        case parentNotes = "parent_notes"
        case revision
        case profileRevision = "profile_revision"
        case updatedAt = "updated_at"
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        className = try values.decodeIfPresent(String.self, forKey: .className)
        traits = try values.decodeIfPresent([String].self, forKey: .traits) ?? []
        parentNotes = try values.decodeIfPresent([String].self, forKey: .parentNotes) ?? []
        revision = try values.decode(Int.self, forKey: .revision)
        profileRevision = try values.decode(Int.self, forKey: .profileRevision)
        updatedAt = try values.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

struct EduPiCloudStudentsResponse: Decodable {
    let ok: Bool
    let operation: String
    let action: String
    let requestID: String
    let workspaceID: String
    let externalSend: Bool
    let contract: EduPiCloudContractIdentity
    let students: [EduPiCloudStudent]

    enum CodingKeys: String, CodingKey {
        case ok, operation, action, contract, students
        case requestID = "request_id"
        case workspaceID = "workspace_id"
        case externalSend = "external_send"
    }
}
