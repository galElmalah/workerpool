import Foundation

// What Siri / Shortcuts say for the App Intents in Shared/Intents. Pure, so the wording is tested.

/// Speakable forms ("1 hour 30 minutes", "minus 2"); `Format` is for reading, this is for hearing.
public enum SpokenText {
    /// 5400 → "1 hour 30 minutes", 2700 → "45 minutes", 7200 → "2 hours", nil → ""
    public static func duration(_ seconds: Double?) -> String {
        guard let seconds, seconds.isFinite, seconds > 0 else { return "" }
        let totalMin = Int((seconds / 60).rounded())
        let h = totalMin / 60, m = totalMin % 60
        var parts: [String] = []
        if h > 0 { parts.append("\(h) hour\(h == 1 ? "" : "s")") }
        if m > 0 || h == 0 { parts.append("\(m) minute\(m == 1 ? "" : "s")") }
        return parts.joined(separator: " ")
    }

    /// −2 → "minus 2", 4 → "plus 4", 0 → "0"
    public static func signed(_ value: Double?) -> String {
        guard let value else { return "" }
        let n = Int(value.rounded())
        if n == 0 { return "0" }
        return (n < 0 ? "minus " : "plus ") + "\(abs(n))"
    }

    /// "a run", "a ride", "a strength session", "yoga"
    public static func sportNoun(_ sport: Sport) -> String {
        switch sport {
        case .bike: return "a ride"
        case .run: return "a run"
        case .swim: return "a swim"
        case .row: return "a row"
        case .strength: return "a strength session"
        case .hike: return "a hike"
        case .walk: return "a walk"
        case .yoga: return "yoga"
        case .ski: return "a ski"
        case .other, .unknown: return "a session"
        }
    }
}

/// Result of "What's my workout today".
public struct TodaySummary: Hashable, Sendable {
    /// spoken / shown as the Siri dialog
    public var dialog: String
    /// one line for the snippet title: "Today · Sat 21 Nov"
    public var title: String
    /// rows for the snippet (today's sessions, or tomorrow's on a finished / rest day)
    public var rows: [TodayRow]
    /// "Form −2 · Neutral"
    public var formLine: String?
    public var deepLink: DeepLink
}

public enum IntentCopy {
    public static let notConnected = "Open Cadence and connect to your server first."
    public static let offline = "You're offline. Try again when you have a connection."
    public static let quickAddPrompt = "What should I add? For example, run 45m easy tomorrow."

    /// Siri-friendly wording for a failed request.
    public static func message(for error: APIError) -> String {
        switch error {
        case .notConnected, .unauthorized: return notConnected
        case .transport(_, let offline) where offline: return IntentCopy.offline
        case .server(let code, let message, _):
            switch code {
            case "garmin_not_connected": return "Garmin isn't connected. Connect it in Cadence settings."
            case "sync_in_progress": return "A Garmin sync is already running."
            default: return message
            }
        case .throttled(_, let code, _) where code == "garmin_rate_limited":
            return "Garmin asked us to slow down. Try again in a few minutes."
        default: return error.message
        }
    }

    public static func todaySummary(_ s: MobileSnapshot, fetchedAt: Date? = nil, now: Date, timeZone: TimeZone = .current) -> TodaySummary {
        let display = WidgetModels.todayDisplay(s, fetchedAt: fetchedAt, now: now, timeZone: timeZone, maxRows: 4)
        let m = display.model
        let day = ResolvedDay.resolve(s, now: now, timeZone: timeZone)
        var sentences: [String] = []
        if day.freshness == .stale {
            sentences.append("I don't have today's plan yet. Open Cadence to refresh.")
        } else {
            let open = day.sessions.filter { $0.state == .planned }
            let done = day.sessions.filter { $0.state == .done }
            if day.sessions.isEmpty {
                sentences.append("Today is a rest day.")
            } else if open.isEmpty {
                sentences.append(done.isEmpty ? "Nothing left for today." : "You're done for today: " + list(done.map(phrase)) + ".")
            } else if open.count == 1 {
                sentences.append("Today you have " + phrase(open[0]) + ".")
            } else {
                sentences.append("Today you have \(open.count) sessions: " + list(open.map(phrase)) + ".")
            }
            if open.isEmpty, let next = day.nextSessions?.first(where: { $0.state == .planned }) {
                sentences.append("Tomorrow: " + phrase(next) + ".")
            }
            if s.status.form != nil, day.freshness == .current {
                let zone = s.status.formZone.map { ", " + $0.label.lowercased() } ?? ""
                sentences.append("Form is " + SpokenText.signed(s.status.form) + zone + ".")
            }
        }
        return TodaySummary(
            dialog: sentences.joined(separator: " "),
            title: m.heading + Format.dot + m.dateText,
            rows: display.rows,
            formLine: display.formLine,
            deepLink: m.deepLink
        )
    }

    /// "a run, Easy 45, 45 minutes at 07:30"
    static func phrase(_ s: SnapshotSession) -> String {
        var p = SpokenText.sportNoun(s.sport)
        let title = s.title.trimmingCharacters(in: .whitespaces)
        if !title.isEmpty { p += ", " + title }
        let d = SpokenText.duration(s.durationSec)
        if !d.isEmpty { p += ", " + d }
        if let t = s.startTime, s.state == .planned { p += " at " + Format.clock(t) }
        return p
    }

    /// "a, b and c" (items separated by "; " when they contain commas)
    static func list(_ items: [String]) -> String {
        guard items.count > 1 else { return items.first ?? "" }
        let sep = items.contains { $0.contains(",") } ? "; " : ", "
        return items.dropLast().joined(separator: sep) + (sep == "; " ? "; and " : " and ") + items[items.count - 1]
    }

    public static func checkInLogged(feel: Int, synced: Bool) -> String {
        let label = CheckInScale.label(for: feel) ?? "\(feel)"
        return synced ? "Logged: \(label.lowercased()) today." : "Saved \(label.lowercased()) on this phone. It will sync when you're online."
    }

    /// "Added Run · Easy 45 for tomorrow." (+ the first error the parser reported)
    public static func quickAdded(_ r: QuickAddResponse, today: LocalDate) -> String {
        let w = r.workout
        let title = w.title.isEmpty ? w.sport.label : w.title
        let when = Format.relativeDay(w.date, today: today)
        let whenText: String
        switch when {
        case "Today", "Tomorrow", "Yesterday": whenText = "for " + when.lowercased()
        default: whenText = "on " + Format.dateMedium(w.date)
        }
        var text = "Added \(title) \(whenText)."
        if let issue = r.issues.first(where: { $0.severity == "error" }) ?? r.issues.first(where: { $0.severity == "warning" }) {
            text += " Note: " + issue.message
        }
        return text
    }

    public static func synced(_ report: SyncReport) -> String {
        switch report.status {
        case "ok": return report.summary.isEmpty ? "Garmin is up to date." : "Synced: " + report.summary + "."
        case "skipped": return report.reason.isEmpty ? "Nothing to sync right now." : report.reason
        default: return report.error?.message ?? (report.reason.isEmpty ? "The Garmin sync failed." : report.reason)
        }
    }
}
