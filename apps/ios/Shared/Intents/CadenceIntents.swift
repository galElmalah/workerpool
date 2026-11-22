import Foundation
import SwiftUI
import AppIntents
import WidgetKit
import CadenceKit

// App Intents shared by the app (Siri, Shortcuts, Spotlight via CadenceShortcuts) and the widget
// extension (interactive check-in buttons, Week widget configuration). Wording lives in CadenceKit
// (`IntentCopy`, tested); these types only move data.
//
// Static metadata uses computed properties returning literals (the Xcode 16 template style), which the
// App Intents metadata extractor reads and which is safe under Swift 6 concurrency checking.

// MARK: - Log how I feel

/// 1 very tired … 5 very fresh (the web app's morning check-in scale).
enum FeelLevel: String, AppEnum {
    case veryTired, tired, normal, fresh, veryFresh

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Feeling" }

    static var caseDisplayRepresentations: [FeelLevel: DisplayRepresentation] {
        [
            .veryTired: DisplayRepresentation(title: "Very tired", subtitle: "1 of 5"),
            .tired: DisplayRepresentation(title: "Tired", subtitle: "2 of 5"),
            .normal: DisplayRepresentation(title: "Normal", subtitle: "3 of 5"),
            .fresh: DisplayRepresentation(title: "Fresh", subtitle: "4 of 5"),
            .veryFresh: DisplayRepresentation(title: "Very fresh", subtitle: "5 of 5"),
        ]
    }

    /// 1…5
    var value: Int {
        switch self {
        case .veryTired: return 1
        case .tired: return 2
        case .normal: return 3
        case .fresh: return 4
        case .veryFresh: return 5
        }
    }

    /// 1…5 (clamped)
    init(value: Int) {
        switch value {
        case ...1: self = .veryTired
        case 2: self = .tired
        case 3: self = .normal
        case 4: self = .fresh
        default: self = .veryFresh
        }
    }
}

/// Morning check-in. Runs in the widget extension when tapped on the Check-in widget (no app launch)
/// and in the app for Siri / Shortcuts. Saves locally first so the widget shows the answer at once;
/// a failed send stays pending and the widget's next timeline reload retries it.
struct LogFeelIntent: AppIntent {
    static var title: LocalizedStringResource { "Log how I feel" }
    static var description: IntentDescription { "Logs this morning's check-in in Cadence." }

    @Parameter(title: "Feeling")
    var feel: FeelLevel

    init() {}

    init(feel: FeelLevel) {
        self.feel = feel
    }

    static var parameterSummary: some ParameterSummary {
        Summary("Log feeling \(\.$feel)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let client = try IntentServices.client()
        let now = Date()
        let date = Day(now).string
        let store = IntentServices.checkIns
        var record = CheckInRecord(date: date, feel: feel.value, savedAt: now, synced: false)
        store.save(record)
        do {
            _ = try await client.checkIn(date: date, WellnessCheckIn(feel: .value(feel.value)))
            record.synced = true
            store.save(record)
            await IntentServices.didWrite(client)
        } catch let e as APIError where e.isOffline {
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            store.clear()
            WidgetCenter.shared.reloadAllTimelines()
            throw CadenceIntentError.from(error)
        }
        return .result(dialog: "\(IntentCopy.checkInLogged(feel: feel.value, synced: record.synced))")
    }
}

// MARK: - What's my workout today

struct TodayWorkoutIntent: AppIntent {
    static var title: LocalizedStringResource { "What's my workout today" }
    static var description: IntentDescription { "Tells you today's planned session and your Form." }

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        let entry = try await IntentServices.latestSnapshot()
        let summary = IntentCopy.todaySummary(entry.snapshot, fetchedAt: entry.fetchedAt, now: Date())
        return .result(dialog: "\(summary.dialog)", view: TodaySnippetView(summary: summary, accent: IntentServices.accent))
    }
}

/// The snippet shown under Siri's answer: today's rows and the Form line.
struct TodaySnippetView: View {
    let summary: TodaySummary
    let accent: Accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(summary.title)
                .font(Theme.Typography.title3)
                .foregroundStyle(c.fg1)
            ForEach(summary.rows) { row in
                HStack(spacing: Theme.Space.s) {
                    Image(systemName: row.line.symbol)
                        .foregroundStyle(DataColor.sport(row.line.sport))
                        .frame(width: 24)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.line.title)
                            .font(Theme.Typography.body)
                            .foregroundStyle(c.fg1)
                            .lineLimit(2)
                        Text(row.label.map { $0 + Format.dot + row.line.detail } ?? row.line.detail)
                            .font(Theme.Typography.numeric)
                            .foregroundStyle(c.fg3)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: WidgetModels.stateSymbol(row.line.state))
                        .foregroundStyle(DataColor.status(row.line.state) ?? c.fg4)
                        .accessibilityHidden(true)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(row.line.accessibilityLabel)
            }
            if let form = summary.formLine {
                Text(form)
                    .font(Theme.Typography.caption)
                    .monospacedDigit()
                    .foregroundStyle(c.fg3)
            }
        }
        .padding(Theme.Space.m)
        .environment(\.cadenceAccent, accent)
    }
}

// MARK: - Add a workout

struct QuickAddWorkoutIntent: AppIntent {
    static var title: LocalizedStringResource { "Add a workout" }
    static var description: IntentDescription {
        IntentDescription("Adds a planned workout from a short phrase, like \"run 45m easy tomorrow\".")
    }

    @Parameter(title: "Workout", requestValueDialog: IntentDialog("What should I add? For example, run 45m easy tomorrow."))
    var text: String

    init() {}

    init(text: String) {
        self.text = text
    }

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$text)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let client = try IntentServices.client()
        let today = Day(Date()).string
        let phrase = QuickAddPhrase.parse(text, today: today)
        guard !phrase.text.isEmpty else {
            throw CadenceIntentError(message: IntentCopy.quickAddPrompt)
        }
        do {
            let response = try await client.quickAdd(date: phrase.date, text: phrase.text)
            await IntentServices.didWrite(client)
            return .result(dialog: "\(IntentCopy.quickAdded(response, today: today))")
        } catch {
            throw CadenceIntentError.from(error)
        }
    }
}

// MARK: - Sync Garmin now

struct SyncGarminIntent: AppIntent {
    static var title: LocalizedStringResource { "Sync Garmin now" }
    static var description: IntentDescription { "Pulls new activities and wellness from Garmin Connect." }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let client = try IntentServices.client()
        do {
            let report = try await client.syncNow()
            await IntentServices.didWrite(client)
            return .result(dialog: "\(IntentCopy.synced(report))")
        } catch {
            throw CadenceIntentError.from(error)
        }
    }
}

// MARK: - Open a screen

enum CadenceDestination: String, AppEnum {
    case today, calendar, trends, quickAdd

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Screen" }

    static var caseDisplayRepresentations: [CadenceDestination: DisplayRepresentation] {
        [
            .today: DisplayRepresentation(title: "Today"),
            .calendar: DisplayRepresentation(title: "Calendar"),
            .trends: DisplayRepresentation(title: "Trends"),
            .quickAdd: DisplayRepresentation(title: "New workout"),
        ]
    }

    var link: DeepLink {
        switch self {
        case .today: return .today
        case .calendar: return .calendar(date: nil)
        case .trends: return .trends
        case .quickAdd: return .newWorkout(date: nil)
        }
    }
}

/// Opens the app on a screen. iOS 17 has no OpenURLIntent, so the app picks the link up from
/// `IntentNavigator.shared` (see IntentSupport.swift).
struct OpenCadenceIntent: AppIntent {
    static var title: LocalizedStringResource { "Open Cadence" }
    static var description: IntentDescription { "Opens Cadence on Today, Calendar, Trends or New workout." }
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Screen", default: .today)
    var destination: CadenceDestination

    init() {}

    init(destination: CadenceDestination) {
        self.destination = destination
    }

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$destination)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentNavigator.shared.open(destination.link)
        return .result()
    }
}

// MARK: - Widget configuration

enum WeekMetricOption: String, AppEnum {
    case hours, load

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Lead with" }

    static var caseDisplayRepresentations: [WeekMetricOption: DisplayRepresentation] {
        [
            .hours: DisplayRepresentation(title: "Hours"),
            .load: DisplayRepresentation(title: "Load"),
        ]
    }

    var metric: WeekWidgetMetric {
        switch self {
        case .hours: return .hours
        case .load: return .load
        }
    }
}

/// Week widget: lead with hours or Load.
struct WeekWidgetConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Week" }
    static var description: IntentDescription { "Choose what the Week widget leads with." }

    @Parameter(title: "Show", default: .hours)
    var metric: WeekMetricOption
}

// MARK: - iOS 18: Control Center

#if compiler(>=6.0)
/// Control Center / Lock Screen control action: opens quick add (cadence://new).
@available(iOS 18.0, *)
struct OpenQuickAddIntent: AppIntent {
    static var title: LocalizedStringResource { "Add a workout in Cadence" }
    static var description: IntentDescription { "Opens quick add in Cadence." }
    static var openAppWhenRun: Bool { true }

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(DeepLink.newWorkout(date: nil).url))
    }
}
#endif
