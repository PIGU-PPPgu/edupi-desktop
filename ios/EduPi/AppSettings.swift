import Combine
import Foundation

@MainActor
final class AppSettings: ObservableObject {
    private static let serverAddressKey = "edupi.serverAddress"
    private static let usernameKey = "edupi.username"
    private let defaults: UserDefaults

    static let defaultServerAddress = "https://edupi.intelliclass.online"

    @Published var serverAddress: String {
        didSet {
            defaults.set(serverAddress, forKey: Self.serverAddressKey)
        }
    }

    @Published var username: String {
        didSet {
            defaults.set(username, forKey: Self.usernameKey)
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        serverAddress = Self.launchArgument(named: "-edupi-server")
            ?? defaults.string(forKey: Self.serverAddressKey)
            ?? Self.defaultServerAddress
        username = defaults.string(forKey: Self.usernameKey) ?? "pigou"
    }

    func clearServerAddress() {
        serverAddress = ""
    }

    private static func launchArgument(named name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name),
              arguments.indices.contains(index + 1) else {
            return nil
        }
        let value = arguments[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
