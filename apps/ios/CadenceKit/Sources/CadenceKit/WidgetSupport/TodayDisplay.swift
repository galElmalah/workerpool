import Foundation

// Everything the Today widget families draw, on top of `TodayWidgetModel`:
// small (one session), medium (two rows + the Form line), Lock Screen rectangular (two lines) and
// inline ("Run 45m easy · Form −2").

/// One row of the medium Today widget.
public struct TodayRow: Hashable, Sendable, Identifiable {
    public var id: String
    /// "Tomorrow" above the first of tomorrow's rows, else nil
    public var label: String?
    public var line: SessionLine
    /// for the intensity dot (DESIGN_V2 §8: every session with an intensity shows its zone colour)
    public var intensity: IntensityClass?

    public init(id: String, label: String?, line: SessionLine, intensity: IntensityClass? = nil) {
        self.id = id
        self.label = label
        self.line = line
        self.intensity = intensity
    }
}

public struct TodayWidgetDisplay: Hashable, Sendable {
    public var model: TodayWidgetModel
    /// today's sessions (at most `maxRows`); when today is done or empty, filled up with tomorrow's
    public var rows: [TodayRow]
    /// "+1 more" when today has more sessions than rows
    public var moreText: String?
    /// "Form −2 · Neutral" — the freshness line (nil without fitness history)
    public var formLine: String?
    /// "Tomorrow · Run 1:30" when today is done or a rest day and tomorrow is known
    public var upNextText: String?
    /// Lock Screen rectangular, line 1: the session title, or "Rest day"
    public var rectangularTitle: String
    /// Lock Screen rectangular, line 2: "09:00 · 1:30", "Done · 2:06 · 57.8 km", or what is next
    public var rectangularDetail: String
    /// SF Symbol for the rectangular family (nil on a rest day)
    public var rectangularSymbol: String?
    /// `.accessoryInline`: "Run 45m easy · Form −2", "Done · Ride 2:06 · Form −2", "Rest day · Form −2"
    public var inlineText: String
    /// VoiceOver sentence for the whole widget
    public var accessibilityLabel: String
}

extension WidgetModels {
    public static func todayDisplay(_ s: MobileSnapshot, fetchedAt: Date? = nil, now: Date, timeZone: TimeZone = .current,
                                    maxRows: Int = 2) -> TodayWidgetDisplay {
        let m = today(s, fetchedAt: fetchedAt, now: now, timeZone: timeZone)
        let day = ResolvedDay.resolve(s, now: now, timeZone: timeZone)
        let limit = max(1, maxRows)

        var intensities: [String: IntensityClass] = [:]
        for session in day.sessions + (day.nextSessions ?? []) {
            if let i = session.intensity, intensities[session.id] == nil { intensities[session.id] = i }
        }
        var rows = m.lines.prefix(limit).map { TodayRow(id: "t-" + $0.id, label: nil, line: $0, intensity: intensities[$0.id]) }
        let more = m.lines.count > limit ? "+\(m.lines.count - limit) more" : nil
        if rows.count < limit && !m.upNext.isEmpty {
            for (i, line) in m.upNext.prefix(limit - rows.count).enumerated() {
                rows.append(TodayRow(id: "n-" + line.id, label: i == 0 ? m.upNextLabel : nil, line: line, intensity: intensities[line.id]))
            }
        }

        let formLine: String? = (s.status.form == nil || day.freshness == .stale) ? nil : form(s).line
        let upNextText: String? = m.upNext.first.map { line in
            (m.upNextLabel ?? "Tomorrow") + Format.dot + shortSession(line)
        }

        let rectTitle: String
        let rectDetail: String
        if let p = m.primary {
            rectTitle = p.title
            if p.state == .done {
                rectDetail = joinNonEmpty(["Done", p.detail])
            } else {
                rectDetail = joinNonEmpty([p.time, p.detail])
            }
        } else {
            rectTitle = m.emptyText
            rectDetail = upNextText ?? formLine ?? ""
        }

        let inlineSession: String
        if day.freshness == .stale {
            inlineSession = m.emptyText
        } else if let open = day.sessions.first(where: { $0.state == .planned }) {
            var parts = [open.sport.label]
            if let d = open.durationSec, d > 0 { parts.append(Format.duration(d, style: .compact)) }
            if let i = open.intensity, let word = intensityWord(i) { parts.append(word) }
            inlineSession = parts.joined(separator: " ")
        } else if let last = m.lines.last {
            inlineSession = "Done" + Format.dot + shortSession(last)
        } else {
            inlineSession = m.emptyText
        }
        let inline = day.freshness == .stale || s.status.form == nil
            ? inlineSession
            : inlineSession + Format.dot + "Form " + Format.form(s.status.form)

        var spoken = ["\(m.heading), \(m.dateText)"]
        if m.lines.isEmpty { spoken.append(m.emptyText) }
        spoken.append(contentsOf: m.lines.map(\.accessibilityLabel))
        if let upNextText, m.allDone || m.lines.isEmpty { spoken.append(upNextText) }
        if let formLine { spoken.append(formLine) }

        return TodayWidgetDisplay(
            model: m,
            rows: rows,
            moreText: more,
            formLine: formLine,
            upNextText: upNextText,
            rectangularTitle: rectTitle,
            rectangularDetail: rectDetail,
            rectangularSymbol: m.primary?.symbol,
            inlineText: inline,
            accessibilityLabel: spoken.joined(separator: ". ")
        )
    }

    /// "easy" / "steady" / "hard" / "race" — the one word the inline widget has room for.
    public static func intensityWord(_ intensity: IntensityClass) -> String? {
        if intensity == .race { return "race" }
        switch intensity.style.bucket {
        case .easy: return "easy"
        case .moderate: return "steady"
        case .hard: return "hard"
        case .unknown: return nil
        }
    }

    /// "Run 1:30" — sport and the first part of the detail (the duration when known).
    static func shortSession(_ line: SessionLine) -> String {
        let first = line.detail.components(separatedBy: Format.dot).first ?? ""
        return joinNonEmpty([line.sport.label, first], separator: " ")
    }
}

/// Data-colour status of a mark (DESIGN_V2 §8): always drawn with its icon, never colour alone.
public enum StatusTone: String, Hashable, Sendable {
    case neutral, good, warn, critical
}

extension WidgetModels {
    /// done → good, missed → critical, everything else neutral
    public static func tone(_ state: SessionState) -> StatusTone {
        switch state {
        case .done: return .good
        case .missed: return .critical
        case .planned, .skipped, .unknown: return .neutral
        }
    }

    /// The trailing state mark of a session row.
    public static func stateSymbol(_ state: SessionState) -> String {
        switch state {
        case .done: return "checkmark.circle.fill"
        case .missed: return "xmark.circle"
        case .skipped: return "minus.circle"
        case .planned, .unknown: return "circle"
        }
    }
}

/// Joins the non-nil, non-blank parts with " · " (or `separator`).
func joinNonEmpty(_ parts: [String?], separator: String = Format.dot) -> String {
    parts.compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: separator)
}

/// Copy shared by every widget for the states without data.
public enum WidgetCopy {
    /// no device token on this phone
    public static let connectTitle = "Connect in the app"
    public static let connectMessage = "Open Cadence and connect to your server."
    /// connected, but nothing cached yet (first fetch failed)
    public static let loadingTitle = "Nothing to show yet"
    public static let loadingMessage = "Open Cadence to load your plan."
    /// race widget without an upcoming event
    public static let noRaceTitle = "No race planned"
    public static let noRaceMessage = "Add an event in Cadence."
}
