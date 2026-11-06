import SwiftUI
import AppKit

@main
struct MedicalSchoolHubApp: App {
    var body: some Scene {
        WindowGroup {
            HubView()
                .frame(minWidth: 1320, idealWidth: 1420, minHeight: 860, idealHeight: 920)
                .background(.clear)
        }
        .windowStyle(.hiddenTitleBar)
    }
}

struct Stats {
    var inbox = 0
    var downloads = 0
    var needsReview = 0
    var ankiNeeded = 0
    var summaryNeeded = 0
    var weakArea = 0
    var todayMinutes = 0
    var todayCards = 0
    var manualMinutesToday = 0
    var journalEntries = 0
    var tasksOpen = 0
    var tasksDoneToday = 0
    var bpm500 = 0
    var bpm501 = 0
    var ppm500 = 0
    var ppm501 = 0
    var ppm502 = 0
}

struct StudyLog: Identifiable {
    let id = UUID()
    let date: Date
    let type: String
    let minutes: Int
    let cards: Int
    let note: String
}

struct JournalEntry: Identifiable {
    let id = UUID()
    let date: String
    let today: String
    let tomorrow: String
    let blockers: String
    let energy: String
    let rating: String
}


struct PromptItem: Identifiable {
    let id: String
    let title: String
    let category: String
    let tags: String
    let created: String
    let updated: String
    let path: String

    var fullPath: String {
        "\(NSHomeDirectory())/Medical School/\(path)"
    }

    var preview: String {
        let raw = (try? String(contentsOfFile: fullPath)) ?? "No preview available."
        let clean = raw.replacingOccurrences(of: "\n", with: " ")
        if clean.count > 180 {
            return String(clean.prefix(180)) + "…"
        }
        return clean
    }

    var bodyText: String {
        (try? String(contentsOfFile: fullPath)) ?? ""
    }
}



struct SmartSuggestion: Identifiable {
    let id = UUID()
    let title: String
    let reason: String
    let source: String
    let priority: Int
    let color: String
}

struct CourseTrackerItem: Identifiable {
    let id: String
    let week: String
    let type: String
    let label: String
    let status: String
    let quality: Int
    let color: String
    let notes: String
    let updated: String
}

struct TaskItem: Identifiable {
    let id: String
    let created: String
    let due: String
    let title: String
    let status: String
    let completed: String
}

func noctyriumDateKey(_ date: Date = Date()) -> String {
    var cal = Calendar.current
    cal.timeZone = TimeZone.current
    let shifted = cal.date(byAdding: .hour, value: -4, to: date) ?? date
    let f = DateFormatter()
    f.calendar = cal
    f.timeZone = TimeZone.current
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: shifted)
}

func noctyriumNextDateKey(after key: String) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    if let date = f.date(from: key),
       let next = Calendar.current.date(byAdding: .day, value: 1, to: date) {
        return f.string(from: next)
    }
    return noctyriumDateKey()
}

/// Opens the productivity file for a given study-day key (yyyy-MM-dd).
/// Per-day files live at Noctyrium/Productivity/Days/<key>.csv. Opens that exact
/// day file when it exists; otherwise falls back to the Days folder, then the
/// Productivity folder, so a heatmap click always reveals something useful.
func openProductivityDayFile(_ key: String) {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let prodDir = "\(home)/Medical School/09 Admin/App Data/Noctyrium/Productivity"
    let daysDir = "\(prodDir)/Days"
    let dayFile = "\(daysDir)/\(key).csv"
    let fm = FileManager.default
    let target: String
    if fm.fileExists(atPath: dayFile) {
        target = dayFile          // the specific study-day file
    } else if fm.fileExists(atPath: daysDir) {
        target = daysDir          // the Days folder, if that day isn't recorded yet
    } else {
        target = prodDir          // last resort: the Productivity folder
    }
    _ = shell("open \"\(target)\"")
}

struct HubView: View {
    @State private var selected = "Dashboard"
    @State private var selectedProductivityDayKey: String = noctyriumDateKey()
    @State private var productivityDayKey: String = noctyriumDateKey()
    @State private var dashboardTrackerModule = "T2 • NB3"
    @State private var selectedTrackerFile = "T2/nb3_tracker.csv"
    @State private var stats = Stats()
    @State private var logs: [StudyLog] = []
    @State private var journal: [JournalEntry] = []
    @State private var tasks: [TaskItem] = []
    @State private var trackerItems: [CourseTrackerItem] = []
    @State private var smartSuggestions: [SmartSuggestion] = []
    @State private var manualStudyDayOffset: Int = 0
    @State private var bsceItems: [CourseTrackerItem] = []
    @State private var status = "AXOM online."
    @State private var refreshing = false

    @State private var standupToday = ""
    @State private var standupTomorrow = ""
    @State private var standupBlockers = ""
    @State private var standupEnergy = "Medium"
    @State private var standupRating = "Useful"

    @State private var newTask = ""

    let home = FileManager.default.homeDirectoryForCurrentUser.path

    var base: String { "\(home)/Medical School" }
    var scripts: String { "\(base)/09 Admin/Scripts" }
    var appData: String { "\(base)/09 Admin/App Data" }
    var logFile: String { "\(appData)/productivity_log.csv" }
    var taskFile: String { "\(appData)/tasks.csv" }
    var journalFile: String { "\(appData)/journal.csv" }
    var manualStudyDayFile: String { "\(appData)/manual_study_day.txt" }
    var activeStudyDayFile: String { "\(appData)/Noctyrium/Productivity/active_study_day.txt" }
    var productivityArchiveFile: String { "\(appData)/Noctyrium/Productivity/productivity_day_archive.csv" }
    var nb3TrackerFile: String { selectedCourseTrackerPath }
    var bsceTrackerFile: String { "\(appData)/Course Trackers/T2/bsce_tracker.csv" }
    var selectedCourseTrackerPath: String { "\(appData)/Course Trackers/\(selectedTrackerFile)" }
    var ankiMedia: String { "\(home)/Library/Application Support/Anki2/User 1/collection.media" }

        var jdPlayerIconPath: String { "/Users/jd/Medical School/09 Admin/App Data/Noctyrium/Player Icons/JD Player Icon.jpg" }

var body: some View {
        ZStack {
            OuterBackground()

            GlassShell {
                HStack(spacing: 0) {
                    Sidebar(selected: $selected)

                    Rectangle()
                        .fill(Color.white.opacity(0.07))
                        .frame(width: 1)

                    VStack(spacing: 18) {
                        TopBar(
                            title: selected,
                            subtitle: subtitleForPage(),
                            refreshing: refreshing,
                            refreshAction: refresh
                        )

                        pageBody()
                    }
                    .padding(24)
                }
            }
            .padding(28)
        }
        .onAppear {
            ensureFiles()
            refresh()
        }
    }
func subtractAnki20() {
        let current = max(0, stats.todayCards)
        let delta = min(20, current)
        guard delta > 0 else {
            status = "Anki cards are already at 0."
            return
        }
        log(type: "Anki Correction", minutes: 0, cards: -delta, note: "Manual correction: subtract \(delta) Anki cards")
        stats.todayCards = max(0, stats.todayCards - delta)
        refresh()
        runSuggestionSweep()
    }
func subtractStudy30() {
        let current = max(0, stats.todayMinutes + stats.manualMinutesToday)
        let delta = min(30, current)
        guard delta > 0 else {
            status = "Study time is already at 0."
            return
        }
        log(type: "Study Correction", minutes: -delta, cards: 0, note: "Manual correction: subtract \(delta) study minutes")
        stats.todayMinutes = max(0, stats.todayMinutes - delta)
        stats.manualMinutesToday = max(0, stats.manualMinutesToday)
        refresh()
        runSuggestionSweep()
    }


    @ViewBuilder
    func pageBody() -> some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                switch selected {
                case "Dashboard":
                    DashboardPage(
                        stats: stats,
                        logs: logs,
                        suggestions: smartSuggestions,
                        refreshSuggestions: runSuggestionSweep,
                        trackerItems: trackerItems,
                        bsceItems: bsceItems,
                        selectedTrackerModule: $dashboardTrackerModule,
                        runHub: { run("\"\(scripts)/run_medical_hub.sh\"", "Run Hub") },
                        sort: { run("\"\(scripts)/auto_sort_medical.sh\"", "Auto Sort") },
                        review: { run("\"\(scripts)/weekly_med_review.sh\"", "Weekly Review") },
                        openInbox: { open("\(base)/00 📥 Inbox - Need Work Look Over") },
                        openAnkiMedia: { open(ankiMedia) },
                        logLecture: { log(type: "Lecture", minutes: 50, cards: 0, note: "Lecture completed") },
                        logAnki50: { log(type: "Anki", minutes: 15, cards: 50, note: "50 cards") },
                        logAnki100: { log(type: "Anki", minutes: 30, cards: 100, note: "100 cards") },
                        logStudy60: { log(type: "Study", minutes: 60, cards: 0, note: "1 hour focused study") },
                        standupToday: $standupToday,
                        standupTomorrow: $standupTomorrow,
                        standupBlockers: $standupBlockers,
                        standupEnergy: $standupEnergy,
                        standupRating: $standupRating,
                        saveStandup: saveStandup
                    )

                case "Courses":
                    CoursesPage(stats: stats, open: openPath)

                case "Course Tracker":
                    CourseTrackerPage(
                        items: trackerItems,
                        bsceItems: bsceItems,
                        selectedTrackerFile: $selectedTrackerFile,
                        base: base,
                        open: openPath,
                        refreshData: refresh,
                        updateItem: updateTrackerItem,
                        updateBSCEItem: updateBSCETrackerItem,
                        addPractice: addPracticeItem,
                        suggestions: smartSuggestions,
                        refreshSuggestions: runSuggestionSweep
                    )

                case "STEP 1":
                    StepPage(stats: stats, open: openPath, ankiMedia: ankiMedia)

                case "Reports":
                    ReportsPage(stats: stats, logs: logs, status: status, open: openPath, base: base)

                case "Productivity":
                    ProductivityPage(
                        stats: stats,
                        logs: logs,
                        logLecture: { log(type: "Lecture", minutes: 50, cards: 0, note: "Lecture completed") },
                        logAnki50: { log(type: "Anki", minutes: 15, cards: 50, note: "50 cards") },
                        logAnki100: { log(type: "Anki", minutes: 30, cards: 100, note: "100 cards") },
                        logAnki150: { log(type: "Anki", minutes: 45, cards: 150, note: "150 cards") },
                        logAnki200: { log(type: "Anki", minutes: 60, cards: 200, note: "200 cards") },
                        logStudy180: { log(type: "Study", minutes: 180, cards: 0, note: "3 hour study block") },
                        startNewStudyDay: startNewStudyDay,
                        subtractAnki20: subtractAnki20,
                        subtractStudy30: subtractStudy30,
                        startNewDay: startNewStudyDay
                    )

                case "Tasks":
                    TasksPage(tasks: tasks, newTask: $newTask, addTask: addTask, completeTask: completeTask)

                case "Journal":
                    JournalPage(entries: journal, openJournalFolder: { open("\(base)/09 Admin/Journal") })

                case "Integrations":
                    IntegrationsPage(base: base, open: openPath)

                case "Prompt Library":
                    PromptPage(base: base, open: openPath)

                default:
                    HubFoldersPage(base: base, open: openPath)
                }
            }
            .padding(.bottom, 24)
        }
    }

    func subtitleForPage() -> String {
        switch selected {
        case "Courses": return "Term-based course map with module-level folders"
        case "Course Tracker": return "Lecture, DLA, and PQ completion map"
        case "Journal": return "Daily standups, review, blockers, and tomorrow’s plan"
        case "Integrations": return "Framework for Anki, ScreenTime, Calendar, and manual time correction"
        case "Productivity": return "Study time, Anki cards, lecture blocks, day usefulness"
        case "Reports": return "Visual summaries of your medical school operating system"
        default: return "AXOM academic operating system for medical school"
        }
    }

    func ensureFiles() {
        try? FileManager.default.createDirectory(atPath: appData, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logFile) {
            try? "date,type,minutes,cards,note\n".write(toFile: logFile, atomically: true, encoding: .utf8)
        }
        if !FileManager.default.fileExists(atPath: taskFile) {
            try? "id,created,due,title,status,completed\n".write(toFile: taskFile, atomically: true, encoding: .utf8)
        }
        if !FileManager.default.fileExists(atPath: journalFile) {
            try? "date,today,tomorrow,blockers,energy,rating\n".write(toFile: journalFile, atomically: true, encoding: .utf8)
        }
    }
func startNewStudyDay() {
    ensureFiles()

    let fm = FileManager.default
    let prodDir = "\(appData)/Noctyrium/Productivity"
    try? fm.createDirectory(atPath: prodDir, withIntermediateDirectories: true)

    let archivePath = productivityArchiveFile
    let activePath = activeStudyDayFile
    let offsetPath = "\(prodDir)/productivity_day_offset.csv"

    let currentKey = currentManualStudyDay()
    let nextKey = noctyriumNextDateKey(after: currentKey)

    func csv(_ value: String) -> String {
        let escaped = value.replacingOccurrences(of: "\"", with: "\"\"")
        return "\"\(escaped)\""
    }

    func nowStamp() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f.string(from: Date())
    }

    let completed = tasks
        .filter { $0.status.lowercased() == "done" || !$0.completed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        .map { $0.title }
        .joined(separator: " • ")

    let openTasks = tasks
        .filter { $0.status.lowercased() != "done" && $0.completed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        .map { $0.title }
        .joined(separator: " • ")

    if !fm.fileExists(atPath: archivePath) {
        try? "date_key,study_minutes,anki_cards,completed_tasks,open_tasks,standup_today,standup_tomorrow,standup_blockers,energy,rating,updated\n"
            .write(toFile: archivePath, atomically: true, encoding: .utf8)
    }

    let archiveLine = [
        csv(currentKey),
        "\(max(0, stats.todayMinutes + stats.manualMinutesToday))",
        "\(max(0, stats.todayCards))",
        csv(completed),
        csv(openTasks),
        csv(standupToday),
        csv(standupTomorrow),
        csv(standupBlockers),
        csv(standupEnergy),
        csv(standupRating),
        csv(nowStamp())
    ].joined(separator: ",") + "\n"

    if let handle = FileHandle(forWritingAtPath: archivePath) {
        handle.seekToEndOfFile()
        if let data = archiveLine.data(using: .utf8) {
            handle.write(data)
        }
        try? handle.close()
    }

    try? (nextKey + "\n").write(toFile: activePath, atomically: true, encoding: .utf8)
    try? (nextKey + "\n").write(toFile: manualStudyDayFile, atomically: true, encoding: .utf8)
    try? "base_minutes,base_anki,updated\n0,0,\n".write(toFile: offsetPath, atomically: true, encoding: .utf8)

    stats.todayMinutes = 0
    stats.manualMinutesToday = 0
    stats.todayCards = 0

    productivityDayKey = nextKey
    selectedProductivityDayKey = nextKey

    standupToday = ""
    standupTomorrow = ""
    standupBlockers = ""

    refresh()
}


func currentManualStudyDay() -> String {
        if let raw = try? String(contentsOfFile: activeStudyDayFile) {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }

        if let raw = try? String(contentsOfFile: manualStudyDayFile) {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }

        return noctyriumDateKey()
    }


    func refresh() {
        refreshing = true
        DispatchQueue.global(qos: .userInitiated).async {
            let output = shell("\"\(scripts)/dashboard_stats.sh\"")
            let s = parseStats(output)
            let l = loadLogs(logFile)
            let j = loadJournal(journalFile)
            let t = loadTasks(taskFile)
            let tracker = loadCourseTracker(selectedCourseTrackerPath)
            let bsce = loadCourseTracker("\(appData)/Course Trackers/bsce_t2_tracker.csv")

            DispatchQueue.main.async {
                stats = s
                logs = l
                journal = j
                tasks = t
                trackerItems = tracker
                bsceItems = bsce
                status = output
                refreshing = false
            }
        }
    }

    
    func runSuggestionSweep() {
        ensureFiles()

        let freshTasks = loadTasks(taskFile)
        let freshJournal = loadJournal(journalFile)
        let freshNB3 = loadCourseTracker(nb3TrackerFile)
        let freshBSCE = loadCourseTracker(bsceTrackerFile)

        tasks = freshTasks
        journal = freshJournal
        trackerItems = freshNB3
        bsceItems = freshBSCE

        smartSuggestions = buildSmartSuggestions(
            tasks: freshTasks,
            journal: freshJournal,
            nb3Items: freshNB3,
            bsceItems: freshBSCE
        )

        let snapshot = smartSuggestions.map {
            "- [\($0.source)] \($0.title) — \($0.reason)"
        }.joined(separator: "\n")

        let path = "\(appData)/suggestions_snapshot.md"
        try? snapshot.write(toFile: path, atomically: true, encoding: .utf8)
    }

func run(_ command: String, _ label: String) {
        refreshing = true
        DispatchQueue.global(qos: .userInitiated).async {
            let out = shell(command)
            DispatchQueue.main.async {
                status = out.isEmpty ? "\(label) complete." : out
                refreshing = false
                refresh()
            }
        }
    }

    func open(_ path: String) {
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
        status = "Opened: \(path)"
    }

    func openPath(_ path: String) {
        open(path)
    }

    func log(type: String, minutes: Int, cards: Int, note: String) {
        ensureFiles()
        let f = ISO8601DateFormatter()
        let safeNote = clean(note)
        let now = Date()
        let studyDay = currentManualStudyDay()
        append("\(f.string(from: now)),\(type),\(minutes),\(cards),\(safeNote) | study_day=\(studyDay)\n", to: logFile)
        refresh()
    }


    
func trackerMaxQuality(for item: CourseTrackerItem) -> Int {
    let type = item.type.lowercased()
    let isBSCE = item.id.uppercased().hasPrefix("BSCE_") || item.week.uppercased().contains("BSCE")
    if isBSCE && ["esoft", "imcq", "pq"].contains(type) { return 1 }
    if isBSCE && type == "plg" { return 2 }
    return 3
}


func updateBSCEQuestionWorkflowItem(_ item: CourseTrackerItem, action: String, appData: String) {
    let files = [
        "\(appData)/Course Trackers/bsce_t2_tracker.csv",
        "\(appData)/Course Trackers/T2/bsce_tracker.csv"
    ]

    for file in files {
        updateBSCEQuestionWorkflowItemInFile(item, action: action, filePath: file)
    }
}

func updateBSCEQuestionWorkflowItemInFile(_ item: CourseTrackerItem, action: String, filePath: String) {
    guard let raw = try? String(contentsOfFile: filePath) else { return }

    var output: [String] = []
    let now = ISO8601DateFormatter().string(from: Date())

    for line in raw.components(separatedBy: .newlines) {
        if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            continue
        }

        if line.hasPrefix("id,") {
            output.append(line)
            continue
        }

        var p = parseCSVLine(line)
        while p.count < 9 { p.append("") }

        if p[0] == item.id {
            let type = p[2].lowercased()

            switch action {
            case "working":
                p[4] = "working"
                p[5] = max(Int(p[5]) ?? 0, 1).description
                p[6] = "orange"
                p[7] = "Working through it"

            case "done":
                p[4] = "done"
                p[5] = type == "plg" ? "1" : "2"
                p[6] = "lightgreen"
                p[7] = "Completed"

            case "reviewed":
                p[4] = "reviewed_explanations"
                p[5] = "2"
                p[6] = "purple"
                p[7] = "Reviewed explanations / correlates"

            case "strong":
                p[4] = "strong"
                p[5] = "3"
                p[6] = "darkgreen"
                p[7] = "Strong understanding"

            case "missed":
                p[4] = "needs_review"
                p[5] = "1"
                p[6] = "red"
                p[7] = "Missed / weak — needs targeted review"

            case "reset":
                p[4] = "not_started"
                p[5] = "0"
                p[6] = "blue"
                p[7] = ""

            default:
                break
            }

            p[8] = now
            output.append(p.map(csvEscape).joined(separator: ","))
        } else {
            output.append(line)
        }
    }

    try? output.joined(separator: "\n").appending("\n").write(toFile: filePath, atomically: true, encoding: .utf8)
}

func updateTrackerItemInFile(_ item: CourseTrackerItem, action: String, filePath: String) {
        ensureFiles()

        var newQuality = item.quality
        var newStatus = item.status
        var newColor = item.color
        var note = item.notes

        if action == "addPass" {
            newQuality = min(trackerMaxQuality(for: item), newQuality + 1)
        } else if action == "removePass" {
            newQuality = max(0, newQuality - 1)
        } else if action == "ankiPass" {
            let currentAnki = extractAnkiPasses(note)
            let nextAnki = currentAnki + 1
            note = writeAnkiPasses(note, nextAnki)
        } else if action == "ankiReset" {
            note = writeAnkiPasses(note, 0)
        } else if action == "needsWork" {
            newStatus = "needs_mastery"
            newColor = "red"
            note = preservingAnki(note, replacingMainNoteWith: "Needs mastery")
        } else if action == "working" {
            newQuality = max(1, newQuality)
            newStatus = "working"
            newColor = "orange"
            note = preservingAnki(note, replacingMainNoteWith: "Working on it")
        } else if action == "complete" {
            newQuality = min(trackerMaxQuality(for: item), max(1, newQuality))
            newStatus = "young"
            newColor = "lightgreen"
            note = preservingAnki(note, replacingMainNoteWith: "Completed")
        } else if action == "mastered" {
            newQuality = trackerMaxQuality(for: item)
            newStatus = "mature"
            newColor = "darkgreen"
            note = preservingAnki(note, replacingMainNoteWith: "Mature / mastered")
        } else if action == "reset" {
            newQuality = 0
            newStatus = "not_started"
            newColor = "blue"
            note = writeAnkiPasses("", extractAnkiPasses(note))
        }

        if action == "addPass" || action == "removePass" {
            if newQuality <= 0 {
                newStatus = "not_started"
                newColor = "blue"
                note = preservingAnki(note, replacingMainNoteWith: "Not started")
            } else if newQuality == 1 {
                newStatus = "needs_mastery"
                newColor = "red"
                note = preservingAnki(note, replacingMainNoteWith: "Needs mastery")
            } else if newQuality == 2 {
                newStatus = "young"
                newColor = "lightgreen"
                note = preservingAnki(note, replacingMainNoteWith: "Young")
            } else {
                newStatus = "mature"
                newColor = "darkgreen"
                note = preservingAnki(note, replacingMainNoteWith: "Mature")
            }
        }

        rewriteTrackerItemInFile(
            id: item.id,
            status: newStatus,
            quality: newQuality,
            color: newColor,
            notes: note,
            filePath: filePath
        )

        let lowerType = item.type.lowercased()
        let minutes = action == "ankiPass" ? 12 : lowerType == "lecture" ? 35 : lowerType == "dla" ? 25 : 15
        let eventType = action == "ankiPass" ? "Anki" : lowerType == "lecture" ? "Lecture" : lowerType == "dla" ? "DLA" : "Practice"
        let ankiText = action == "ankiPass" ? " / Anki \(extractAnkiPasses(note))" : ""

        log(
            type: eventType,
            minutes: minutes,
            cards: action == "ankiPass" ? 25 : 0,
            note: "\(item.label) → \(newStatus) / \(newQuality) passes\(ankiText)"
        )

        refresh()
    }

    func rewriteTrackerItemInFile(id: String, status: String, quality: Int, color: String, notes: String, filePath: String) {
        guard let raw = try? String(contentsOfFile: filePath) else { return }

        let now = studyDayString(from: Date())
        var output: [String] = []

        for line in raw.components(separatedBy: .newlines) {
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                continue
            }

            if line.hasPrefix("id,") {
                output.append(line)
                continue
            }

            var parts = parseCSVLine(line)
            while parts.count < 9 { parts.append("") }

            if parts[0] == id {
                parts[4] = status
                parts[5] = "\(quality)"
                parts[6] = color
                parts[7] = notes
                parts[8] = now
                output.append(parts.map(csvEscape).joined(separator: ","))
            } else {
                output.append(line)
            }
        }

        try? output.joined(separator: "\n").appending("\n").write(
            toFile: filePath,
            atomically: true,
            encoding: .utf8
        )
    }

    func updateBSCETrackerItem(_ item: CourseTrackerItem, action: String) {
        updateBSCEQuestionWorkflowItem(item, action: action, appData: appData)

        let eventType = item.type.lowercased().contains("esoft") || item.type.lowercased().contains("imcq") || item.type.lowercased().contains("plg") ? "Practice" : "Review"
        let minutes = action == "working" ? 10 : action == "done" ? 25 : action == "reviewed" ? 20 : action == "strong" ? 15 : 0

        if minutes > 0 {
            log(type: eventType, minutes: minutes, cards: 0, note: "\(item.label) → \(action)")
        } else {
            refresh()
        }
    }

    func updateTrackerItem(_ item: CourseTrackerItem, _ action: String) {
        ensureFiles()

        var newQuality = item.quality
        var newStatus = item.status
        var newColor = item.color
        var note = item.notes

        if action == "addPass" {
            newQuality = min(trackerMaxQuality(for: item), newQuality + 1)
        } else if action == "removePass" {
            newQuality = max(0, newQuality - 1)
        } else if action == "ankiPass" {
            let currentAnki = extractAnkiPasses(note)
            let nextAnki = currentAnki + 1
            note = writeAnkiPasses(note, nextAnki)
        } else if action == "ankiReset" {
            note = writeAnkiPasses(note, 0)
        } else if action == "needsWork" {
            newStatus = "needs_mastery"
            newColor = "red"
            note = preservingAnki(note, replacingMainNoteWith: "Needs mastery")
        } else if action == "mastered" {
            newQuality = trackerMaxQuality(for: item)
            newStatus = "mature"
            newColor = "darkgreen"
            note = preservingAnki(note, replacingMainNoteWith: "Mature / mastered")
        } else if action == "reset" {
            newQuality = 0
            newStatus = "not_started"
            newColor = "blue"
            note = writeAnkiPasses("", extractAnkiPasses(note))
        }

        if action == "addPass" || action == "removePass" {
            if newQuality <= 0 {
                newStatus = "not_started"
                newColor = "blue"
                note = preservingAnki(note, replacingMainNoteWith: "Not started")
            } else if newQuality == 1 {
                newStatus = "needs_mastery"
                newColor = "red"
                note = preservingAnki(note, replacingMainNoteWith: "Needs mastery")
            } else if newQuality == 2 {
                newStatus = "young"
                newColor = "lightgreen"
                note = preservingAnki(note, replacingMainNoteWith: "Young")
            } else {
                newStatus = "mature"
                newColor = "darkgreen"
                note = preservingAnki(note, replacingMainNoteWith: "Mature")
            }
        }

        rewriteTrackerItem(
            id: item.id,
            status: newStatus,
            quality: newQuality,
            color: newColor,
            notes: note
        )

        if action == "addPass" || action == "ankiPass" {
            let minutes = action == "ankiPass" ? 12 : item.type.lowercased() == "lecture" ? 50 : item.type.lowercased() == "dla" ? 25 : 15
            let eventType = action == "ankiPass" ? "Anki" : item.type.lowercased() == "lecture" ? "Lecture" : item.type.lowercased() == "dla" ? "DLA" : "Practice"
            let ankiText = action == "ankiPass" ? " / Anki \(extractAnkiPasses(note))" : ""
            log(type: eventType, minutes: minutes, cards: action == "ankiPass" ? 25 : 0, note: "\(item.label) → \(newStatus) / \(newQuality) passes\(ankiText)")
        } else {
            refresh()
        }
    }

    func addPracticeItem(_ practiceType: String, _ title: String, _ questionCount: String, _ score: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return }

        let count = Int(questionCount.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        let grade = score.uppercased()

        let color: String
        let status: String

        switch grade {
        case "A":
            color = "darkgreen"
            status = "mature"
        case "B":
            color = "lightgreen"
            status = "young"
        case "C":
            color = "orange"
            status = "shaky"
        case "D", "F":
            color = "red"
            status = "needs_mastery"
        default:
            color = "blue"
            status = "not_started"
        }

        let id = "\(practiceType.uppercased())-\(Int(Date().timeIntervalSince1970))"
        let now = ISO8601DateFormatter().string(from: Date())
        let safeTitle = clean(trimmed)
        let line = "\(id),Week Custom,\(practiceType),\(safeTitle),\(status),\(count),\(color),Score \(grade),\(now)\n"

        append(line, to: nb3TrackerFile)
        log(type: "Practice", minutes: max(10, count), cards: 0, note: "\(practiceType): \(trimmed) • \(count) questions • \(grade)")
        refresh()
    }

    func rewriteTrackerItem(id: String, status: String, quality: Int, color: String, notes: String) {
        guard let raw = try? String(contentsOfFile: nb3TrackerFile) else { return }

        let lines = raw.components(separatedBy: .newlines)
        var output: [String] = []

        for line in lines {
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }

            if line.hasPrefix("id,") {
                output.append(line)
                continue
            }

            let parts = parseCSVLine(line)
            if parts.count >= 9 && parts[0] == id {
                let updated = ISO8601DateFormatter().string(from: Date())
                output.append("\(parts[0]),\(parts[1]),\(parts[2]),\(clean(parts[3])),\(status),\(quality),\(color),\(clean(notes)),\(updated)")
            } else {
                output.append(line)
            }
        }

        try? output.joined(separator: "\n").appending("\n").write(toFile: nb3TrackerFile, atomically: true, encoding: .utf8)
        refresh()
    }


    func saveStandup() {
        ensureFiles()
        let f = ISO8601DateFormatter()
        let line = "\(f.string(from: Date())),\(clean(standupToday)),\(clean(standupTomorrow)),\(clean(standupBlockers)),\(standupEnergy),\(standupRating)\n"
        append(line, to: journalFile)

        try? FileManager.default.createDirectory(atPath: "\(base)/09 Admin/Journal", withIntermediateDirectories: true)
        let readable = """
        # Daily Standup

        Date: \(Date())

        ## What I did today
        \(standupToday)

        ## What I will do tomorrow
        \(standupTomorrow)

        ## Blockers
        \(standupBlockers)

        ## Energy
        \(standupEnergy)

        ## Rating
        \(standupRating)
        """
        let fileName = "\(base)/09 Admin/Journal/Standup - \(DateFormatter.fileSafe.string(from: Date())).md"
        try? readable.write(toFile: fileName, atomically: true, encoding: .utf8)

        standupToday = ""
        standupTomorrow = ""
        standupBlockers = ""
        standupEnergy = "Medium"
        standupRating = "Useful"

        log(type: "Journal", minutes: 5, cards: 0, note: "Daily standup")
        refresh()
    }

    func addTask() {
        let trimmed = newTask.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let f = ISO8601DateFormatter()
        let id = UUID().uuidString
        let now = f.string(from: Date())
        append("\(id),\(now),\(now),\(clean(trimmed)),open,\n", to: taskFile)
        newTask = ""
        refresh()
    }

    func updateTrackerItem(id: String, passDelta: Int? = nil, setStatus: String? = nil, setColor: String? = nil, note: String? = nil) {
        guard let raw = try? String(contentsOfFile: nb3TrackerFile) else { return }
        let lines = raw.components(separatedBy: .newlines).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !lines.isEmpty else { return }

        let now = studyDayString(from: Date())
        var updated: [String] = [lines[0]]

        for line in lines.dropFirst() {
            var p = parseCSVLine(line)
            while p.count < 9 { p.append("") }

            if p[0] == id {
                var q = Int(p[5]) ?? 0
                if let passDelta = passDelta {
                    q = max(0, min(4, q + passDelta))
                    p[5] = "\(q)"
                    if q == 0 {
                        p[4] = "not_started"
                        p[6] = "gray"
                    } else if q == 1 {
                        p[4] = "pass_1"
                        p[6] = "red"
                    } else if q == 2 {
                        p[4] = "pass_2"
                        p[6] = "orange"
                    } else if q == 3 {
                        p[4] = "completed"
                        p[6] = "green"
                    } else {
                        p[4] = "mastered"
                        p[6] = "blue"
                    }
                }

                if let setStatus = setStatus { p[4] = setStatus }
                if let setColor = setColor { p[6] = setColor }
                if let note = note { p[7] = clean(note) }
                p[8] = now
            }

            updated.append(p.map { clean($0) }.joined(separator: ","))
        }

        try? updated.joined(separator: "\n").appending("\n").write(toFile: nb3TrackerFile, atomically: true, encoding: .utf8)
        refresh()
    }

    func addTrackerItem(type: String, label: String, week: String = "Custom", notes: String = "") {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let now = studyDayString(from: Date())
        let id = "\(type.uppercased().replacingOccurrences(of: " ", with: ""))-\(Int(Date().timeIntervalSince1970))"
        let line = "\(id),\(week),\(type),\(clean(trimmed)),not_started,0,gray,\(clean(notes)),\(now)"
        append(line, to: nb3TrackerFile)
        refresh()
    }



    func completeTask(_ task: TaskItem) {
        guard let text = try? String(contentsOfFile: taskFile) else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        let lines = text.split(separator: "\n").map(String.init)
        let updated = lines.map { line -> String in
            if line.hasPrefix(task.id + ",") {
                let p = line.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
                if p.count >= 6 { return "\(p[0]),\(p[1]),\(p[2]),\(p[3]),done,\(now)" }
            }
            return line
        }
        try? updated.joined(separator: "\n").appending("\n").write(toFile: taskFile, atomically: true, encoding: .utf8)
        log(type: "Task", minutes: 10, cards: 0, note: "Completed task")
        refresh()
    }
}

// MARK: Pages

struct DashboardPage: View {
    let stats: Stats
    let logs: [StudyLog]
    let suggestions: [SmartSuggestion]
    let refreshSuggestions: () -> Void
    let trackerItems: [CourseTrackerItem]
    let bsceItems: [CourseTrackerItem]
    @Binding var selectedTrackerModule: String
    let runHub: () -> Void
    let sort: () -> Void
    let review: () -> Void
    let openInbox: () -> Void
    let openAnkiMedia: () -> Void
    let logLecture: () -> Void
    let logAnki50: () -> Void
    let logAnki100: () -> Void
    let logStudy60: () -> Void

    @Binding var standupToday: String
    @Binding var standupTomorrow: String
    @Binding var standupBlockers: String
    @Binding var standupEnergy: String
    @Binding var standupRating: String
    let saveStandup: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            DashboardCards(stats: stats)

            DashboardTrackerModuleCard(
                trackerItems: trackerItems,
                bsceItems: bsceItems,
                selectedModule: $selectedTrackerModule
            )

            DashboardSuggestionCard(
                suggestions: suggestions,
                refresh: refreshSuggestions
            )

            HStack(alignment: .top, spacing: 20) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 16) {
                        PanelHeader("Command Deck", "Fast actions that actually matter")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            ActionTile("Run Hub", "Full sequence", "command", runHub)
                            ActionTile("Auto Sort", "Downloads only", "tray.and.arrow.down", sort)
                            ActionTile("Review", "Weekly stats", "chart.bar.doc.horizontal", review)
                            ActionTile("Inbox", "Open queue", "tray.full", openInbox)
                            ActionTile("Anki Media", "collection.media", "photo.stack", openAnkiMedia)
                        }
                    }.padding(18)
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 16) {
                        PanelHeader("Quick Log", "Lecture and Anki increments")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
                            MiniLog("Lecture", "+50m", logLecture)
                            MiniLog("+50 🃜", "+15m", logAnki50)
                            MiniLog("+100 🃚", "+30m", logAnki100)
                            MiniLog("Study", "+60m", logStudy60)
                        }
                    }.padding(18)
                }
                .frame(width: 390)
            }

            HStack(alignment: .top, spacing: 20) {
                StandupCard(
                    today: $standupToday,
                    tomorrow: $standupTomorrow,
                    blockers: $standupBlockers,
                    energy: $standupEnergy,
                    rating: $standupRating,
                    save: saveStandup
                )

                GlassCard {
                    VStack(alignment: .leading, spacing: 16) {
                        PanelHeader("Today’s Vital Signs", "Time, cards, and usefulness signal")
                        RingScore(minutes: max(0, stats.todayMinutes + stats.manualMinutesToday), cards: max(0, stats.todayCards))
                        Heatmap(logs: logs, openDay: { key in openProductivityDayFile(key) })
                    }.padding(18)
                }
                .frame(width: 440)
            }
        }
    }
}

struct CoursesPage: View {
    let stats: Stats
    let open: (String) -> Void
    @State private var expanded: String? = "01 BPM 500"

    var base: String { FileManager.default.homeDirectoryForCurrentUser.path + "/Medical School" }

    var body: some View {
        VStack(spacing: 20) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 16)], spacing: 16) {
                CourseCard("01 BPM 500", term: "Term 1", files: stats.bpm500, action: { open("\(base)/10 Courses/Term 1/01 BPM 500") })
                CourseCard("01 BPM 501", term: "Term 1", files: stats.bpm501, action: { open("\(base)/10 Courses/Term 1/01 BPM 501") })
                CourseCard("02 PPM 500", term: "Term 2", files: stats.ppm500, action: { open("\(base)/10 Courses/Term 2/02 PPM 500") })
                CourseCard("02 PPM 501", term: "Term 2", files: stats.ppm501, action: { open("\(base)/10 Courses/Term 2/02 PPM 501") })
                CourseCard("02 PPM 502", term: "Term 2", files: stats.ppm502, action: { open("\(base)/10 Courses/Term 2/02 PPM 502") })
            }

            CourseModules(
                expanded: $expanded,
                open: open,
                base: base
            )
        }
    }
}

struct CourseModules: View {
    @Binding var expanded: String?
    let open: (String) -> Void
    let base: String

    let groups: [(String, String, [String])] = [
        ("01 BPM 500", "10 Courses/Term 1/01 BPM 500", ["FTM 1", "FTM 2", "MSK", "CPR 1", "CPR 2"]),
        ("01 BPM 501", "10 Courses/Term 1/01 BPM 501", ["ER", "DM", "NB 1", "NB 2", "NB 3"]),
        ("02 PPM 500", "10 Courses/Term 2/02 PPM 500", ["Lectures", "Slides", "Notes", "Study Guides", "Weak Areas"]),
        ("02 PPM 501", "10 Courses/Term 2/02 PPM 501", ["Lectures", "Slides", "Notes", "Study Guides", "Weak Areas"]),
        ("02 PPM 502", "10 Courses/Term 2/02 PPM 502", ["Lectures", "Slides", "Notes", "Study Guides", "Weak Areas"])
    ]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader("Course Modules", "Dropdown-style module access")

                ForEach(groups, id: \.0) { group in
                    VStack(spacing: 8) {
                        Button {
                            expanded = expanded == group.0 ? nil : group.0
                        } label: {
                            HStack {
                                Text(group.0)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                Spacer()
                                Image(systemName: expanded == group.0 ? "chevron.down" : "chevron.right")
                            }
                            .foregroundColor(.white)
                            .padding(12)
                            .glassButton()
                        }
                        .buttonStyle(.plain)

                        if expanded == group.0 {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 135), spacing: 10)], spacing: 10) {
                                ForEach(group.2, id: \.self) { module in
                                    MiniButton(module) {
                                        open("\(base)/\(group.1)/\(module)")
                                    }
                                }
                            }
                            .padding(.horizontal, 4)
                            .padding(.bottom, 6)
                        }
                    }
                }
            }
            .padding(18)
        }
    }
}








struct CourseTrackerPage: View {
    let items: [CourseTrackerItem]
    let bsceItems: [CourseTrackerItem]
    @Binding var selectedTrackerFile: String
    let base: String
    let open: (String) -> Void
    let refreshData: () -> Void
    let updateItem: (CourseTrackerItem, String) -> Void
    let updateBSCEItem: (CourseTrackerItem, String) -> Void
    let addPractice: (String, String, String, String) -> Void
    let suggestions: [SmartSuggestion]
    let refreshSuggestions: () -> Void

    @State private var expandedTerms: Set<String> = ["T2"]
    @State private var expandedModules: Set<String> = ["T2 • NB3", "T2 • BSCE"]
    @State private var selectedLeaf = "T2 • NB3"
    @State private var newPracticeTitle = ""
    @State private var newPracticeCount = ""
    @State private var newPracticeScore = "A"
    @State private var newPracticeType = "PLG"

    let tree: [(String, [(String, String)])] = [
        ("T1", [
            ("FTM 1", "T1 • FTM 1"),
            ("FTM 2", "T1 • FTM 2"),
            ("MSK", "T1 • MSK"),
            ("CPR 1", "T1 • CPR 1"),
            ("CPR 2", "T1 • CPR 2")
        ]),
        ("T2", [
            ("ER", "T2 • ER"),
            ("DM", "T2 • DM"),
            ("NB1", "T2 • NB1"),
            ("NB2", "T2 • NB2"),
            ("NB3", "T2 • NB3"),
            ("BSCE", "T2 • BSCE")
        ]),
        ("T3", [("Term 3", "T3 • Overview")]),
        ("T4", [("Term 4", "T4 • Overview")]),
        ("T5", [("Term 5", "T5 • Overview")])
    ]

    var currentItems: [CourseTrackerItem] {
        switch selectedLeaf {
        case "T2 • NB3":
            if !items.isEmpty { return items }

            let root = loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/nb3_tracker.csv")
            if !root.isEmpty { return root }

            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T2/nb3_tracker.csv")

        case "T2 • BSCE":
            if !bsceItems.isEmpty { return bsceItems }

            let root = loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/bsce_t2_tracker.csv")
            if !root.isEmpty { return root }

            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T2/bsce_tracker.csv")

        case "T2 • ER":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T2/er_tracker.csv")
        case "T2 • DM":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T2/dm_tracker.csv")
        case "T2 • NB1":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T2/nb1_tracker.csv")
        case "T2 • NB2":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T2/nb2_tracker.csv")
        case "T1 • FTM 1":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T1/ftm1_tracker.csv")
        case "T1 • FTM 2":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T1/ftm2_tracker.csv")
        case "T1 • MSK":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T1/msk_tracker.csv")
        case "T1 • CPR 1":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T1/cpr1_tracker.csv")
        case "T1 • CPR 2":
            return loadCourseTracker("\(base)/09 Admin/App Data/Course Trackers/T1/cpr2_tracker.csv")
        default:
            return []
        }
    }

    func trackerFileForSelectedLeaf() -> String {
        switch selectedLeaf {
        case "T1 • FTM 1":
            return "\(base)/09 Admin/App Data/Course Trackers/T1/ftm1_tracker.csv"
        case "T1 • FTM 2":
            return "\(base)/09 Admin/App Data/Course Trackers/T1/ftm2_tracker.csv"
        case "T1 • MSK":
            return "\(base)/09 Admin/App Data/Course Trackers/T1/msk_tracker.csv"
        case "T1 • CPR 1":
            return "\(base)/09 Admin/App Data/Course Trackers/T1/cpr1_tracker.csv"
        case "T1 • CPR 2":
            return "\(base)/09 Admin/App Data/Course Trackers/T1/cpr2_tracker.csv"
        case "T2 • ER":
            return "\(base)/09 Admin/App Data/Course Trackers/T2/er_tracker.csv"
        case "T2 • DM":
            return "\(base)/09 Admin/App Data/Course Trackers/T2/dm_tracker.csv"
        case "T2 • NB1":
            return "\(base)/09 Admin/App Data/Course Trackers/T2/nb1_tracker.csv"
        case "T2 • NB2":
            return "\(base)/09 Admin/App Data/Course Trackers/T2/nb2_tracker.csv"
        case "T2 • NB3":
            return "\(base)/09 Admin/App Data/Course Trackers/nb3_tracker.csv"
        case "T2 • BSCE":
            return "\(base)/09 Admin/App Data/Course Trackers/bsce_t2_tracker.csv"
        case "T3 • Overview":
            return "\(base)/09 Admin/App Data/Course Trackers/T3/term3_tracker.csv"
        case "T4 • Overview":
            return "\(base)/09 Admin/App Data/Course Trackers/T4/term4_tracker.csv"
        case "T5 • Overview":
            return "\(base)/09 Admin/App Data/Course Trackers/T5/term5_tracker.csv"
        default:
            return "\(base)/09 Admin/App Data/Course Trackers/empty.csv"
        }
    }

    var updater: (CourseTrackerItem, String) -> Void {
        selectedLeaf == "T2 • BSCE" ? updateBSCEItem : updateItem
    }

    var lectures: [CourseTrackerItem] {
        currentItems.filter { $0.type.lowercased() == "lecture" }
    }

    var dlas: [CourseTrackerItem] {
        currentItems.filter { $0.type.lowercased() == "dla" }
    }

    var plgs: [CourseTrackerItem] {
        currentItems.filter { $0.type.lowercased() == "plg" }
    }

    var esofts: [CourseTrackerItem] {
        currentItems.filter { $0.type.lowercased() == "esoft" }
    }

    var imcqs: [CourseTrackerItem] {
        currentItems.filter { $0.type.lowercased() == "imcq" }
    }

    var pqs: [CourseTrackerItem] {
        currentItems.filter { $0.type.lowercased() == "pq" }
    }

    var reviews: [CourseTrackerItem] {
        currentItems.filter {
            ["term review", "pathways", "correlates", "small group", "other event"].contains($0.type.lowercased())
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            GlassCard {
                VStack(alignment: .leading, spacing: 12) {
                    PanelHeader("Course Tracker", "Finder-style mastery tree")

                    ForEach(tree, id: \.0) { term, modules in
                        VStack(alignment: .leading, spacing: 7) {
                            Button {
                                if expandedTerms.contains(term) {
                                    expandedTerms.remove(term)
                                } else {
                                    expandedTerms.insert(term)
                                }
                            } label: {
                                HStack {
                                    Image(systemName: expandedTerms.contains(term) ? "chevron.down" : "chevron.right")
                                        .font(.system(size: 10, weight: .bold))
                                    Text(term)
                                        .font(.system(size: 13, weight: .black, design: .rounded))
                                    Spacer()
                                }
                                .foregroundColor(.white)
                                .padding(.vertical, 8)
                                .padding(.horizontal, 10)
                                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.075)))
                            }
                            .buttonStyle(.plain)

                            if expandedTerms.contains(term) {
                                ForEach(modules, id: \.1) { name, key in
                                    Button {
                                        selectedLeaf = key
                                        selectedTrackerFile = trackerFile(for: key)
                                        expandedModules.insert(key)
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                                            refreshData()
                                        }
                                    } label: {
                                        HStack {
                                            Image(systemName: selectedLeaf == key ? "folder.fill" : "folder")
                                                .font(.system(size: 11))
                                                .foregroundColor(selectedLeaf == key ? .cyan : .white.opacity(0.6))
                                            Text(name)
                                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                            Spacer()
                                            Text(modulePercent(key))
                                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                                .foregroundColor(.white.opacity(0.55))
                                        }
                                        .padding(.vertical, 7)
                                        .padding(.horizontal, 18)
                                        .background(
                                            RoundedRectangle(cornerRadius: 10)
                                                .fill(selectedLeaf == key ? Color.cyan.opacity(0.16) : Color.clear)
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }

                    Divider().opacity(0.2)

                    MiniButton("Open Tracker Data") {
                        open("\(base)/09 Admin/App Data/Course Trackers")
                    }
                }
                .padding(16)
            }
            .frame(width: 260)

            VStack(spacing: 16) {
                GlassCard {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(selectedLeaf)
                                .font(.system(size: 28, weight: .black, design: .rounded))
                                .foregroundColor(.white)

                            Text("Pass logic: 0 blue • 1 red needs mastery • 2 light green young • 3+ dark green mature.")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundColor(.white.opacity(0.58))
                        }

                        Spacer()

                        ModuleMasteryRing(items: currentItems)
                            .frame(width: 92, height: 92)
                    }
                    .padding(18)
                }

                CourseTrackerSuggestionPanel(
                    suggestions: suggestions,
                    selectedLeaf: selectedLeaf,
                    refresh: refreshSuggestions
                )

                if selectedLeaf == "T2 • NB3" {
                    TrackerFolderSection(title: "Lectures", subtitle: "NB lecture passes + Anki overlay", items: lectures, updater: updater)
                    TrackerFolderSection(title: "DLAs", subtitle: "Required DLA passes", items: dlas, updater: updater)
                    TrackerFolderSection(title: "Practice Questions", subtitle: "Weekly BEHS / NSCI PQs", items: pqs, updater: updater)
                    AddCourseItemCard(
                        title: $newPracticeTitle,
                        count: $newPracticeCount,
                        score: $newPracticeScore,
                        type: $newPracticeType,
                        add: { addPractice(newPracticeType, newPracticeTitle, newPracticeCount, newPracticeScore) }
                    )
                    TrackerFolderSection(title: "Framework Later", subtitle: "Small group, IMCQ, eSoft, OSPE", items: reviews + esofts + imcqs + plgs, updater: updater)
                } else if selectedLeaf == "T2 • BSCE" {
                    BSCEFolderDashboard(items: currentItems, updater: updater)
                } else {
                    TrackerFolderSection(
                        title: "No tracker built yet",
                        subtitle: "This module is intentionally empty for now. BSCE prep lives only under T2 • BSCE.",
                        items: [],
                        updater: updater
                    )
                }
            }
        }
    }

    
    func trackerFile(for key: String) -> String {
        switch key {
        case "T1 • FTM 1": return "T1/ftm1_tracker.csv"
        case "T1 • FTM 2": return "T1/ftm2_tracker.csv"
        case "T1 • MSK": return "T1/msk_tracker.csv"
        case "T1 • CPR 1": return "T1/cpr1_tracker.csv"
        case "T1 • CPR 2": return "T1/cpr2_tracker.csv"
        case "T2 • ER": return "T2/er_tracker.csv"
        case "T2 • DM": return "T2/dm_tracker.csv"
        case "T2 • NB1": return "T2/nb1_tracker.csv"
        case "T2 • NB2": return "T2/nb2_tracker.csv"
        case "T2 • NB3": return "T2/nb3_tracker.csv"
        case "T2 • BSCE": return "T2/bsce_tracker.csv"
        case "T3 • Overview": return "T3/term3_tracker.csv"
        case "T4 • Overview": return "T4/term4_tracker.csv"
        case "T5 • Overview": return "T5/term5_tracker.csv"
        default: return "T2/nb3_tracker.csv"
        }
    }

func modulePercent(_ key: String) -> String {
        let source: [CourseTrackerItem]
        if key == "T2 • NB3" {
            source = items
        } else if key == "T2 • BSCE" {
            source = bsceItems
        } else {
            source = generatedModuleItems(for: key)
        }

        guard !source.isEmpty else { return "0%" }
        let total = source.reduce(0) { $0 + min(max($1.quality, 0), 3) }
        let possible = source.count * 3
        return "\(Int((Double(total) / Double(max(possible, 1))) * 100))%"
    }

    func generatedModuleItems(for key: String) -> [CourseTrackerItem] {
        return []
    }
}

struct TrackerFolderSection: View {
    let title: String
    let subtitle: String
    let items: [CourseTrackerItem]
    let updater: (CourseTrackerItem, String) -> Void

    @State private var expanded = true

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    expanded.toggle()
                } label: {
                    HStack {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 11, weight: .bold))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(title)
                                .font(.system(size: 16, weight: .black, design: .rounded))
                            Text("\(subtitle) • \(items.count) items")
                                .font(.system(size: 10.5, weight: .medium, design: .rounded))
                                .foregroundColor(.white.opacity(0.52))
                        }
                        Spacer()
                        Text(sectionPercent)
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundColor(.white.opacity(0.72))
                    }
                    .foregroundColor(.white)
                }
                .buttonStyle(.plain)

                if expanded {
                    VStack(spacing: 5) {
                        ForEach(items) { item in
                            TrackerDenseRow(item: item, updater: updater)
                        }
                    }
                    .padding(.top, 6)
                }
            }
            .padding(14)
        }
    }

    var sectionPercent: String {
        guard !items.isEmpty else { return "0%" }
        let total = items.reduce(0) { $0 + min(max($1.quality, 0), 3) }
        return "\(Int(Double(total) / Double(items.count * 3) * 100))%"
    }
}



struct TrackerMiniAction: View {
    let title: String
    let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 9.5, weight: .black, design: .rounded))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, 8)
                .frame(height: 24)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.10)))
        }
        .buttonStyle(.plain)
    }
}



struct TrackerDenseRow: View {
    let item: CourseTrackerItem
    let updater: (CourseTrackerItem, String) -> Void

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 4)
                .fill(mainColor)
                .frame(width: 6, height: 34)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(item.label)
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundColor(.white)
                        .lineLimit(1)

                    Spacer()

                    tickStrip
                        .frame(width: 64, alignment: .trailing)
                }

                Text(subtitle)
                    .font(.system(size: 9.5, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.50))
                    .lineLimit(1)
            }

            if isBSCE {
                bsceButtons
                    .frame(width: 310, alignment: .trailing)
            } else {
                lectureButtons
                    .frame(width: 300, alignment: .trailing)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(background)
    }

    var isBSCE: Bool {
        item.id.uppercased().hasPrefix("BSCE_") || item.week.uppercased().contains("BSCE") || item.week.lowercased().contains("module")
    }

    var type: String {
        item.type.lowercased()
    }

    var subtitle: String {
        if isBSCE {
            switch item.status {
            case "working": return "\(item.type) • working through it"
            case "done": return "\(item.type) • completed"
            case "reviewed_explanations": return "\(item.type) • explanations reviewed"
            case "strong": return "\(item.type) • strong"
            case "needs_review": return "\(item.type) • weak / needs review"
            default: return "\(item.type) • not started"
            }
        }

        if item.quality <= 0 { return "\(item.type) • not started" }
        if item.quality == 1 { return "\(item.type) • needs mastery" }
        if item.quality == 2 { return "\(item.type) • young" }
        return "\(item.type) • mature"
    }

    var tickCount: Int {
        min(max(item.quality, 0), 3)
    }

    var tickStrip: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { i in
                Image(systemName: i < tickCount ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(i < tickCount ? mainColor : .white.opacity(0.22))
            }
        }
    }

    var bsceButtons: some View {
        HStack(spacing: 6) {
            TrackerMiniAction("Working") { updater(item, "working") }

            if ["esoft", "imcq", "plg", "pq"].contains(type) {
                TrackerMiniAction("Done") { updater(item, "done") }
                TrackerMiniAction("Review") { updater(item, "reviewed") }
                TrackerMiniAction("Weak") { updater(item, "missed") }
                TrackerMiniAction("Reset") { updater(item, "reset") }
            } else {
                TrackerMiniAction("Done") { updater(item, "done") }
                TrackerMiniAction("Review") { updater(item, "reviewed") }
                TrackerMiniAction("Strong") { updater(item, "strong") }
                TrackerMiniAction("Weak") { updater(item, "missed") }
                TrackerMiniAction("Reset") { updater(item, "reset") }
            }
        }
    }

    var lectureButtons: some View {
        HStack(spacing: 6) {
            TrackerMiniAction("+") { updater(item, "addPass") }
            TrackerMiniAction("−") { updater(item, "removePass") }
            TrackerMiniAction("Anki") { updater(item, "ankiPass") }
            TrackerMiniAction("Working") { updater(item, "working") }
            TrackerMiniAction("Mature") { updater(item, "mastered") }
            TrackerMiniAction("Reset") { updater(item, "reset") }
        }
    }

    var background: some View {
        ZStack(alignment: .trailing) {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.055))

            if !isBSCE {
                GeometryReader { geo in
                    Path { path in
                        let w = geo.size.width
                        let h = geo.size.height
                        path.move(to: CGPoint(x: w * 0.75, y: 0))
                        path.addLine(to: CGPoint(x: w, y: 0))
                        path.addLine(to: CGPoint(x: w, y: h))
                        path.addLine(to: CGPoint(x: w * 0.68, y: h))
                        path.closeSubpath()
                    }
                    .fill(ankiColor.opacity(0.23))
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    var mainColor: Color {
        switch item.color.lowercased() {
        case "red": return .red
        case "lightgreen": return .green.opacity(0.62)
        case "darkgreen": return .green
        case "orange": return .orange
        case "purple": return .purple
        case "blue": return .blue
        default: return .blue.opacity(0.7)
        }
    }

    var ankiColor: Color {
        let passes = extractAnkiPasses(item.notes)
        if passes <= 0 { return .clear }
        if passes == 1 { return .orange }
        if passes == 2 { return .purple }
        return .cyan
    }
}


struct PracticeEntryCard: View {
    @Binding var title: String
    @Binding var count: String
    @Binding var score: String
    @Binding var type: String
    let add: () -> Void

    let types = ["PLG", "PQ", "eSoft", "IMCQ"]
    let scores = ["A", "B", "C", "D", "F"]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                PanelHeader("Add Practice", "One-line custom question/review entry")

                HStack(spacing: 8) {
                    Picker("Type", selection: $type) {
                        ForEach(types, id: \.self) { Text($0) }
                    }
                    .frame(width: 92)

                    TextField("Question set / PLG title", text: $title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .padding(.horizontal, 10)
                        .frame(height: 34)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.08)))

                    TextField("#", text: $count)
                        .textFieldStyle(.plain)
                        .frame(width: 45, height: 34)
                        .padding(.horizontal, 8)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.08)))

                    Picker("Score", selection: $score) {
                        ForEach(scores, id: \.self) { Text($0) }
                    }
                    .frame(width: 80)

                    Button("Add", action: add)
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .frame(height: 34)
                        .glassButton()
                }
            }
            .padding(14)
        }
    }
}


struct AddCourseItemCard: View {
    @Binding var title: String
    @Binding var count: String
    @Binding var score: String
    @Binding var type: String
    let add: () -> Void

    let types = ["PLG", "PQ", "eSoft", "IMCQ", "DLA", "Term Review", "Pathways", "Correlates"]
    let scores = ["A", "B", "C", "D", "F"]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                PanelHeader("Add Course Item", "Add PLG, eSoft, IMCQ, review, or custom practice")

                HStack(spacing: 8) {
                    Picker("Type", selection: $type) {
                        ForEach(types, id: \.self) { Text($0) }
                    }
                    .frame(width: 112)

                    TextField("Item title", text: $title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .padding(.horizontal, 10)
                        .frame(height: 34)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.08)))

                    TextField("#", text: $count)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .frame(width: 48, height: 34)
                        .padding(.horizontal, 8)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.08)))

                    Picker("Score", selection: $score) {
                        ForEach(scores, id: \.self) { Text($0) }
                    }
                    .frame(width: 82)

                    Button("Add") {
                        add()
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .glassButton()
                }
            }
            .padding(14)
        }
    }
}


struct DashboardTrackerModuleCard: View {
    let trackerItems: [CourseTrackerItem]
    let bsceItems: [CourseTrackerItem]
    @Binding var selectedModule: String

    let options = ["T2 • NB3", "T2 • BSCE"]

    var selectedItems: [CourseTrackerItem] {
        selectedModule == "T2 • BSCE" ? bsceItems : trackerItems
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    PanelHeader("Selected Module Cockpit", "Choose what appears on the dashboard")

                    Spacer()

                    Picker("Module", selection: $selectedModule) {
                        ForEach(options, id: \.self) { Text($0) }
                    }
                    .frame(width: 150)
                }

                HStack(spacing: 14) {
                    ModuleMasteryRing(items: selectedItems)
                        .frame(width: 110, height: 110)

                    VStack(alignment: .leading, spacing: 8) {
                        Text(nextMove)
                            .font(.system(size: 18, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("This reads passes, maturity, and weak items. Lecture/DLA completion carries the most weight; practice pushes the module from good to exam-ready.")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundColor(.white.opacity(0.55))
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer()
                }
            }
            .padding(18)
        }
    }

    var nextMove: String {
        let core = selectedItems.filter { ["lecture", "dla"].contains($0.type.lowercased()) }
        let firstPasses = core.filter { $0.quality >= 1 }.count

        if selectedModule.contains("NB3") {
            if firstPasses < 10 {
                if let zero = selectedItems.first(where: { ["lecture", "dla"].contains($0.type.lowercased()) && $0.quality < 1 }) {
                    return "Next move: first pass \(zero.label). You are under 10 core passes."
                }
            } else {
                if let one = selectedItems.first(where: { ["lecture", "dla"].contains($0.type.lowercased()) && $0.quality == 1 }) {
                    return "Next move: second pass \(one.label). Convert red to young."
                }
                if let zero = selectedItems.first(where: { ["lecture", "dla"].contains($0.type.lowercased()) && $0.quality < 1 }) {
                    return "Next move: new coverage \(zero.label), then questions."
                }
            }

            if let q = selectedItems.first(where: { ["pq", "esoft", "imcq"].contains($0.type.lowercased()) && $0.quality < 1 }) {
                return "Next move: question pressure with \(q.label)."
            }
        }

        if selectedModule.contains("BSCE") {
            if let plg = selectedItems.first(where: { $0.type.lowercased() == "plg" && $0.quality < 1 }) {
                return "Next move: BSCE PLG review — \(plg.label)."
            }

            if let corr = selectedItems.first(where: { ["correlates", "pathways", "weak areas"].contains($0.type.lowercased()) && $0.quality < 1 }) {
                return "Next move: correlates/pathways — \(corr.label)."
            }

            if let q = selectedItems.first(where: { ["esoft", "imcq"].contains($0.type.lowercased()) && $0.quality < 1 }) {
                return "Next move: BSCE questions — \(q.label)."
            }
        }

        return "Next move: maintenance pass, then timed questions."
    }
}

struct ModuleMasteryRing: View {
    let items: [CourseTrackerItem]

    var percent: Double {
        guard !items.isEmpty else { return 0 }
        let weighted = items.reduce(0.0) { total, item in
            let type = item.type.lowercased()
            let weight: Double = ["lecture", "dla"].contains(type) ? 1.4 : ["pq", "plg", "esoft", "imcq"].contains(type) ? 1.0 : 0.65
            return total + (Double(min(max(item.quality, 0), 3)) / 3.0) * weight
        }

        let possible = items.reduce(0.0) { total, item in
            let type = item.type.lowercased()
            return total + (["lecture", "dla"].contains(type) ? 1.4 : ["pq", "plg", "esoft", "imcq"].contains(type) ? 1.0 : 0.65)
        }

        return min(max(weighted / max(possible, 0.1), 0), 1)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.12), lineWidth: 10)

            Circle()
                .trim(from: 0, to: percent)
                .stroke(Color.cyan.opacity(0.9), style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))

            VStack(spacing: 0) {
                Text("\(Int(percent * 100))%")
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                Text("mastery")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundColor(.white.opacity(0.52))
            }
        }
    }
}





struct BSCEFolderDashboard: View {
    let items: [CourseTrackerItem]
    let updater: (CourseTrackerItem, String) -> Void

    let t1Modules = ["FTM 1", "FTM 2", "MSK", "CPR 1", "CPR 2"]
    let t2Modules = ["ER", "DM", "NB1", "NB2", "NB3"]

    var body: some View {
        VStack(spacing: 14) {
            BSCEStageFolder(
                title: "T1 BSCE Foundation Review",
                subtitle: "FTM 1, FTM 2, MSK, CPR 1, CPR 2",
                modules: t1Modules,
                items: items,
                updater: updater
            )

            BSCEStageFolder(
                title: "T2 BSCE Systems Review",
                subtitle: "ER, DM, NB1, NB2, NB3",
                modules: t2Modules,
                items: items,
                updater: updater
            )

            let termWide = items.filter { $0.week.lowercased().contains("term") || $0.type.lowercased().contains("term") }
            TrackerFolderSection(
                title: "Term-Wide Review",
                subtitle: "Mixed review, final weak areas, and exam simulation",
                items: termWide,
                updater: updater
            )
        }
    }
}

struct BSCEStageFolder: View {
    let title: String
    let subtitle: String
    let modules: [String]
    let items: [CourseTrackerItem]
    let updater: (CourseTrackerItem, String) -> Void

    @State private var expanded = true

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    expanded.toggle()
                } label: {
                    HStack {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 11, weight: .black))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(title)
                                .font(.system(size: 17, weight: .black, design: .rounded))
                            Text(subtitle)
                                .font(.system(size: 10.5, weight: .medium, design: .rounded))
                                .foregroundColor(.white.opacity(0.52))
                        }

                        Spacer()

                        Text(stagePercent)
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundColor(.white.opacity(0.7))
                    }
                    .foregroundColor(.white)
                }
                .buttonStyle(.plain)

                if expanded {
                    VStack(spacing: 10) {
                        ForEach(modules, id: \.self) { module in
                            BSCEModuleFolder(
                                module: module,
                                items: moduleItems(module),
                                updater: updater
                            )
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(14)
        }
    }

    func moduleItems(_ module: String) -> [CourseTrackerItem] {
        items
            .filter { $0.week == module || $0.label.hasPrefix(module + " ") }
            .sorted { priority($0) < priority($1) }
    }

    func priority(_ item: CourseTrackerItem) -> Int {
        switch item.type.lowercased() {
        case "module": return 0
        case "plg": return 1
        case "esoft": return 2
        case "imcq": return 3
        case "correlates": return 4
        case "pathways": return 5
        case "weak areas": return 6
        case "pq": return 7
        default: return 99
        }
    }

    var stagePercent: String {
        let relevant = modules.flatMap { moduleItems($0) }
        guard !relevant.isEmpty else { return "0%" }
        let total = relevant.reduce(0) { $0 + min(max($1.quality, 0), 3) }
        return "\(Int(Double(total) / Double(relevant.count * 3) * 100))%"
    }
}

struct BSCEModuleFolder: View {
    let module: String
    let items: [CourseTrackerItem]
    let updater: (CourseTrackerItem, String) -> Void

    @State private var expanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Button {
                expanded.toggle()
            } label: {
                HStack {
                    Image(systemName: expanded ? "folder.fill.badge.minus" : "folder.fill.badge.plus")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.cyan)

                    Text(module)
                        .font(.system(size: 13.5, weight: .black, design: .rounded))
                        .foregroundColor(.white)

                    Spacer()

                    Text(modulePercent)
                        .font(.system(size: 11, weight: .black, design: .rounded))
                        .foregroundColor(.white.opacity(0.65))
                }
                .padding(.vertical, 7)
                .padding(.horizontal, 10)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
            }
            .buttonStyle(.plain)

            if expanded {
                VStack(spacing: 5) {
                    ForEach(items) { item in
                        TrackerDenseRow(item: item, updater: updater)
                            .padding(.leading, 16)
                    }
                }
            }
        }
    }

    var modulePercent: String {
        guard !items.isEmpty else { return "0%" }
        let total = items.reduce(0) { $0 + min(max($1.quality, 0), 3) }
        return "\(Int(Double(total) / Double(items.count * 3) * 100))%"
    }
}




struct DashboardSuggestionCard: View {
    let suggestions: [SmartSuggestion]
    let refresh: () -> Void

    var topSuggestions: [SmartSuggestion] {
        Array(suggestions.sorted { $0.priority > $1.priority }.prefix(6))
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center) {
                    PanelHeader("Reactive Suggested Moves", "Tasks → journal → NB3 → BSCE sweep")

                    Spacer()

                    Button("Refresh Suggestions", action: refresh)
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .frame(height: 34)
                        .glassButton()
                }

                if topSuggestions.isEmpty {
                    Text("No active suggestions. Either everything is clean, or the machine is politely pretending not to judge you.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundColor(.white.opacity(0.55))
                } else {
                    VStack(spacing: 8) {
                        ForEach(topSuggestions) { suggestion in
                            SmartSuggestionRow(suggestion: suggestion)
                        }
                    }
                }
            }
            .padding(18)
        }
    }
}

struct CourseTrackerSuggestionPanel: View {
    let suggestions: [SmartSuggestion]
    let selectedLeaf: String
    let refresh: () -> Void

    var filtered: [SmartSuggestion] {
        let lower = selectedLeaf.lowercased()
        let scoped = suggestions.filter {
            let s = ($0.title + " " + $0.reason + " " + $0.source).lowercased()
            if lower.contains("nb3") {
                return s.contains("nb3") || s.contains("lecture") || s.contains("dla") || s.contains("current module")
            }
            if lower.contains("bsce") {
                return s.contains("bsce") || s.contains("plg") || s.contains("correlate") || s.contains("imcq") || s.contains("esoft")
            }
            return s.contains(lower)
        }

        return Array((scoped.isEmpty ? suggestions : scoped).sorted { $0.priority > $1.priority }.prefix(5))
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    PanelHeader("Suggested Next Move", "Reactive to current folder and tracker state")

                    Spacer()

                    Button("Full Sweep", action: refresh)
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .glassButton()
                }

                VStack(spacing: 7) {
                    ForEach(filtered) { suggestion in
                        SmartSuggestionRow(suggestion: suggestion)
                    }
                }
            }
            .padding(14)
        }
    }
}

struct SmartSuggestionRow: View {
    let suggestion: SmartSuggestion

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            RoundedRectangle(cornerRadius: 4)
                .fill(rowColor)
                .frame(width: 6)
                .padding(.vertical, 3)

            VStack(alignment: .leading, spacing: 2) {
                Text(suggestion.title)
                    .font(.system(size: 12.5, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)

                Text(suggestion.reason)
                    .font(.system(size: 10.5, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.55))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            Text(suggestion.source)
                .font(.system(size: 9.5, weight: .black, design: .rounded))
                .foregroundColor(.white.opacity(0.48))
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.075)))
        }
        .padding(9)
        .background(RoundedRectangle(cornerRadius: 13).fill(Color.white.opacity(0.055)))
    }

    var rowColor: Color {
        switch suggestion.color.lowercased() {
        case "red": return .red
        case "orange": return .orange
        case "green": return .green
        case "purple": return .purple
        case "blue": return .blue
        case "cyan": return .cyan
        default: return .white.opacity(0.45)
        }
    }
}

func generateSmartSuggestions(
    tasks: [TaskItem],
    journal: [JournalEntry],
    nb3: [CourseTrackerItem],
    bsce: [CourseTrackerItem]
) -> [SmartSuggestion] {
    var output: [SmartSuggestion] = []

    let openTasks = tasks.filter { $0.status.lowercased() != "done" }
    let taskText = openTasks.map { $0.title.lowercased() }.joined(separator: " | ")
    let recentJournal = journal.suffix(5).map {
        "\($0.today) \($0.tomorrow) \($0.blockers)"
    }.joined(separator: " ").lowercased()

    func hasTaskMention(_ terms: [String]) -> Bool {
        terms.contains { taskText.contains($0.lowercased()) }
    }

    func hasJournalMention(_ terms: [String]) -> Bool {
        terms.contains { recentJournal.contains($0.lowercased()) }
    }

    // --------------------------------------------------------
    // 1. Tasks first: explicit user intent outranks automation.
    // --------------------------------------------------------
    for task in openTasks.prefix(8) {
        let t = task.title.lowercased()

        if t.contains("bsce") || t.contains("ftm") || t.contains("msk") || t.contains("cpr") || t.contains("er") || t.contains("dm") || t.contains("nb1") || t.contains("nb2") {
            output.append(
                SmartSuggestion(
                    title: "Honor task: \(task.title)",
                    reason: "Task language points away from current NB3 lecture work and toward BSCE/module prep.",
                    source: "Task",
                    priority: 980,
                    color: "purple"
                )
            )
        } else if t.contains("lecture") || t.contains("lectures") || t.range(of: #"l\d+"#, options: .regularExpression) != nil {
            output.append(
                SmartSuggestion(
                    title: "Treat task as NB3 lecture work: \(task.title)",
                    reason: "Lecture shorthand defaults to current course NB3 unless another module is named.",
                    source: "Task → NB3",
                    priority: 960,
                    color: "red"
                )
            )
        } else if t.contains("question") || t.contains("pq") || t.contains("practice") {
            output.append(
                SmartSuggestion(
                    title: "Practice task queued: \(task.title)",
                    reason: "Question work is useful after at least a basic lecture/DLA pass foundation.",
                    source: "Task → Practice",
                    priority: 880,
                    color: "orange"
                )
            )
        } else {
            output.append(
                SmartSuggestion(
                    title: "Open task: \(task.title)",
                    reason: "User-created task gets first-line priority before tracker sweep.",
                    source: "Task",
                    priority: 820,
                    color: "blue"
                )
            )
        }
    }

    // --------------------------------------------------------
    // 2. Journal context: blockers and tomorrow plans.
    // --------------------------------------------------------
    if hasJournalMention(["behind", "stuck", "weak", "blocker", "overwhelmed", "catch up"]) {
        output.append(
            SmartSuggestion(
                title: "Journal shows friction: choose one high-yield recovery block",
                reason: "Recent journal language suggests blockers or delay. Best move: one unfinished lecture/DLA, not a scattered sweep.",
                source: "Journal",
                priority: 900,
                color: "orange"
            )
        )
    }

    if hasJournalMention(["bsce", "comprehensive", "plg", "correlates"]) {
        output.append(
            SmartSuggestion(
                title: "Journal mentions BSCE prep",
                reason: "Recent journal entries point toward comprehensive review. Prioritize PLG or correlates before lower-yield cleanup.",
                source: "Journal → BSCE",
                priority: 890,
                color: "purple"
            )
        )
    }

    // --------------------------------------------------------
    // 3. NB3 sweep.
    // Rules:
    // - Lecture/DLA with 0 passes comes first.
    // - Do not suggest second passes until at least 10 single-pass lecture/DLA items exist.
    // - PQ/practice rises after lecture/DLA base is less disastrous.
    // --------------------------------------------------------
    let nb3Core = nb3.filter {
        ["lecture", "dla"].contains($0.type.lowercased())
    }

    let nb3Zero = nb3Core.filter { $0.quality <= 0 }
    let nb3SinglePass = nb3Core.filter { $0.quality == 1 }

    if let firstZero = nb3Zero.first {
        output.append(
            SmartSuggestion(
                title: "NB3 first pass: \(firstZero.label)",
                reason: "Lecture/DLA has zero passes. First pass outranks second-pass polish right now.",
                source: "NB3",
                priority: 940,
                color: "red"
            )
        )
    }

    if nb3SinglePass.count >= 10, let firstSingle = nb3SinglePass.first {
        output.append(
            SmartSuggestion(
                title: "NB3 second pass: mature \(firstSingle.label)",
                reason: "You have at least 10 single-pass core items. Now second-pass consolidation is justified.",
                source: "NB3",
                priority: 830,
                color: "green"
            )
        )
    } else if !nb3SinglePass.isEmpty {
        output.append(
            SmartSuggestion(
                title: "Delay second passes for now",
                reason: "You have \(nb3SinglePass.count) single-pass lecture/DLA items. Keep expanding first-pass coverage until around 10.",
                source: "NB3 Logic",
                priority: 650,
                color: "blue"
            )
        )
    }

    let nb3PQ = nb3.filter { ["pq", "practice", "esoft", "imcq"].contains($0.type.lowercased()) }
    if nb3Zero.count <= 4, let weakPQ = nb3PQ.first(where: { $0.quality <= 0 }) {
        output.append(
            SmartSuggestion(
                title: "Add question pressure: \(weakPQ.label)",
                reason: "NB3 lecture/DLA first-pass backlog is now small enough that questions become more useful.",
                source: "NB3 PQ",
                priority: 760,
                color: "orange"
            )
        )
    }

    // --------------------------------------------------------
    // 4. BSCE sweep.
    // Logic:
    // - PLG first.
    // - Then correlates / one-pagers / summaries.
    // - Then IMCQ/eSoft.
    // - Avoid duplicate task suggestions if task already mentions it.
    // --------------------------------------------------------
    let bscePLG = bsce.filter { $0.type.lowercased().contains("plg") }
    let bsceCorrelates = bsce.filter {
        let type = $0.type.lowercased()
        let label = $0.label.lowercased()
        return type.contains("correlate") || type.contains("pathway") || label.contains("one pager") || label.contains("summary")
    }

    let bsceQuestions = bsce.filter {
        ["esoft", "imcq", "pq"].contains($0.type.lowercased())
    }

    if let plg = bscePLG.first(where: { $0.quality <= 0 }) {
        let terms = plg.label.lowercased().split(separator: " ").prefix(2).map(String.init)
        if !hasTaskMention(terms) {
            output.append(
                SmartSuggestion(
                    title: "BSCE PLG review: \(plg.label)",
                    reason: "PLG is the highest-yield BSCE prep layer. This has no completed pass yet.",
                    source: "BSCE",
                    priority: 910,
                    color: "purple"
                )
            )
        }
    }

    if let corr = bsceCorrelates.first(where: { $0.quality <= 0 }) {
        output.append(
            SmartSuggestion(
                title: "BSCE correlate/pathway sweep: \(corr.label)",
                reason: "After PLG, correlates and one-pagers convert recognition into explainable structure.",
                source: "BSCE",
                priority: 800,
                color: "cyan"
            )
        )
    }

    if bscePLG.filter({ $0.quality <= 0 }).count <= 2, let q = bsceQuestions.first(where: { $0.quality <= 0 }) {
        output.append(
            SmartSuggestion(
                title: "BSCE question set: \(q.label)",
                reason: "Question review is most useful once PLG coverage is underway.",
                source: "BSCE Q",
                priority: 730,
                color: "orange"
            )
        )
    }

    // --------------------------------------------------------
    // 5. Fallback if everything is oddly quiet.
    // --------------------------------------------------------
    if output.isEmpty {
        output.append(
            SmartSuggestion(
                title: "Run maintenance: one NB3 core pass + one BSCE PLG",
                reason: "No urgent tasks or obvious weak items found. Default to balanced coverage.",
                source: "Fallback",
                priority: 500,
                color: "blue"
            )
        )
    }

    // Deduplicate by title and return priority order.
    var seen = Set<String>()
    return output
        .sorted { $0.priority > $1.priority }
        .filter {
            if seen.contains($0.title) { return false }
            seen.insert($0.title)
            return true
        }
}

struct StepPage: View {
    let stats: Stats
    let open: (String) -> Void
    let ankiMedia: String
    var base: String { FileManager.default.homeDirectoryForCurrentUser.path + "/Medical School" }

    var body: some View {
        VStack(spacing: 20) {
            DashboardCards(stats: stats)

            GlassCard {
                VStack(alignment: .leading, spacing: 16) {
                    PanelHeader("STEP 1 Control", "Boards assets, weak areas, missed questions")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                        ActionTile("STEP 1", "Main folder", "brain.head.profile") { open("\(base)/03 🧠 STEP 1") }
                        ActionTile("Weak Topics", "Attack list", "target") { open("\(base)/03 🧠 STEP 1/Weak Topics") }
                        ActionTile("Missed Qs", "Error log", "xmark.circle") { open("\(base)/03 🧠 STEP 1/Missed Questions") }
                        ActionTile("Practice", "NBME/UWorld", "doc.text.magnifyingglass") { open("\(base)/03 🧠 STEP 1/Practice Exams") }
                        ActionTile("Anki Media", "collection.media", "photo.stack") { open(ankiMedia) }
                    }
                }.padding(18)
            }
        }
    }
}

struct ReportsPage: View {
    let stats: Stats
    let logs: [StudyLog]
    let status: String
    let open: (String) -> Void
    let base: String

    var body: some View {
        VStack(spacing: 20) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 16)], spacing: 16) {
                ReportHero(title: "Inbox Pressure", value: "\(stats.inbox)", caption: "files waiting")
                ReportHero(title: "Needs Review", value: "\(stats.needsReview)", caption: "tagged items")
                ReportHero(title: "Today Output", value: "\(stats.todayMinutes)m", caption: "\(stats.todayCards) cards")
                ReportHero(title: "Journal Entries", value: "\(stats.journalEntries)", caption: "standups saved")
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 16) {
                    PanelHeader("Live System Report", "Raw backend status")
                    Text(status)
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .foregroundColor(.white.opacity(0.72))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)

                    MiniButton("Open Reports Folder") {
                        open("\(base)/09 Admin/Reports")
                    }
                }.padding(18)
            }
        }
    }
}

struct ProductivityPage: View {
    let stats: Stats
    let logs: [StudyLog]
    let logLecture: () -> Void
    let logAnki50: () -> Void
    let logAnki100: () -> Void
    let logAnki150: () -> Void
    let logAnki200: () -> Void
    let logStudy180: () -> Void
    let startNewStudyDay: () -> Void
    let subtractAnki20: () -> Void
    let subtractStudy30: () -> Void
    let startNewDay: () -> Void

    var body: some View {
        VStack(spacing: 20) {

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        PanelHeader("Study Day Controls", "Manual correction layer for clean productivity tracking")

                        HStack(spacing: 10) {
                            Button("Start New Study Day") {
                                startNewStudyDay()
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .frame(height: 36)
                            .glassButton()

                            Button("−20 Anki Cards") {
                                subtractAnki20()
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .frame(height: 36)
                            .glassButton()

                            Button("−30 Minutes") {
                                subtractStudy30()
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .frame(height: 36)
                            .glassButton()

                            Spacer()
                        }

                        Text("Use this only when the calendar/day boundary or manual logs drift. Corrections are written as negative log entries, so the history stays honest.")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundColor(.white.opacity(0.52))
                    }
                    .padding(16)
                }


            GlassCard {
                VStack(alignment: .leading, spacing: 16) {
                    PanelHeader("Productivity Console", "Manual entries now. API integrations later.")
                    RingScore(minutes: max(0, stats.todayMinutes + stats.manualMinutesToday), cards: max(0, stats.todayCards))

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
                        MiniLog("Lecture", "+50m", logLecture)
                        MiniLog("+50 🃜", "+15m", logAnki50)
                        MiniLog("+100 🃚", "+30m", logAnki100)
                        MiniLog("+150 🃖", "+45m", logAnki150)
                        MiniLog("+200 🃁", "+60m", logAnki200)
                        MiniLog("Deep Study", "+180m", logStudy180)
                    }
                }.padding(18)
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 16) {
                    PanelHeader("Calendar Heatmap", "Red <3h or <100 cards • Orange <5h or 150-200 • Green >6h or 250-300 • Blue 👑 >8h or 350-400")
                    Heatmap(logs: logs, openDay: { key in openProductivityDayFile(key) })
                }.padding(18)
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 12) {
                    PanelHeader("Future Integration Slots", "Framework only for now")
                    Text("Anki API / local collection parsing, ScreenTime export parsing, iCal calendar import, manual correction reports, and day usefulness scoring will plug into this page.")
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundColor(.white.opacity(0.62))
                }.padding(18)
            }
        }
    }
}

struct TasksPage: View {
    let tasks: [TaskItem]
    @Binding var newTask: String
    let addTask: () -> Void
    let completeTask: (TaskItem) -> Void

    var openTasks: [TaskItem] { tasks.filter { $0.status != "done" } }

    var body: some View {
        VStack(spacing: 20) {
            GlassCard {
                VStack(alignment: .leading, spacing: 14) {
                    PanelHeader("Task Capture", "Tasks become productivity events when completed")
                    HStack {
                        TextField("Add task", text: $newTask)
                            .textFieldStyle(.plain)
                            .foregroundColor(.white)
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06)))

                        Button("Add", action: addTask)
                            .buttonStyle(.plain)
                            .padding(.horizontal, 16)
                            .frame(height: 40)
                            .glassButton()
                    }
                }.padding(18)
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    PanelHeader("Open Tasks", "\(openTasks.count) active")
                    ForEach(openTasks) { task in
                        HStack {
                            Button(action: { completeTask(task) }) {
                                Image(systemName: "circle")
                            }
                            .buttonStyle(.plain)
                            .foregroundColor(.cyan)

                            Text(task.title)
                                .foregroundColor(.white)
                                .font(.system(size: 13, weight: .semibold, design: .rounded))

                            Spacer()
                        }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.04)))
                    }
                }.padding(18)
            }
        }
    }
}

struct JournalPage: View {
    let entries: [JournalEntry]
    let openJournalFolder: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            GlassCard {
                VStack(alignment: .leading, spacing: 12) {
                    PanelHeader("Journal Archive", "Previous standups")
                    MiniButton("Open Journal Folder", openJournalFolder)
                }.padding(18)
            }

            ForEach(entries.reversed()) { entry in
                GlassCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(entry.date)
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundColor(.cyan)

                        Text("Today: \(entry.today)")
                            .foregroundColor(.white.opacity(0.82))

                        Text("Tomorrow: \(entry.tomorrow)")
                            .foregroundColor(.white.opacity(0.72))

                        Text("Blockers: \(entry.blockers)")
                            .foregroundColor(.white.opacity(0.58))

                        HStack {
                            Text("Energy: \(entry.energy)")
                            Text("Rating: \(entry.rating)")
                        }
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundColor(.white.opacity(0.50))
                    }
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                }
            }
        }
    }
}

struct IntegrationsPage: View {
    let base: String
    let open: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 16)], spacing: 16) {
            ActionTile("Anki Integration", "future API/parser", "rectangle.stack") { open("\(base)/09 Admin/Integrations/Anki") }
            ActionTile("ScreenTime", "future report import", "desktopcomputer") { open("\(base)/09 Admin/Integrations/ScreenTime") }
            ActionTile("Calendar", "future iCal hooks", "calendar") { open("\(base)/09 Admin/Integrations/Calendar") }
            ActionTile("Manual Time", "correct inaccuracies", "slider.horizontal.3") { open("\(base)/09 Admin/Integrations/Manual Time Entries") }
        }
    }
}


struct PromptPage: View {
    let base: String
    let open: (String) -> Void

    @State private var prompts: [PromptItem] = []
    @State private var search = ""
    @State private var selectedCategory = "All"
    @State private var newTitle = ""
    @State private var newCategory = "Prompts"
    @State private var newTags = ""
    @State private var newBody = ""
    @State private var status = "Prompt library ready."

    let categories = [
        "All",
        "Prompts",
        "Code",
        "Anki Formatting",
        "Question Prompts",
        "File Upload Workflows",
        "Templates"
    ]

    var filtered: [PromptItem] {
        prompts.filter { p in
            let categoryMatch = selectedCategory == "All" || p.category == selectedCategory
            let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let searchMatch = query.isEmpty ||
                p.title.lowercased().contains(query) ||
                p.category.lowercased().contains(query) ||
                p.tags.lowercased().contains(query) ||
                p.preview.lowercased().contains(query)
            return categoryMatch && searchMatch
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 14) {
                        PanelHeader("Prompt Library", "Craft-style prompt cards for Anki, code, uploads, and medical workflows")

                        HStack(spacing: 10) {
                            TextField("Search prompts, code, tags, Anki templates…", text: $search)
                                .textFieldStyle(.plain)
                                .padding(12)
                                .background(.white.opacity(0.06))
                                .clipShape(RoundedRectangle(cornerRadius: 16))

                            MiniButton("Refresh") {
                                prompts = loadPrompts(base: base)
                                status = "Reloaded \(prompts.count) prompts."
                            }

                            MiniButton("Open Folder") {
                                open("\(base)/09 Admin/App Data/Prompt Library")
                            }
                        }

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(categories, id: \.self) { cat in
                                    Button {
                                        selectedCategory = cat
                                    } label: {
                                        Text(cat)
                                            .font(.system(size: 12, weight: .semibold))
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 8)
                                            .background(selectedCategory == cat ? .white.opacity(0.18) : .white.opacity(0.07))
                                            .clipShape(Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                        Text(status)
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        PanelHeader("Add Prompt", "Save long prompts, CSS, HTML, card workflows, or question templates")

                        TextField("Title", text: $newTitle)
                            .textFieldStyle(.plain)
                            .padding(10)
                            .background(.white.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 14))

                        HStack {
                            Picker("Category", selection: $newCategory) {
                                ForEach(categories.filter { $0 != "All" }, id: \.self) { cat in
                                    Text(cat).tag(cat)
                                }
                            }
                            .pickerStyle(.menu)

                            TextField("Tags: anki, css, nbme, prompt", text: $newTags)
                                .textFieldStyle(.plain)
                                .padding(10)
                                .background(.white.opacity(0.06))
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                        }

                        TextEditor(text: $newBody)
                            .font(.system(.body, design: .monospaced))
                            .frame(minHeight: 130)
                            .scrollContentBackground(.hidden)
                            .padding(8)
                            .background(.white.opacity(0.055))
                            .clipShape(RoundedRectangle(cornerRadius: 16))

                        HStack {
                            MiniButton("Save Prompt") {
                                savePrompt()
                            }

                            MiniButton("Clear") {
                                newTitle = ""
                                newTags = ""
                                newBody = ""
                                status = "Draft cleared."
                            }
                        }
                    }
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 310), spacing: 14)], spacing: 14) {
                    ForEach(filtered) { prompt in
                        PromptCard(prompt: prompt, open: open) {
                            let pasteboard = NSPasteboard.general
                            pasteboard.clearContents()
                            pasteboard.setString(prompt.bodyText, forType: .string)
                            status = "Copied: \(prompt.title)"
                        }
                    }
                }
            }
            .padding(24)
        }
        .onAppear {
            prompts = loadPrompts(base: base)
            status = "Loaded \(prompts.count) prompts."
        }
    }

    func savePrompt() {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = newBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !body.isEmpty else {
            status = "Add a title and body first."
            return
        }

        let safeTitle = title
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "\n", with: " ")

        let folder = "\(base)/09 Admin/App Data/Prompt Library/\(newCategory)"
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)

        let filePath = "\(folder)/\(safeTitle).md"
        try? body.write(toFile: filePath, atomically: true, encoding: .utf8)

        let id = UUID().uuidString.prefix(8)
        let day = studyDayString(from: Date())
        let relativePath = "09 Admin/App Data/Prompt Library/\(newCategory)/\(safeTitle).md"
        let csv = "\(id),\(title),\(newCategory),\"\(newTags)\",\(day),\(day),\(relativePath)\n"
        append(csv.trimmingCharacters(in: CharacterSet.newlines), to: "\(base)/09 Admin/App Data/prompt_library.csv")

        prompts = loadPrompts(base: base)
        status = "Saved prompt: \(title)"
        newTitle = ""
        newTags = ""
        newBody = ""
    }
}

struct PromptCard: View {
    let prompt: PromptItem
    let open: (String) -> Void
    let copy: () -> Void

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(prompt.title)
                            .font(.headline)

                        Text(prompt.category)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Text("⌘")
                        .font(.title3)
                        .opacity(0.55)
                }

                Text(prompt.preview)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .lineLimit(5)

                if !prompt.tags.isEmpty {
                    Text(prompt.tags)
                        .font(.caption2)
                        .foregroundStyle(.cyan.opacity(0.85))
                        .lineLimit(1)
                }

                HStack {
                    MiniButton("Copy All", copy)

                    MiniButton("Open") {
                        _ = shell("open \"\(prompt.fullPath)\"")
                    }

                    MiniButton("Reveal") {
                        _ = shell("open -R \"\(prompt.fullPath)\"")
                    }
                }
            }
        }
    }
}


struct HubFoldersPage: View {
    let base: String
    let open: (String) -> Void

    var folders: [(String, String, String)] {
        [
            ("Inbox", "00 📥 Inbox - Need Work Look Over", "tray.full"),
            ("01 BPM 500", "10 Courses/Term 1/01 BPM 500", "book"),
            ("01 BPM 501", "10 Courses/Term 1/01 BPM 501", "book.closed"),
            ("02 PPM 500", "10 Courses/Term 2/02 PPM 500", "cross.case"),
            ("02 PPM 501", "10 Courses/Term 2/02 PPM 501", "cross.case.fill"),
            ("02 PPM 502", "10 Courses/Term 2/02 PPM 502", "stethoscope"),
            ("STEP 1", "03 🧠 STEP 1", "brain.head.profile"),
            ("Anki", "04 🃏 Anki Decks", "rectangle.stack"),
            ("Research", "05 🔬 Research", "doc.text.magnifyingglass"),
            ("Summaries", "06 📊 Summaries and Sheets", "doc.text"),
            ("Admin", "09 Admin", "gearshape"),
            ("Archives", "99 🗄️ Archives", "archivebox")
        ]
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 16)], spacing: 16) {
            ForEach(folders, id: \.0) { item in
                ActionTile(item.0, item.1, item.2) {
                    open("\(base)/\(item.1)")
                }
            }
        }
    }
}

// MARK: Components

struct StandupCard: View {
    @Binding var today: String
    @Binding var tomorrow: String
    @Binding var blockers: String
    @Binding var energy: String
    @Binding var rating: String
    let save: () -> Void

    let energies = ["Low", "Medium", "High"]
    let ratings = ["Wasted", "Useful", "Strong", "Elite"]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader("Daily Standup", "What did you do today, and what is tomorrow’s attack?")

                TextField("What did you do today?", text: $today)
                    .standupField()

                TextField("What will you do tomorrow?", text: $tomorrow)
                    .standupField()

                TextField("Blockers / friction", text: $blockers)
                    .standupField()

                HStack {
                    Picker("Energy", selection: $energy) {
                        ForEach(energies, id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)

                    Picker("Rating", selection: $rating) {
                        ForEach(ratings, id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                }

                Button("Save Standup", action: save)
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .frame(height: 42)
                    .glassButton()
            }
            .padding(18)
        }
    }
}


struct PlayerAvatarImage: View {
    let path: String

    var body: some View {
        Group {
            if let image = NSImage(contentsOfFile: path) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text("JD")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .background(Circle().fill(Color.cyan.opacity(0.75)))
            }
        }
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.white.opacity(0.22), lineWidth: 1))
        .shadow(color: .cyan.opacity(0.22), radius: 8, x: 0, y: 0)
    }
}

struct Sidebar: View {
    @Binding var selected: String

    let items = [
        ("Dashboard", "square.grid.2x2"),
        ("Courses", "books.vertical"),
        ("Course Tracker", "checkmark.seal"),
        ("STEP 1", "brain.head.profile"),
        ("Reports", "chart.xyaxis.line"),
        ("Productivity", "calendar"),
        ("Tasks", "checklist"),
        ("Journal", "book.pages"),
        ("Integrations", "point.3.connected.trianglepath.dotted"),
        ("Prompt Library", "text.book.closed"),
        ("Hub Folders", "folder")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                PlayerAvatarImage(path: "/Users/jd/Medical School/09 Admin/App Data/Noctyrium/Player Icons/JD Player Icon.jpg")
                    .frame(width: 36, height: 36)

                VStack(alignment: .leading, spacing: 0) {
                    Text("AXOM")
                        .font(.system(size: 19, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                    Text("v0.03.01")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundColor(.white.opacity(0.42))
                }
            }
            .padding(.top, 22)
            .padding(.horizontal, 18)

            Text("CONTROL SURFACE")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundColor(.white.opacity(0.36))
                .padding(.horizontal, 18)

            VStack(spacing: 7) {
                ForEach(items, id: \.0) { item in
                    SideButton(item.0, item.1, selected == item.0) {
                        selected = item.0
                    }
                }
            }
            .padding(.horizontal, 12)

            Spacer()

            Text("Designed for execution, not decoration.")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundColor(.white.opacity(0.42))
                .padding(.horizontal, 18)
                .padding(.bottom, 22)
        }
        .frame(width: 245)
        .background(Color.black.opacity(0.10))
    }
}

struct TopBar: View {
    let title: String
    let subtitle: String
    let refreshing: Bool
    let refreshAction: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.52))
            }

            Spacer()

            Button(action: refreshAction) {
                HStack(spacing: 8) {
                    Image(systemName: refreshing ? "hourglass" : "arrow.clockwise")
                    Text(refreshing ? "Refreshing" : "Refresh")
                }
                .font(.system(size: 12.5, weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .padding(.horizontal, 14)
                .frame(height: 38)
                .glassButton()
            }
            .buttonStyle(.plain)
        }
    }
}

struct DashboardCards: View {
    let stats: Stats

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 205), spacing: 16)], spacing: 16) {
            StatCard("Inbox", "\(stats.inbox)", "files waiting", "tray.full", trend: stats.inbox > 30 ? "Heavy" : "Clean")
            StatCard("Downloads", "\(stats.downloads)", "loose files", "arrow.down.doc", trend: stats.downloads > 0 ? "Sort" : "Clear")
            StatCard("Anki", "\(max(0, stats.todayCards))", "cards today", "rectangle.stack", trend: "🃜🃚🃖")
            StatCard("Study", "\(max(0, stats.todayMinutes + stats.manualMinutesToday))m", "logged today", "clock", trend: todayGrade(max(0, stats.todayMinutes + stats.manualMinutesToday), max(0, stats.todayCards)))
            StatCard("Tasks", "\(stats.tasksOpen)", "\(stats.tasksDoneToday) done today", "checklist", trend: "Execute")
            StatCard("Journal", "\(stats.journalEntries)", "standups", "book.pages", trend: "Reflect")
        }
    }
}

func todayGrade(_ minutes: Int, _ cards: Int) -> String {
    if minutes >= 480 || cards >= 350 { return "👑 Blue" }
    if minutes >= 360 || cards >= 250 { return "Green" }
    if minutes >= 300 || cards >= 150 { return "Orange" }
    return "Red"
}

struct StatCard: View {
    let title: String
    let value: String
    let note: String
    let icon: String
    let trend: String

    init(_ title: String, _ value: String, _ note: String, _ icon: String, trend: String) {
        self.title = title
        self.value = value
        self.note = note
        self.icon = icon
        self.trend = trend
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: icon).foregroundColor(.cyan)
                    Spacer()
                    Text(trend)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(.green.opacity(0.95))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Color.green.opacity(0.12)))
                }

                Text(value)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundColor(.white)

                Text(title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundColor(.white.opacity(0.84))

                Text(note)
                    .font(.system(size: 11, weight: .regular, design: .rounded))
                    .foregroundColor(.white.opacity(0.44))
            }
            .padding(16)
        }
        .frame(minHeight: 138)
    }
}

struct CourseCard: View {
    let name: String
    let term: String
    let files: Int
    let action: () -> Void

    init(_ name: String, term: String, files: Int, action: @escaping () -> Void) {
        self.name = name
        self.term = term
        self.files = files
        self.action = action
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 13) {
                Text(term)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundColor(.cyan)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.cyan.opacity(0.12)))

                Text(name)
                    .font(.system(size: 21, weight: .bold, design: .rounded))
                    .foregroundColor(.white)

                Text("\(files) files")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.55))

                Button("Open", action: action)
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .glassButton()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
        .frame(minHeight: 175)
    }
}

struct RingScore: View {
    let minutes: Int
    let cards: Int

    var grade: String { todayGrade(minutes, cards) }

    var color: Color {
        if minutes >= 480 || cards >= 350 { return .blue }
        if minutes >= 360 || cards >= 250 { return .green }
        if minutes >= 300 || cards >= 150 { return .orange }
        return .red
    }

    var body: some View {
        HStack(spacing: 18) {
            ZStack {
                Circle().stroke(Color.white.opacity(0.08), lineWidth: 14)
                Circle()
                    .trim(from: 0, to: min(CGFloat(minutes) / 480, 1))
                    .stroke(color.opacity(0.85), style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .rotationEffect(.degrees(-90))

                Text(grade)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            }
            .frame(width: 116, height: 116)

            VStack(alignment: .leading, spacing: 8) {
                Text("\(minutes) minutes")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundColor(.white)

                Text("\(cards) 🃜🃚🃖🃁🂭🂺")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundColor(.white.opacity(0.70))

                Text("Useful day score: \(grade)")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.48))
            }

            Spacer()
        }
    }
}

struct Heatmap: View {
    let logs: [StudyLog]
    var openDay: ((String) -> Void)? = nil

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 14), spacing: 5) {
            ForEach(days(), id: \.self) { day in
                let m = minutes(day)
                let c = cards(day)
                RoundedRectangle(cornerRadius: 4)
                    .fill(color(minutes: m, cards: c))
                    .frame(height: 18)
                    .overlay(Text(m >= 480 || c >= 350 ? "👑" : "").font(.system(size: 8)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color.white.opacity(openDay != nil ? 0.10 : 0), lineWidth: 1)
                    )
                    .help("\(label(day)): \(m) min, \(c) cards" + (openDay != nil ? " — click to open this day" : ""))
                    .contentShape(Rectangle())
                    .onTapGesture { openDay?(key(day)) }
                    .onHover { inside in
                        guard openDay != nil else { return }
                        if inside { NSCursor.pointingHand.push() } else { NSCursor.pop() }
                    }
            }
        }
    }

    func days() -> [Date] {
        let today = Calendar.current.startOfDay(for: Date())
        return (0..<56).compactMap { Calendar.current.date(byAdding: .day, value: -55 + $0, to: today) }
    }

    func minutes(_ date: Date) -> Int {
        max(0, logs.filter { Calendar.current.isDate($0.date, inSameDayAs: date) }.reduce(0) { $0 + $1.minutes })
    }

    func cards(_ date: Date) -> Int {
        max(0, logs.filter { Calendar.current.isDate($0.date, inSameDayAs: date) }.reduce(0) { $0 + $1.cards })
    }

    func color(minutes: Int, cards: Int) -> Color {
        if minutes >= 480 || cards >= 350 { return .blue.opacity(0.88) }
        if minutes >= 360 || cards >= 250 { return .green.opacity(0.78) }
        if minutes >= 300 || (cards >= 150 && cards <= 200) { return .orange.opacity(0.82) }
        if minutes > 0 || cards > 0 { return .red.opacity(0.80) }
        return Color.white.opacity(0.055)
    }

    func label(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        return f.string(from: date)
    }

    /// Calendar-day key (yyyy-MM-dd) matching the productivity day-file naming.
    /// Intentionally not noctyriumDateKey() — these cells are plain calendar days,
    /// so the 4am study-day shift would label past cells one day early.
    func key(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

struct ReportHero: View {
    let title: String
    let value: String
    let caption: String

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundColor(.white.opacity(0.58))

                Text(value)
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundColor(.white)

                Text(caption)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.42))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .frame(minHeight: 150)
    }
}

struct PanelHeader: View {
    let title: String
    let subtitle: String

    init(_ title: String, _ subtitle: String) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundColor(.white)

            Text(subtitle)
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundColor(.white.opacity(0.42))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ActionTile: View {
    let title: String
    let subtitle: String
    let icon: String
    let action: () -> Void
    @State private var hover = false

    init(_ title: String, _ subtitle: String, _ icon: String, _ action: @escaping () -> Void) {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundColor(.cyan)

                Text(title)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(.white)

                Text(subtitle)
                    .font(.system(size: 10.5, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.43))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
            .padding(13)
            .glassButton(hover)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct MiniLog: View {
    let title: String
    let amount: String
    let action: () -> Void

    init(_ title: String, _ amount: String, _ action: @escaping () -> Void) {
        self.title = title
        self.amount = amount
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                Text(amount)
                    .foregroundColor(.green)
            }
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundColor(.white.opacity(0.86))
            .padding(.horizontal, 12)
            .frame(height: 40)
            .glassButton()
        }
        .buttonStyle(.plain)
    }
}

struct MiniButton: View {
    let title: String
    let action: () -> Void

    init(_ title: String, _ action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .glassButton()
    }
}

struct SideButton: View {
    let title: String
    let icon: String
    let active: Bool
    let action: () -> Void

    init(_ title: String, _ icon: String, _ active: Bool, _ action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.active = active
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .frame(width: 20)
                    .foregroundColor(active ? .cyan : .white.opacity(0.68))

                Text(title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundColor(active ? .white : .white.opacity(0.72))

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 13).fill(active ? Color.cyan.opacity(0.15) : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(active ? Color.cyan.opacity(0.22) : Color.clear))
        }
        .buttonStyle(.plain)
    }
}

struct OuterBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.010, green: 0.012, blue: 0.022),
                    Color(red: 0.025, green: 0.030, blue: 0.060),
                    Color(red: 0.020, green: 0.045, blue: 0.080)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Orb(color: .cyan, size: 420, x: -470, y: -330, opacity: 0.22)
            Orb(color: .purple, size: 560, x: 500, y: 300, opacity: 0.15)
            Orb(color: .blue, size: 340, x: 10, y: 390, opacity: 0.11)
        }
    }
}

struct Orb: View {
    let color: Color
    let size: CGFloat
    let x: CGFloat
    let y: CGFloat
    let opacity: Double

    var body: some View {
        Circle()
            .fill(RadialGradient(colors: [color.opacity(opacity), color.opacity(0.035), .clear], center: .center, startRadius: 0, endRadius: size / 2))
            .frame(width: size, height: size)
            .blur(radius: 36)
            .offset(x: x, y: y)
    }
}

struct GlassShell<Content: View>: View {
    let content: Content
    @State private var sweep = false

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(.ultraThinMaterial)
                .background(
                    RoundedRectangle(cornerRadius: 30)
                        .fill(LinearGradient(colors: [Color.white.opacity(0.105), Color.white.opacity(0.045), Color.white.opacity(0.020)], startPoint: .topLeading, endPoint: .bottomTrailing))
                )
                .overlay(RoundedRectangle(cornerRadius: 30).stroke(Color.white.opacity(0.16), lineWidth: 1))
                .shadow(color: .black.opacity(0.56), radius: 46, x: 0, y: 32)
                .overlay(shellLuster.clipShape(RoundedRectangle(cornerRadius: 30)))

            content
        }
        .clipShape(RoundedRectangle(cornerRadius: 30))
        .onAppear { sweep = true }
    }

    var shellLuster: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(LinearGradient(colors: [.clear, Color.white.opacity(0.11), Color.cyan.opacity(0.055), .clear], startPoint: .top, endPoint: .bottom))
                .frame(width: geo.size.width * 0.14, height: geo.size.height * 2.2)
                .rotationEffect(.degrees(17))
                .offset(x: sweep ? geo.size.width * 1.2 : -geo.size.width * 0.4, y: -geo.size.height * 0.5)
                .animation(.easeInOut(duration: 7.8).repeatForever(autoreverses: false), value: sweep)
        }
        .allowsHitTesting(false)
    }
}

struct GlassCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.045))
                    .background(.thinMaterial)
            )
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.085), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 20))
    }
}

extension View {
    func glassButton(_ hover: Bool = false, radius: CGFloat = 14) -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: radius)
                    .fill(LinearGradient(colors: [Color.white.opacity(hover ? 0.135 : 0.060), Color.white.opacity(hover ? 0.055 : 0.026)], startPoint: .topLeading, endPoint: .bottomTrailing))
            )
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Color.white.opacity(hover ? 0.18 : 0.075), lineWidth: 1))
            .shadow(color: Color.cyan.opacity(hover ? 0.13 : 0.02), radius: hover ? 14 : 4)
            .scaleEffect(hover ? 1.012 : 1.0)
            .animation(.easeOut(duration: 0.13), value: hover)
    }

    func standupField() -> some View {
        self
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundColor(.white)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06)))
    }
}

extension DateFormatter {
    static let shortDate: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static var fileSafe: DateFormatter {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH-mm-ss"
        return f
    }
}

// MARK: Helpers


func extractAnkiPasses(_ notes: String) -> Int {
    let parts = notes.components(separatedBy: "|")
    for part in parts {
        let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("anki=") {
            let value = trimmed.replacingOccurrences(of: "anki=", with: "", options: .caseInsensitive)
            return Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        }
    }
    return 0
}

func strippingAnkiToken(_ notes: String) -> String {
    notes.components(separatedBy: "|")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.lowercased().hasPrefix("anki=") }
        .joined(separator: " | ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func writeAnkiPasses(_ notes: String, _ count: Int) -> String {
    let base = strippingAnkiToken(notes)
    if count <= 0 { return base }
    if base.isEmpty { return "anki=\(count)" }
    return "\(base) | anki=\(count)"
}

func preservingAnki(_ notes: String, replacingMainNoteWith main: String) -> String {
    let anki = extractAnkiPasses(notes)
    return writeAnkiPasses(main, anki)
}



func studyDayString(from date: Date = Date()) -> String {
    let shifted = Calendar.current.date(byAdding: .hour, value: -4, to: date) ?? date
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: shifted)
}

func studyDayDate(from date: Date = Date()) -> Date {
    let shifted = Calendar.current.date(byAdding: .hour, value: -4, to: date) ?? date
    return Calendar.current.startOfDay(for: shifted)
}

func append(_ line: String, to path: String) {
    if let data = line.data(using: .utf8), let h = FileHandle(forWritingAtPath: path) {
        h.seekToEndOfFile()
        h.write(data)
        try? h.close()
    }
}

func clean(_ text: String) -> String {
    text
        .replacingOccurrences(of: ",", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func shell(_ command: String) -> String {
    let p = Process()
    let pipe = Pipe()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", command]
    p.standardOutput = pipe
    p.standardError = pipe

    do {
        try p.run()
        p.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    } catch {
        return "Error: \(error.localizedDescription)"
    }
}

func parseStats(_ text: String) -> Stats {
    var d: [String: Int] = [:]
    for line in text.split(separator: "\n") {
        let p = line.split(separator: "=", maxSplits: 1)
        if p.count == 2 { d[String(p[0])] = Int(p[1]) ?? 0 }
    }

    return Stats(
        inbox: d["inbox"] ?? 0,
        downloads: d["downloads"] ?? 0,
        needsReview: d["needs_review"] ?? 0,
        ankiNeeded: d["anki_needed"] ?? 0,
        summaryNeeded: d["summary_needed"] ?? 0,
        weakArea: d["weak_area"] ?? 0,
        todayMinutes: d["today_minutes"] ?? 0,
        todayCards: d["today_cards"] ?? 0,
        manualMinutesToday: d["manual_minutes_today"] ?? 0,
        journalEntries: d["journal_entries"] ?? 0,
        tasksOpen: d["tasks_open"] ?? 0,
        tasksDoneToday: d["tasks_done_today"] ?? 0,
        bpm500: d["bpm500"] ?? 0,
        bpm501: d["bpm501"] ?? 0,
        ppm500: d["ppm500"] ?? 0,
        ppm501: d["ppm501"] ?? 0,
        ppm502: d["ppm502"] ?? 0
    )
}

func loadLogs(_ path: String) -> [StudyLog] {
    guard let text = try? String(contentsOfFile: path) else { return [] }
    let f = ISO8601DateFormatter()

    return text.split(separator: "\n").dropFirst().compactMap {
        let p = $0.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        guard p.count >= 5, let date = f.date(from: p[0]) else { return nil }
        return StudyLog(date: date, type: p[1], minutes: Int(p[2]) ?? 0, cards: Int(p[3]) ?? 0, note: p[4])
    }
}

func loadJournal(_ path: String) -> [JournalEntry] {
    guard let text = try? String(contentsOfFile: path) else { return [] }

    return text.split(separator: "\n").dropFirst().compactMap {
        let p = $0.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        guard p.count >= 6 else { return nil }
        return JournalEntry(date: p[0], today: p[1], tomorrow: p[2], blockers: p[3], energy: p[4], rating: p[5])
    }
}


func loadPrompts(base: String) -> [PromptItem] {
    let path = "\(base)/09 Admin/App Data/prompt_library.csv"
    guard let text = try? String(contentsOfFile: path) else { return [] }

    return text.split(separator: "\n").dropFirst().compactMap { row in
        let parts = parseCSVLine(String(row))
        guard parts.count >= 7 else { return nil }

        return PromptItem(
            id: parts[0],
            title: parts[1],
            category: parts[2],
            tags: parts[3],
            created: parts[4],
            updated: parts[5],
            path: parts[6]
        )
    }
}

func parseCSVLine(_ line: String) -> [String] {
    var result: [String] = []
    var current = ""
    var insideQuotes = false

    for char in line {
        if char == "\"" {
            insideQuotes.toggle()
        } else if char == "," && !insideQuotes {
            result.append(current)
            current = ""
        } else {
            current.append(char)
        }
    }

    result.append(current)
    return result
}


func loadCourseTracker(_ path: String) -> [CourseTrackerItem] {
    guard let text = try? String(contentsOfFile: path) else { return [] }

    return text
        .split(separator: "\n")
        .dropFirst()
        .compactMap { row in
            let p = parseCSVLine(String(row))
            guard p.count >= 9 else { return nil }

            return CourseTrackerItem(
                id: p[0],
                week: p[1],
                type: p[2],
                label: p[3],
                status: p[4],
                quality: Int(p[5]) ?? 0,
                color: p[6],
                notes: p[7],
                updated: p[8]
            )
        }
}



func updateTrackerItem(base: String, id: String, qualityDelta: Int, newColor: String?) {
    let path = "\(base)/09 Admin/App Data/Course Trackers/nb3_tracker.csv"
    guard let raw = try? String(contentsOfFile: path) else { return }

    var output: [String] = []
    let now = studyDayString(from: Date())

    for line in raw.components(separatedBy: .newlines) {
        if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            continue
        }

        if line.hasPrefix("id,") {
            output.append(line)
            continue
        }

        var parts = parseCSVLine(line)
        while parts.count < 9 { parts.append("") }

        if parts[0] == id {
            var q = Int(parts[5]) ?? 0

            if qualityDelta == -999 {
                q = 0
            } else {
                q = max(0, min(5, q + qualityDelta))
            }

            parts[5] = "\(q)"

            if let c = newColor {
                parts[6] = c
                switch c {
                case "red": parts[4] = "needs_work"
                case "orange": parts[4] = "shaky"
                case "green": parts[4] = "completed"
                case "blue": parts[4] = "mastered"
                default: parts[4] = "not_started"
                }
            } else {
                if q == 0 {
                    parts[6] = "gray"
                    parts[4] = "not_started"
                } else if q == 1 {
                    parts[6] = "orange"
                    parts[4] = "pass_1"
                } else if q == 2 || q == 3 {
                    parts[6] = "green"
                    parts[4] = "completed"
                } else {
                    parts[6] = "blue"
                    parts[4] = "mastered"
                }
            }

            parts[8] = now
            output.append(parts.map(csvEscape).joined(separator: ","))
        } else {
            output.append(line)
        }
    }

    try? output.joined(separator: "\n").appending("\n").write(toFile: path, atomically: true, encoding: .utf8)
}

func addTrackerPracticeItem(base: String, type: String, title: String) {
    let path = "\(base)/09 Admin/App Data/Course Trackers/nb3_tracker.csv"
    let safeType = type.replacingOccurrences(of: ",", with: " ")
    let safeTitle = title.replacingOccurrences(of: ",", with: " ")
    let id = "\(safeType.uppercased().replacingOccurrences(of: " ", with: ""))-\(Int(Date().timeIntervalSince1970))"
    let now = studyDayString(from: Date())
    let line = "\(id),Week Custom,\(safeType),\(safeTitle),not_started,0,gray,Manual add,\(now)"
    append(line, to: path)
}

func csvEscape(_ value: String) -> String {
    if value.contains(",") || value.contains("\"") || value.contains("\n") {
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
    return value
}


func loadTasks(_ path: String) -> [TaskItem] {
    guard let text = try? String(contentsOfFile: path) else { return [] }

    return text.split(separator: "\n").dropFirst().compactMap {
        let p = $0.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        guard p.count >= 6 else { return nil }
        return TaskItem(id: p[0], created: p[1], due: p[2], title: p[3], status: p[4], completed: p[5])
    }
}




// MARK: - Smart Suggestion Engine

func buildSmartSuggestions(
    tasks: [TaskItem],
    journal: [JournalEntry],
    nb3Items: [CourseTrackerItem],
    bsceItems: [CourseTrackerItem]
) -> [SmartSuggestion] {
    var result: [SmartSuggestion] = []

    func add(_ title: String, _ reason: String, _ source: String, _ priority: Int, _ color: String) {
        let key = title.lowercased()
        if !result.contains(where: { $0.title.lowercased() == key }) {
            result.append(
                SmartSuggestion(
                    title: title,
                    reason: reason,
                    source: source,
                    priority: priority,
                    color: color
                )
            )
        }
    }

    let openTasks = tasks.filter {
        $0.status.lowercased() != "done" &&
        $0.completed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    let taskText = openTasks.map { $0.title.lowercased() }.joined(separator: " | ")

    for task in openTasks.prefix(10) {
        let lower = task.title.lowercased()

        if lower.contains("bsce") || lower.contains("ftm") || lower.contains("msk") || lower.contains("cpr") || lower.contains("er") || lower.contains("dm") || lower.contains("nb1") || lower.contains("nb2") {
            add(
                "Task-linked BSCE/module move: \(task.title)",
                "Task mentions BSCE or a non-current module. Pull it into the queue before generic work.",
                "Tasks",
                110,
                "purple"
            )
        } else if lower.contains("lecture") || lower.contains("lectures") || lower.contains("nb3") || lower.contains("l60") || lower.contains("l61") || lower.contains("l62") || lower.contains("l63") || lower.contains("l64") {
            add(
                "Task-linked NB3 move: \(task.title)",
                "Task looks like current NB3 lecture work.",
                "Tasks",
                108,
                "cyan"
            )
        } else {
            add(
                "Task queue: \(task.title)",
                "Open task still exists. Clear it, complete it, or reclassify it.",
                "Tasks",
                80,
                "blue"
            )
        }
    }

    for entry in journal.prefix(5) {
        let combined = "\(entry.today) \(entry.tomorrow) \(entry.blockers)".lowercased()

        if combined.contains("bsce") {
            add(
                "Journal carryover: BSCE prep",
                "Recent journal entries mention BSCE.",
                "Journal",
                92,
                "purple"
            )
        }

        if combined.contains("nb3") || combined.contains("lecture") || combined.contains("lectures") {
            add(
                "Journal carryover: NB3 lecture recovery",
                "Recent journal entries mention NB3 or lectures.",
                "Journal",
                90,
                "cyan"
            )
        }

        if combined.contains("behind") || combined.contains("fatigue") || combined.contains("block") {
            add(
                "Stabilize: one core pass + one question block",
                "Journal shows friction. Use a narrow move instead of a heroic plan.",
                "Journal",
                88,
                "orange"
            )
        }
    }

    let nb3Core = nb3Items.filter { ["lecture", "dla"].contains($0.type.lowercased()) }
    let lectures = nb3Items.filter { $0.type.lowercased() == "lecture" }
    let dlas = nb3Items.filter { $0.type.lowercased() == "dla" }
    let firstPassCount = nb3Core.filter { $0.quality >= 1 }.count

    if firstPassCount < 10 {
        if let zeroLecture = lectures.first(where: { $0.quality < 1 }) {
            add(
                "NB3 first pass: \(zeroLecture.label)",
                "You are under 10 core passes. Expand coverage before second-pass polishing.",
                "NB3 Tracker",
                106,
                "red"
            )
        }

        if let zeroDLA = dlas.first(where: { $0.quality < 1 }) {
            add(
                "NB3 DLA first pass: \(zeroDLA.label)",
                "DLAs carry high module weight. Do not let them trail lectures.",
                "NB3 Tracker",
                102,
                "orange"
            )
        }
    } else {
        if let onePassLecture = lectures.first(where: { $0.quality == 1 }) {
            add(
                "NB3 second pass: \(onePassLecture.label)",
                "You have enough first-pass spread. Convert red lectures into young/light green.",
                "NB3 Tracker",
                104,
                "green"
            )
        }

        if let zeroLecture = lectures.first(where: { $0.quality < 1 }) {
            add(
                "NB3 new coverage: \(zeroLecture.label)",
                "Add untouched lectures, then pair with questions.",
                "NB3 Tracker",
                96,
                "red"
            )
        }
    }

    if let pq = nb3Items.first(where: { ["pq", "esoft", "imcq"].contains($0.type.lowercased()) && $0.quality < 1 }) {
        add(
            "NB3 question set: \(pq.label)",
            "Question pressure should follow the active lecture block.",
            "NB3 Tracker",
            86,
            "blue"
        )
    }

    let bscePLG = bsceItems.filter { $0.type.lowercased() == "plg" }
    let bsceCorrelates = bsceItems.filter {
        ["correlates", "pathways", "weak areas"].contains($0.type.lowercased())
    }
    let bsceQuestions = bsceItems.filter {
        ["esoft", "imcq"].contains($0.type.lowercased())
    }

    if let plg = bscePLG.first(where: { $0.quality < 1 }) {
        add(
            "BSCE PLG: \(plg.label)",
            "PLG review is the front door for BSCE prep.",
            "BSCE Tracker",
            100,
            "purple"
        )
    }

    if let corr = bsceCorrelates.first(where: { $0.quality < 1 }) {
        add(
            "BSCE correlates/pathways: \(corr.label)",
            "Correlates and pathways convert module memory into exam-useful structure.",
            "BSCE Tracker",
            94,
            "indigo"
        )
    }

    if let q = bsceQuestions.first(where: { $0.quality < 1 }) {
        add(
            "BSCE question set: \(q.label)",
            "Use questions after PLG/correlates to expose weak explanations.",
            "BSCE Tracker",
            84,
            "blue"
        )
    }

    if taskText.contains("bsce") {
        add(
            "Pair task list with BSCE tracker",
            "Your task list already mentions BSCE. Refresh after doing the task so suggestions stay honest.",
            "Tasks + BSCE",
            97,
            "purple"
        )
    }

    return Array(result.sorted { $0.priority > $1.priority }.prefix(10))
}

