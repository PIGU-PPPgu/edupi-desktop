import SwiftUI

enum EduPiSheet: Identifiable {
    case settings
    case guide
    case search
    case more
    case module(EduPiModule)
    case task(String)
    case schedule(EduPiScheduleItem)

    var id: String {
        switch self {
        case .settings: "settings"
        case .guide: "guide"
        case .search: "search"
        case .more: "more"
        case .module(let module): "module-\(module.rawValue)"
        case .task(let id): "task-\(id)"
        case .schedule(let item): "schedule-\(item.id)"
        }
    }
}

struct EduPiRootView: View {
    @ObservedObject var state: EduPiAppState

    var body: some View {
        Group {
            switch state.phase {
            case .restoring:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(EduPiColor.canvas.ignoresSafeArea())
                    .accessibilityLabel("正在同步")
            case .login:
                EduPiLoginView(state: state)
            case .workspaceSelection:
                EduPiWorkspaceSelectionView(state: state)
            case .ready:
                EduPiWorkbenchView(state: state)
                    .id(state.scopeID)
            }
        }
        .tint(EduPiColor.accent)
    }
}

private struct EduPiWorkspaceSelectionView: View {
    @ObservedObject var state: EduPiAppState

    var body: some View {
        EduPiPage {
            EduPiHeader(title: "选择工作区")
            if let error = state.syncError {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if state.workspaces.isEmpty {
                if state.isSyncing {
                    ProgressView("正在读取工作区")
                } else if state.syncError == nil {
                    EduPiStatus(title: "此账号暂无云端工作区")
                }
            } else {
                EduPiSurface {
                    ForEach(state.workspaces) { workspace in
                        Button {
                            Task { await state.chooseWorkspace(workspace.id) }
                        } label: {
                            EduPiRow(title: workspace.id, icon: workspace.id == state.selectedWorkspaceID ? "checkmark.circle" : "cloud")
                        }
                        .disabled(state.isSyncing || state.isWriting)
                        .accessibilityIdentifier("choose-workspace-\(workspace.id)")
                    }
                }
            }
            Button("刷新工作区") { Task { await state.refresh() } }
                .disabled(state.isSyncing)
            if state.selectedWorkspaceID != nil {
                Button("返回") { state.cancelWorkspaceSelection() }
            }
            Button("退出登录", role: .destructive) { state.signOut() }
        }
        .accessibilityIdentifier("workspace-selection")
    }
}

private struct EduPiLoginView: View {
    @ObservedObject var state: EduPiAppState
    @State private var username: String
    @State private var serverAddress: String
    @State private var password = ""
    @FocusState private var focused: Field?

    private enum Field {
        case username, password
    }

    init(state: EduPiAppState) {
        self.state = state
        _username = State(initialValue: state.settings.username)
        _serverAddress = State(initialValue: state.settings.serverAddress)
    }

    private var canSubmit: Bool {
        !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !password.isEmpty && !state.isSigningIn
    }

    var body: some View {
        EduPiPage {
            VStack(alignment: .leading, spacing: 24) {
                EduPiWordmark()
                    .accessibilityAddTraits(.isHeader)

                EduPiSurface {
                    TextField("用户名", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused, equals: .username)
                        .submitLabel(.next)
                        .onSubmit { focused = .password }
                        .padding(16)
                    Divider().padding(.horizontal, 16)
                    SecureField("密码", text: $password)
                        .textContentType(.password)
                        .focused($focused, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .padding(16)
                }
                .foregroundStyle(EduPiColor.ink)

                if let error = state.loginError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("login-error")
                }

                Button(action: submit) {
                    EduPiPrimaryLabel(stretches: true) {
                        if state.isSigningIn {
                            ProgressView().tint(EduPiColor.onAction)
                                .accessibilityLabel("正在登录")
                        } else {
                            Text("登录")
                        }
                    }
                }
                .buttonStyle(EduPiPressStyle())
                .disabled(!canSubmit)
                .accessibilityIdentifier("sign-in")

                DisclosureGroup("服务地址") {
                    TextField("HTTPS 地址", text: $serverAddress)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.top, 10)
                }
                .font(.subheadline)

                Button("本地预览") { state.continueWithPreview() }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .disabled(state.isSigningIn)
            }
            .frame(maxWidth: 400)
            .frame(maxWidth: .infinity)
            .padding(.top, 44)
        }
    }

    private func submit() {
        guard canSubmit else { return }
        focused = nil
        Task {
            await state.signIn(username: username, password: password, serverAddress: serverAddress)
        }
    }
}

private struct EduPiWorkbenchView: View {
    @ObservedObject var state: EduPiAppState
    @State private var sheet: EduPiSheet?

    var body: some View {
        tabs
            .safeAreaInset(edge: .top, spacing: 0) {
                if let message = state.syncError ?? state.mutationError ?? pendingLabel {
                    HStack(spacing: 12) {
                        Label(message, systemImage: state.syncError != nil || state.mutationError != nil ? "exclamationmark.circle" : "arrow.triangle.2.circlepath")
                            .font(.footnote)
                            .foregroundStyle(EduPiColor.ink)
                        Spacer(minLength: 2)
                        Button("重试") { Task { await state.refresh() } }
                            .font(.footnote.weight(.semibold))
                            .frame(minHeight: 44)
                            .disabled(state.isSyncing || state.isWriting)
                    }
                    .padding(.horizontal, 20)
                    .background(EduPiColor.soft)
                    .accessibilityIdentifier("cloud-sync-status")
                }
            }
            .sheet(item: $sheet) { destination in
                EduPiSheetView(destination: destination, state: state)
            }
    }

    private var pendingLabel: String? {
        state.pendingWrites.isEmpty ? nil : "\(state.pendingWrites.count) 项待同步"
    }

    private var tabs: some View {
        TabView(selection: $state.selectedTab) {
            EduPiHomeView(state: state, open: present)
                .tabItem { tabLabel(.home) }
                .tag(EduPiTab.home)
            EduPiChatView(state: state)
                .tabItem { tabLabel(.chat) }
                .tag(EduPiTab.chat)
            EduPiWorkspaceView(state: state, open: present)
                .tabItem { tabLabel(.workspace) }
                .tag(EduPiTab.workspace)
            EduPiClassroomView(state: state)
                .tabItem { tabLabel(.classroom) }
                .tag(EduPiTab.classroom)
            EduPiScheduleView(state: state, open: present)
                .tabItem { tabLabel(.schedule) }
                .tag(EduPiTab.schedule)
        }
    }

    private func tabLabel(_ tab: EduPiTab) -> some View {
        Label(tab.title, systemImage: tab.icon)
    }

    private func present(_ destination: EduPiSheet) {
        sheet = destination
    }
}
