import SwiftUI

struct EduPiHomeView: View {
    @ObservedObject var state: EduPiAppState
    let open: (EduPiSheet) -> Void
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        EduPiPage {
            EduPiHeader(title: "首页") {
                Button {
                    open(.search)
                } label: {
                    EduPiIconButtonLabel(icon: "magnifyingglass")
                }
                .buttonStyle(EduPiPressStyle())
                .accessibilityLabel("搜索任务与日程")

                Menu {
                    Button("设置", systemImage: "gearshape") { open(.settings) }
                    Button("更多模块", systemImage: "square.grid.2x2") { open(.more) }
                    Button("使用引导", systemImage: "questionmark.circle") { open(.guide) }
                } label: {
                    if state.isPreview {
                        Text("预览")
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(EduPiColor.soft, in: RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius))
                    } else {
                        EduPiIconButtonLabel(icon: "person.crop.circle")
                    }
                }
                .accessibilityLabel(state.isPreview ? "本地预览菜单" : "账户菜单")
            }

            EduPiCollaborationCard {
                state.selectedTab = .chat
            }

            VStack(alignment: .leading, spacing: 10) {
                EduPiSectionHeading(title: "常用服务")
                if textSize.isAccessibilitySize {
                    VStack(spacing: 8) { services }
                } else {
                    HStack(alignment: .top, spacing: 8) { services }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                EduPiSectionHeading(title: "近期任务") {
                    Button("全部任务") { state.selectedTab = .workspace }
                        .font(.footnote.weight(.semibold))
                }
                if state.dashboard.pending.isEmpty {
                    EduPiStatus(title: state.syncError == nil ? "暂无待办" : "任务暂不可用")
                } else {
                    EduPiTaskList(tasks: Array(state.dashboard.pending.prefix(3))) { open(.task($0)) }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                EduPiSectionHeading(title: "接下来") {
                    Button("查看日程") { state.selectedTab = .schedule }
                        .font(.footnote.weight(.semibold))
                }
                if let next = state.dashboard.upcoming.first {
                    EduPiScheduleList(items: [next]) { open(.schedule($0)) }
                } else {
                    EduPiStatus(title: state.syncError == nil ? "近期没有校历安排" : "日程暂不可用", icon: "calendar")
                }
            }
        }
        .refreshable { await state.refresh() }
        .accessibilityIdentifier("home-screen")
    }

    @ViewBuilder private var services: some View {
        EduPiShortcut(title: "课前准备", icon: "book.closed") { open(.module(.teaching)) }
        EduPiShortcut(title: "学生档案", icon: "person.text.rectangle") { state.selectedTab = .classroom }
        EduPiShortcut(title: "材料整理", icon: "tray") { open(.module(.materials)) }
    }
}

private struct EduPiCollaborationCard: View {
    let action: () -> Void

    var body: some View {
        EduPiSurface {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    title.fixedSize()
                    Spacer(minLength: 8)
                    openButton.fixedSize(horizontal: true, vertical: false)
                }
                VStack(alignment: .leading, spacing: 12) {
                    title
                    openButton
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var title: some View {
        HStack(spacing: 10) {
            EduPiGlyph(icon: "bubble.left", emphasized: true)
            Text("AI 协作")
                .font(.headline)
                .foregroundStyle(EduPiColor.ink)
        }
    }

    private var openButton: some View {
        Button(action: action) {
            EduPiPrimaryLabel {
                HStack(spacing: 8) {
                    Text("打开对话")
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(EduPiPressStyle())
        .accessibilityLabel("打开 AI 协作")
    }
}

private struct EduPiShortcut: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(EduPiColor.accent)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(EduPiColor.ink)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 72)
            .padding(.horizontal, 4)
            .padding(.vertical, 5)
            .background(EduPiColor.soft, in: RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius))
        }
        .buttonStyle(EduPiPressStyle())
    }
}

struct EduPiChatView: View {
    @ObservedObject var state: EduPiAppState
    @State private var draft = ""

    var body: some View {
        ScrollViewReader { proxy in
            EduPiPage {
                EduPiHeader(title: "AI 协作") {
                    if state.isPreview && !state.previewMessages.isEmpty {
                        Button("新建") {
                            state.beginPreviewConversation()
                            draft = ""
                        }
                        .frame(minHeight: 44)
                    }
                }
                if state.isPreview {
                    if state.previewMessages.isEmpty {
                        EduPiStatus(title: "本地对话预览", icon: "bubble.left")
                    }
                    LazyVStack(alignment: .trailing, spacing: 12) {
                        ForEach(state.previewMessages) { message in
                            Text(message.text)
                                .textSelection(.enabled)
                                .padding(12)
                                .foregroundStyle(EduPiColor.ink)
                                .background(EduPiColor.soft, in: RoundedRectangle(cornerRadius: 16))
                                .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                        Color.clear.frame(height: 1).id("chat-end")
                    }
                } else {
                    EduPiStatus(title: "对话服务暂未开通", icon: "bubble.left")
                }
            }
            .onChange(of: state.previewMessages.count) {
                proxy.scrollTo("chat-end", anchor: .bottom)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if state.isPreview {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("试写消息", text: $draft, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(EduPiColor.surface, in: RoundedRectangle(cornerRadius: 16))
                    Button {
                        state.sendPreviewMessage(draft)
                        draft = ""
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 34))
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("发送预览消息")
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .frame(maxWidth: 660)
                .frame(maxWidth: .infinity)
                .background(EduPiColor.canvas)
            }
        }
        .accessibilityIdentifier("chat-screen")
    }
}

struct EduPiWorkspaceView: View {
    @ObservedObject var state: EduPiAppState
    let open: (EduPiSheet) -> Void
    @State private var filter: EduPiTaskStage?
    @State private var adding = false
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        EduPiPage {
            EduPiHeader(title: "工作区") {
                if state.isPreview {
                    Button {
                        adding = true
                    } label: {
                        EduPiIconButtonLabel(icon: "plus")
                    }
                    .accessibilityLabel("新建任务")
                }
            }
            if textSize.isAccessibilitySize {
                statusPicker
            } else {
                statusPicker.pickerStyle(.segmented)
            }

            let tasks = state.dashboard.tasks.filter { filter == nil || $0.stage == filter }
            if tasks.isEmpty {
                EduPiStatus(title: state.syncError == nil ? "暂无任务" : "任务暂不可用")
            } else {
                EduPiTaskList(tasks: tasks) { open(.task($0)) }
            }
        }
        .refreshable { await state.refresh() }
        .sheet(isPresented: $adding) {
            EduPiCreateTaskView(state: state)
        }
        .accessibilityIdentifier("workspace-screen")
    }

    private var statusPicker: some View {
        Picker("任务状态", selection: $filter) {
            Text("全部").tag(EduPiTaskStage?.none)
            ForEach(EduPiTaskStage.allCases, id: \.self) { stage in
                Text(stage.title).tag(Optional(stage))
            }
        }
    }
}

struct EduPiTaskList: View {
    let tasks: [EduPiTaskItem]
    let open: (String) -> Void

    var body: some View {
        EduPiSurface {
            ForEach(tasks) { task in
                Button {
                    open(task.id)
                } label: {
                    EduPiTaskRow(task: task)
                }
                .buttonStyle(EduPiPressStyle())
                .accessibilityIdentifier(task.id)
                if task.id != tasks.last?.id {
                    Divider().padding(.leading, 64).padding(.trailing, 14)
                }
            }
        }
    }
}

struct EduPiTaskRow: View {
    let task: EduPiTaskItem

    var body: some View {
        EduPiRow(title: task.title, detail: task.metadata, icon: icon, emphasized: task.stage == .review, navigates: true)
    }

    private var icon: String {
        switch task.stage {
        case .todo: "circle.dashed"
        case .progress: "clock"
        case .review: "checklist"
        case .done: "checkmark"
        }
    }

}

struct EduPiClassroomView: View {
    @ObservedObject var state: EduPiAppState
    @State private var search = ""
    @State private var classSelection: String?

    private var classes: [String] {
        Set(state.dashboard.students.map(\.className)).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            EduPiPage {
                EduPiHeader(title: "班级") {
                    if classes.count > 1 {
                        Menu {
                            Picker("选择班级", selection: $classSelection) {
                                Text("全部班级").tag(String?.none)
                                ForEach(classes, id: \.self) { name in
                                    Text(name).tag(Optional(name))
                                }
                            }
                        } label: {
                            Label(classSelection ?? "全部班级", systemImage: "line.3.horizontal.decrease")
                                .font(.footnote.weight(.semibold))
                                .padding(.horizontal, 11)
                                .frame(minHeight: 44)
                                .background(EduPiColor.soft, in: RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius))
                        }
                    }
                }
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").accessibilityHidden(true)
                    TextField("搜索学生", text: $search)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("student-search")
                }
                .foregroundStyle(EduPiColor.muted)
                .padding(.horizontal, 14)
                .frame(minHeight: 46)
                .background(EduPiColor.surface, in: RoundedRectangle(cornerRadius: 14))

                let visibleClasses = classes.filter { name in
                    classSelection == nil || classSelection == name || !classes.contains(classSelection ?? "")
                }
                let groups = visibleClasses.compactMap { name -> StudentGroup? in
                    let students = students(in: name)
                    return students.isEmpty ? nil : StudentGroup(id: name, students: students)
                }
                if groups.isEmpty {
                    EduPiStatus(title: !search.isEmpty ? "找不到学生" : "暂无学生档案", icon: "person.crop.rectangle")
                }
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(groups) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            EduPiSectionHeading(title: group.id) {
                                Text("\(group.students.count) 人")
                                    .font(.footnote)
                                    .foregroundStyle(EduPiColor.muted)
                            }
                            EduPiSurface {
                                LazyVStack(spacing: 0) {
                                    ForEach(group.students) { student in
                                        NavigationLink {
                                            EduPiStudentDetailView(state: state, student: student)
                                        } label: {
                                            EduPiRow(title: student.name, icon: "person", navigates: true)
                                        }
                                        .buttonStyle(EduPiPressStyle())
                                        .accessibilityIdentifier(student.id)
                                        if student.id != group.students.last?.id {
                                            Divider().padding(.leading, 64).padding(.trailing, 14)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .refreshable { await state.refresh() }
            .toolbar(.hidden, for: .navigationBar)
            .accessibilityIdentifier("classroom-screen")
        }
    }

    private func students(in className: String) -> [EduPiStudentItem] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return state.dashboard.students.filter {
            $0.className == className && (query.isEmpty || $0.name.localizedStandardContains(query))
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private struct StudentGroup: Identifiable {
        let id: String
        let students: [EduPiStudentItem]
    }
}

struct EduPiScheduleView: View {
    @ObservedObject var state: EduPiAppState
    let open: (EduPiSheet) -> Void
    @State private var filter = Filter.upcoming

    private enum Filter: String, Hashable, CaseIterable {
        case upcoming = "近期"
        case calendar = "校历"
        case timetable = "课表"
    }

    private var items: [EduPiScheduleItem] {
        switch filter {
        case .upcoming: state.dashboard.upcoming
        case .calendar:
            state.dashboard.schedule.filter { $0.kind == .calendar }.sorted {
                ($0.date ?? "9999", $0.title) < ($1.date ?? "9999", $1.title)
            }
        case .timetable: state.dashboard.schedule.filter { $0.kind == .timetable }
        }
    }

    var body: some View {
        EduPiPage {
            EduPiHeader(title: "日程")
            Picker("日程类型", selection: $filter) {
                ForEach(Filter.allCases, id: \.self) { filter in
                    Text(filter.rawValue).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            if items.isEmpty {
                EduPiStatus(title: state.syncError == nil ? "暂无日程" : "日程暂不可用", icon: "calendar")
            } else if filter == .timetable {
                let byDay = Dictionary(grouping: items) { $0.dayOfWeek ?? 8 }
                ForEach(byDay.keys.sorted(), id: \.self) { day in
                    VStack(alignment: .leading, spacing: 10) {
                        EduPiSectionHeading(title: EduPiDate.weekday(day) ?? "未排日期")
                        EduPiScheduleList(items: (byDay[day] ?? []).sorted { ($0.period ?? 99) < ($1.period ?? 99) }) {
                            open(.schedule($0))
                        }
                    }
                }
            } else {
                EduPiScheduleList(items: items) { open(.schedule($0)) }
            }
        }
        .refreshable { await state.refresh() }
        .accessibilityIdentifier("schedule-screen")
    }
}

struct EduPiScheduleList: View {
    let items: [EduPiScheduleItem]
    let open: (EduPiScheduleItem) -> Void

    var body: some View {
        EduPiSurface {
            LazyVStack(spacing: 0) {
                ForEach(items) { item in
                    Button {
                        open(item)
                    } label: {
                        EduPiScheduleRow(item: item)
                    }
                    .buttonStyle(EduPiPressStyle())
                    .accessibilityIdentifier(item.id)
                    if item.id != items.last?.id {
                        Divider().padding(.leading, 64).padding(.trailing, 14)
                    }
                }
            }
        }
    }
}

struct EduPiScheduleRow: View {
    let item: EduPiScheduleItem

    var body: some View {
        EduPiRow(
            title: item.title,
            detail: [item.dateLabel, item.context ?? ""].filter { !$0.isEmpty }.joined(separator: " · "),
            icon: item.kind == .timetable ? "book.closed" : "calendar",
            navigates: true
        )
    }
}

enum EduPiModule: String, Identifiable {
    case teaching, materials, memory, insights, review

    var id: String { rawValue }

    var title: String {
        switch self {
        case .teaching: "课前准备"
        case .materials: "材料"
        case .memory: "教育记忆"
        case .insights: "观察与洞察"
        case .review: "待我确认"
        }
    }

    var icon: String {
        switch self {
        case .teaching: "book.closed"
        case .materials: "tray"
        case .memory: "archivebox"
        case .insights: "waveform.path"
        case .review: "checklist"
        }
    }
}

struct EduPiSheetView: View {
    let destination: EduPiSheet
    @ObservedObject var state: EduPiAppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch destination {
                case .settings:
                    EduPiSettingsContent(state: state)
                case .guide:
                    EduPiGuideContent { tab in
                        state.selectedTab = tab
                        dismiss()
                    }
                    .navigationTitle("使用引导")
                case .search:
                    EduPiSearchContent(state: state)
                        .navigationTitle("搜索")
                case .more:
                    EduPiMoreContent(state: state)
                        .navigationTitle("更多")
                case .module(let module):
                    EduPiModuleContent(module: module, state: state)
                case .task(let id):
                    EduPiTaskDetailView(state: state, id: id)
                case .schedule(let item):
                    EduPiScheduleDetail(item: item)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
    }
}

struct EduPiTaskDetailView: View {
    @ObservedObject var state: EduPiAppState
    let id: String

    var body: some View {
        EduPiPage {
            if let task = state.dashboard.tasks.first(where: { $0.id == id }) {
                Text(task.title)
                    .font(.title.bold())
                    .foregroundStyle(EduPiColor.ink)
                    .accessibilityAddTraits(.isHeader)
                EduPiSurface {
                    EduPiRow(title: task.stage.title, icon: "checklist", emphasized: task.stage == .review)
                    if let dueDate = task.dueDate {
                        Divider().padding(.horizontal, 14)
                        EduPiRow(title: dueDate, detail: "截止日期", icon: "calendar")
                    }
                }
                if let note = task.note, !note.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        EduPiSectionHeading(title: "备注")
                        Text(note)
                            .foregroundStyle(EduPiColor.ink)
                            .textSelection(.enabled)
                    }
                }
                Menu("更改状态", systemImage: "arrow.left.arrow.right") {
                    ForEach(EduPiTaskStage.allCases.filter { $0 != task.stage }, id: \.self) { stage in
                        Button(stage.title) {
                            Task { _ = await state.moveTask(id, to: stage) }
                        }
                    }
                }
                .font(.body.weight(.semibold))
                .frame(minHeight: 44)
            } else {
                EduPiStatus(title: "任务已不可用")
            }
        }
        .navigationTitle("任务详情")
        .accessibilityIdentifier("task-detail")
    }
}

struct EduPiCreateTaskView: View {
    @ObservedObject var state: EduPiAppState
    @State private var title = ""
    @State private var note = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                TextField("任务名称", text: $title)
                TextField("备注", text: $note, axis: .vertical)
                    .lineLimit(2...6)
            }
            .scrollContentBackground(.hidden)
            .background(EduPiColor.canvas)
            .navigationTitle("新建任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            if await state.createTask(title: title, note: note) { dismiss() }
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 240)
                }
            }
        }
    }
}

struct EduPiStudentDetailView: View {
    @ObservedObject var state: EduPiAppState
    let student: EduPiStudentItem

    var body: some View {
        EduPiPage {
            HStack(spacing: 14) {
                EduPiGlyph(icon: "person")
                VStack(alignment: .leading, spacing: 4) {
                    Text(student.name)
                        .font(.title.bold())
                        .foregroundStyle(EduPiColor.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(student.className)
                        .font(.subheadline)
                        .foregroundStyle(EduPiColor.muted)
                }
            }
            if !student.traits.isEmpty || student.latestNote != nil {
                EduPiSurface {
                    if !student.traits.isEmpty {
                        EduPiRow(title: "特点", detail: student.traits.joined(separator: "、"), icon: "person.text.rectangle")
                    }
                    if let note = student.latestNote, !note.isEmpty {
                        if !student.traits.isEmpty { Divider().padding(.horizontal, 14) }
                        EduPiRow(title: "最近跟进", detail: note, icon: "note.text")
                    }
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                EduPiSectionHeading(title: "最近记录")
                EduPiStudentEvents(state: state, studentID: student.id)
            }
        }
        .navigationTitle("学生档案")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .accessibilityIdentifier("student-detail")
    }
}

struct EduPiScheduleDetail: View {
    let item: EduPiScheduleItem

    var body: some View {
        EduPiPage {
            Text(item.title)
                .font(.title.bold())
                .foregroundStyle(EduPiColor.ink)
                .accessibilityAddTraits(.isHeader)
            EduPiSurface {
                if let date = item.date {
                    EduPiRow(title: item.endDate.flatMap { $0 == date ? nil : "\(date) 至 \($0)" } ?? date, icon: "calendar")
                } else if !item.dateLabel.isEmpty {
                    EduPiRow(title: item.dateLabel, icon: "calendar")
                }
                if let context = item.context, !context.isEmpty {
                    Divider().padding(.horizontal, 14)
                    EduPiRow(title: context, icon: "person.2")
                }
            }
            if let detail = item.detail, !detail.isEmpty {
                Text(detail)
                    .foregroundStyle(EduPiColor.ink)
                    .textSelection(.enabled)
            }
        }
        .navigationTitle(item.kind == .timetable ? "课表安排" : "校历详情")
    }
}

private struct EduPiSearchContent: View {
    @ObservedObject var state: EduPiAppState
    @State private var query = ""

    var body: some View {
        EduPiPage {
            let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                let tasks = state.dashboard.tasks.filter { $0.title.localizedStandardContains(text) }
                let schedule = state.dashboard.schedule.filter { $0.title.localizedStandardContains(text) }
                if tasks.isEmpty && schedule.isEmpty {
                    EduPiStatus(title: "没有搜索结果", icon: "magnifyingglass")
                }
                if !tasks.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        EduPiSectionHeading(title: "任务")
                        EduPiSurface {
                            ForEach(tasks) { task in
                                NavigationLink {
                                    EduPiTaskDetailView(state: state, id: task.id)
                                } label: {
                                    EduPiTaskRow(task: task)
                                }
                                .buttonStyle(EduPiPressStyle())
                                if task.id != tasks.last?.id { Divider().padding(.horizontal, 14) }
                            }
                        }
                    }
                }
                if !schedule.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        EduPiSectionHeading(title: "日程")
                        EduPiSurface {
                            ForEach(schedule) { item in
                                NavigationLink {
                                    EduPiScheduleDetail(item: item)
                                } label: {
                                    EduPiScheduleRow(item: item)
                                }
                                .buttonStyle(EduPiPressStyle())
                                if item.id != schedule.last?.id { Divider().padding(.horizontal, 14) }
                            }
                        }
                    }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索任务与日程")
    }
}

private struct EduPiMoreContent: View {
    @ObservedObject var state: EduPiAppState

    var body: some View {
        EduPiPage {
            VStack(alignment: .leading, spacing: 10) {
                EduPiSectionHeading(title: "教师工作")
                moduleGroup([.teaching, .materials, .review])
            }
            VStack(alignment: .leading, spacing: 10) {
                EduPiSectionHeading(title: "长期积累")
                moduleGroup([.memory, .insights])
            }
        }
    }

    private func moduleGroup(_ modules: [EduPiModule]) -> some View {
        EduPiSurface {
            ForEach(modules) { module in
                NavigationLink {
                    EduPiModuleContent(module: module, state: state)
                } label: {
                    EduPiRow(title: module.title, icon: module.icon, navigates: true)
                }
                .buttonStyle(EduPiPressStyle())
                if module != modules.last { Divider().padding(.horizontal, 14) }
            }
        }
    }
}

private struct EduPiModuleContent: View {
    let module: EduPiModule
    @ObservedObject var state: EduPiAppState

    var body: some View {
        EduPiPage {
            switch module {
            case .teaching:
                EduPiSectionHeading(title: "课表")
                let lessons = state.dashboard.schedule.filter { $0.kind == .timetable }
                if lessons.isEmpty {
                    EduPiStatus(title: "暂无课程", icon: "calendar")
                } else {
                    EduPiSurface {
                        ForEach(lessons) { lesson in
                            NavigationLink {
                                EduPiScheduleDetail(item: lesson)
                            } label: {
                                EduPiScheduleRow(item: lesson)
                            }
                            .buttonStyle(EduPiPressStyle())
                            if lesson.id != lessons.last?.id { Divider().padding(.horizontal, 14) }
                        }
                    }
                }
            case .materials:
                EduPiResourceList(shelf: .materials, state: state)
            case .memory:
                EduPiResourceList(shelf: .memories, state: state)
            case .insights:
                EduPiSectionHeading(title: "最近观察")
                EduPiStudentEvents(state: state)
            case .review:
                let tasks = state.dashboard.pending.filter { $0.stage == .review }
                if tasks.isEmpty {
                    EduPiStatus(title: "暂无待确认任务", icon: module.icon)
                } else {
                    EduPiSurface {
                        ForEach(tasks) { task in
                            NavigationLink {
                                EduPiTaskDetailView(state: state, id: task.id)
                            } label: {
                                EduPiTaskRow(task: task)
                            }
                            .buttonStyle(EduPiPressStyle())
                            if task.id != tasks.last?.id { Divider().padding(.horizontal, 14) }
                        }
                    }
                }
            }
        }
        .navigationTitle(module.title)
    }
}

private struct EduPiResourceList: View {
    let shelf: EduPiResourceShelf
    @ObservedObject var state: EduPiAppState
    @State private var records: [EduPiRemoteResource]?
    @State private var failed = false

    var body: some View {
        Group {
            if failed {
                EduPiStatus(title: "暂时无法读取", icon: "exclamationmark.circle")
                Button("重试") { Task { await load() } }
                    .frame(minHeight: 44)
            } else if let records {
                if records.isEmpty {
                    EduPiStatus(title: shelf == .materials ? "暂无材料" : "暂无教育记忆")
                } else {
                    EduPiSurface {
                        ForEach(records) { record in
                            EduPiRow(
                                title: record.title,
                                detail: detail(record),
                                icon: shelf == .materials ? "doc" : "archivebox"
                            )
                            if record.id != records.last?.id { Divider().padding(.horizontal, 14) }
                        }
                    }
                }
            } else {
                ProgressView().padding(.vertical, 16)
            }
        }
        .task(id: shelf) { await load() }
    }

    private func detail(_ record: EduPiRemoteResource) -> String? {
        guard shelf == .memories else { return record.detail }
        switch record.detail {
        case "semester": return "学期"
        case "class": return "班级"
        case "teaching": return "教学"
        case "preferences": return "偏好"
        case "school": return "学校"
        default: return nil
        }
    }

    private func load() async {
        failed = false
        do {
            records = try await state.resources(shelf)
        } catch is CancellationError {
        } catch {
            failed = true
        }
    }
}

private struct EduPiStudentEvents: View {
    @ObservedObject var state: EduPiAppState
    var studentID: String? = nil
    @State private var records: [EduPiRemoteStudentEvent]?
    @State private var failed = false

    var body: some View {
        Group {
            if failed {
                EduPiStatus(title: "记录暂时无法读取", icon: "exclamationmark.circle")
                Button("重试") { Task { await load() } }
                    .frame(minHeight: 44)
            } else if let records {
                if records.isEmpty {
                    EduPiStatus(title: "暂无记录")
                } else {
                    EduPiSurface {
                        ForEach(records) { record in
                            EduPiRow(
                                title: record.summary,
                                detail: [record.topic, record.observedOn].compactMap { $0 }.joined(separator: " · "),
                                icon: "note.text"
                            )
                            if record.id != records.last?.id { Divider().padding(.horizontal, 14) }
                        }
                    }
                }
            } else {
                ProgressView().padding(.vertical, 16)
            }
        }
        .task(id: studentID) { await load() }
    }

    private func load() async {
        failed = false
        do {
            records = try await state.studentEvents(studentID: studentID)
        } catch is CancellationError {
        } catch {
            failed = true
        }
    }
}

private struct EduPiSettingsContent: View {
    @ObservedObject var state: EduPiAppState
    @State private var serverAddress: String
    @State private var addressError: String?
    @Environment(\.dismiss) private var dismiss

    init(state: EduPiAppState) {
        self.state = state
        _serverAddress = State(initialValue: state.settings.serverAddress)
    }

    var body: some View {
        Form {
            Section("账户") {
                LabeledContent("账号", value: state.accountName)
                if !state.isPreview {
                    if let lastSync = state.lastSync {
                        LabeledContent("上次同步", value: lastSync.formatted(date: .omitted, time: .shortened))
                    }
                    Button {
                        Task { await state.refresh() }
                    } label: {
                        if state.isSyncing { ProgressView() } else { Text("同步数据") }
                    }
                    .disabled(state.isSyncing)
                }
            }
            Section {
                DisclosureGroup("服务地址") {
                    TextField("HTTPS 地址", text: $serverAddress)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if let addressError {
                        Text(addressError).font(.footnote).foregroundStyle(.red)
                    }
                    Button("保存") {
                        do {
                            try state.updateServerAddress(serverAddress)
                            addressError = nil
                            dismiss()
                        } catch {
                            addressError = error.localizedDescription
                        }
                    }
                    .disabled(serverAddress.trimmingCharacters(in: .whitespacesAndNewlines) == state.settings.serverAddress)
                }
            }
            Section {
                Button(state.isPreview ? "退出预览" : "退出登录", role: .destructive) {
                    state.signOut()
                    dismiss()
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(EduPiColor.canvas)
        .navigationTitle("设置")
    }
}

private struct EduPiGuideContent: View {
    let goTo: (EduPiTab) -> Void

    var body: some View {
        EduPiPage {
            EduPiSurface {
                ForEach(EduPiTab.allCases.filter { $0 != .home }, id: \.self) { tab in
                    Button {
                        goTo(tab)
                    } label: {
                        EduPiRow(title: tab.title, detail: detail(tab), icon: tab.icon, navigates: true)
                    }
                    .buttonStyle(EduPiPressStyle())
                    if tab != .schedule { Divider().padding(.horizontal, 14) }
                }
            }
        }
    }

    private func detail(_ tab: EduPiTab) -> String? {
        switch tab {
        case .home: nil
        case .chat: "打开教师对话"
        case .workspace: "按状态查找任务"
        case .classroom: "按班级查看学生档案"
        case .schedule: "查看校历和每周课表"
        }
    }
}
