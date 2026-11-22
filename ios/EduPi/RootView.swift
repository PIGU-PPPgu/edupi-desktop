import SwiftUI

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var settings: AppSettings
    @StateObject private var state: EduPiAppState

    init() {
        let settings = AppSettings()
        _settings = StateObject(wrappedValue: settings)
        _state = StateObject(wrappedValue: EduPiAppState(settings: settings))
    }

    var body: some View {
        EduPiRootView(state: state)
            .task {
                await state.restore()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await state.becameActive() }
                }
            }
    }
}
