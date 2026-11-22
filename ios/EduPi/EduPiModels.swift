import Foundation

enum EduPiTab: String, CaseIterable, Hashable {
    case home, chat, workspace, classroom, schedule

    var title: String {
        switch self {
        case .home: "首页"
        case .chat: "AI 协作"
        case .workspace: "工作区"
        case .classroom: "班级"
        case .schedule: "日程"
        }
    }

    var icon: String {
        switch self {
        case .home: "house"
        case .chat: "bubble.left"
        case .workspace: "rectangle.split.3x1"
        case .classroom: "person.2"
        case .schedule: "calendar"
        }
    }
}

enum EduPiTaskStage: String, CaseIterable, Hashable {
    case todo, progress, review, done

    var title: String {
        switch self {
        case .todo: "待开始"
        case .progress: "进行中"
        case .review: "待确认"
        case .done: "已完成"
        }
    }
}

struct EduPiTaskItem: Identifiable, Hashable {
    let id: String
    let title: String
    let dueDate: String?
    let note: String?
    var stage: EduPiTaskStage
    var revision: Int

    var metadata: String {
        [stage.title, dueDate.map { "\(EduPiDate.shortLabel($0))截止" }].compactMap { $0 }.joined(separator: " · ")
    }
}

struct EduPiStudentItem: Identifiable, Hashable {
    let id: String
    let name: String
    let className: String
    let traits: [String]
    let latestNote: String?
}

enum EduPiScheduleKind: Hashable {
    case calendar, timetable
}

struct EduPiScheduleItem: Identifiable, Hashable {
    let id: String
    let title: String
    let kind: EduPiScheduleKind
    var date: String? = nil
    var endDate: String? = nil
    var dayOfWeek: Int? = nil
    var period: Int? = nil
    var detail: String? = nil
    var context: String? = nil

    var dateLabel: String {
        if kind == .timetable {
            return [dayOfWeek.flatMap(EduPiDate.weekday), period.map { "第\($0)节" }]
                .compactMap { $0 }.joined(separator: " · ")
        }
        guard let date else { return "日期待确认" }
        let start = EduPiDate.shortLabel(date)
        return endDate.flatMap { $0 == date ? nil : "\(start)–\(EduPiDate.shortLabel($0))" } ?? start
    }
}

struct EduPiChatMessage: Identifiable, Hashable {
    let id = UUID()
    let text: String
}

struct EduPiDashboard {
    var students: [EduPiStudentItem] = []
    var tasks: [EduPiTaskItem] = []
    var schedule: [EduPiScheduleItem] = []

    var upcoming: [EduPiScheduleItem] {
        let today = EduPiDate.iso()
        return schedule
            .filter { $0.kind == .calendar && $0.date != nil && ($0.endDate ?? $0.date ?? "") >= today }
            .sorted { ($0.date ?? "", $0.title) < ($1.date ?? "", $1.title) }
    }

    var pending: [EduPiTaskItem] {
        tasks.filter { $0.stage != .done }.sorted {
            ($0.dueDate ?? "9999", $0.title) < ($1.dueDate ?? "9999", $1.title)
        }
    }

    static var preview: EduPiDashboard {
        EduPiDashboard(
            students: [
                EduPiStudentItem(id: "preview-student-1", name: "宋禾", className: "701 班", traits: ["善于归纳", "主动提问"], latestNote: "下次课继续检查图像与解析式的对应。"),
                EduPiStudentItem(id: "preview-student-2", name: "周澄", className: "701 班", traits: ["计算仔细"], latestNote: nil),
                EduPiStudentItem(id: "preview-student-3", name: "许小满", className: "701 班", traits: ["表达清楚"], latestNote: nil),
                EduPiStudentItem(id: "preview-student-4", name: "程言", className: "702 班", traits: [], latestNote: nil),
            ],
            tasks: [
                EduPiTaskItem(id: "preview-task-1", title: "准备一次函数课堂练习", dueDate: EduPiDate.iso(daysFromNow: 1), note: "课堂练习加入两道从图像读斜率的题。", stage: .review, revision: 0),
                EduPiTaskItem(id: "preview-task-2", title: "整理本周作业讲评", dueDate: EduPiDate.iso(daysFromNow: 2), note: "按错因整理例题。", stage: .progress, revision: 0),
                EduPiTaskItem(id: "preview-task-3", title: "核对阶段测验安排", dueDate: EduPiDate.iso(daysFromNow: 5), note: nil, stage: .todo, revision: 0),
            ],
            schedule: [
                EduPiScheduleItem(id: "preview-calendar-1", title: "数学教研组备课", kind: .calendar, date: EduPiDate.iso(daysFromNow: 1), detail: "携带一次函数单元练习。"),
                EduPiScheduleItem(id: "preview-calendar-2", title: "阶段性测验", kind: .calendar, date: EduPiDate.iso(daysFromNow: 5)),
                EduPiScheduleItem(id: "preview-slot-1", title: "数学", kind: .timetable, dayOfWeek: 1, period: 2, context: "701 班"),
                EduPiScheduleItem(id: "preview-slot-2", title: "数学", kind: .timetable, dayOfWeek: 2, period: 3, context: "702 班"),
            ]
        )
    }
}

enum EduPiDate {
    static func iso(daysFromNow: Int = 0) -> String {
        let calendar = Calendar(identifier: .gregorian)
        let date = calendar.date(byAdding: .day, value: daysFromNow, to: Date()) ?? Date()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = calendar.timeZone
        return formatter.string(from: date)
    }

    static func shortLabel(_ value: String) -> String {
        let parts = value.split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else { return value }
        return "\(month)月\(day)日"
    }

    static func weekday(_ day: Int) -> String? {
        guard (1...7).contains(day) else { return nil }
        return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1]
    }
}
