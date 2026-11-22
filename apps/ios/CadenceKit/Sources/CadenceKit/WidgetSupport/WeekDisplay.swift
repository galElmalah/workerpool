import Foundation

// Week widget (small / medium / large) and the Lock Screen circular gauge, on top of `WeekWidgetModel`.

/// What the Week widget leads with (widget configuration: "Show hours / load").
public enum WeekWidgetMetric: String, CaseIterable, Sendable {
    case hours, load
}

/// One day of the seven-day strip. Done = solid neutral mark, planned = hollow, missed = slashed and
/// dimmed, rest = a dash; today is marked by weight + a surface step (+ the accent where allowed).
public struct WeekStripCell: Hashable, Sendable, Identifiable {
    public var id: LocalDate { date }
    public var date: LocalDate
    /// "M"
    public var initial: String
    /// SF Symbol for the day's state
    public var symbol: String
    public var state: SnapshotDayState
    /// good (done), warn (partial), critical (missed), neutral (planned / rest)
    public var tone: StatusTone
    public var isToday: Bool
    /// missed and rest days are drawn in fg-4
    public var isDimmed: Bool
    /// "Monday, done"
    public var accessibilityLabel: String
}

public struct WeekProgressModel: Hashable, Sendable {
    public var week: WeekWidgetModel
    public var metric: WeekWidgetMetric
    /// "W47 · Run base"
    public var title: String
    /// small label before the hero ("Load" in load mode, nil for hours)
    public var heroPrefix: String?
    /// "7:48" | "464"
    public var heroText: String
    /// "of 9:45" | "of 539"
    public var ofText: String
    /// progress of the chosen metric, 0…1
    public var fraction: Double
    /// the other metric: "Load 464 of 539" (hours mode) | "7:48 of 9:45" (load mode)
    public var secondaryText: String
    /// "3 of 3 key" (nil without key sessions)
    public var keyText: String?
    /// Lock Screen gauge centre: "7.8" (hours) | "464"
    public var gaugeValueText: String
    /// Lock Screen gauge label: "W47"
    public var gaugeLabel: String
    public var strip: [WeekStripCell]
    public var accessibilityLabel: String
    public var deepLink: DeepLink
}

/// One line of the large Week widget: day + session.
public struct WeekSessionRow: Hashable, Sendable, Identifiable {
    public var id: String
    public var date: LocalDate
    /// "Mon"
    public var dayText: String
    public var isToday: Bool
    public var line: SessionLine
    public var intensity: IntensityClass?
}

public struct WeekSessionsModel: Hashable, Sendable {
    public var rows: [WeekSessionRow]
    /// "+3 more" when sessions were left out
    public var moreText: String?
    /// "Nothing planned this week" when there are no rows
    public var emptyText: String?
    /// true when the rows come from the full week calendar (false: only today/tomorrow were known)
    public var isComplete: Bool
}

extension WidgetModels {
    public static func weekProgress(_ s: MobileSnapshot, metric: WeekWidgetMetric = .hours, now: Date,
                                    timeZone: TimeZone = .current) -> WeekProgressModel {
        let m = week(s, now: now, timeZone: timeZone)
        let w = s.week
        let loadFraction: Double = w.plannedLoad > 0 ? min(1, max(0, w.doneLoad / w.plannedLoad)) : (w.doneLoad > 0 ? 1 : 0)
        let hoursSecondary = "\(Format.duration(w.doneSec)) of \(Format.duration(w.plannedSec))"
        let strip = m.days.map { cell -> WeekStripCell in
            WeekStripCell(date: cell.date, initial: cell.initial, symbol: daySymbol(cell.state), state: cell.state, tone: dayTone(cell.state),
                          isToday: cell.isToday, isDimmed: cell.state == .missed || cell.state == .rest,
                          accessibilityLabel: "\(weekdayLong(cell.date)), \(dayStateWord(cell.state))" + (cell.isToday ? ", today" : ""))
        }
        let a11y: String
        switch metric {
        case .hours:
            a11y = "Week \(weekNumber(w.isoWeek)): \(SpokenText.duration(w.doneSec)) of \(SpokenText.duration(w.plannedSec)) done"
        case .load:
            a11y = "Week \(weekNumber(w.isoWeek)): Load \(Format.load(w.doneLoad)) of \(Format.load(w.plannedLoad))"
        }
        return WeekProgressModel(
            week: m,
            metric: metric,
            title: m.title,
            heroPrefix: metric == .load ? "Load" : nil,
            heroText: metric == .load ? Format.load(w.doneLoad) : m.doneText,
            ofText: metric == .load ? "of " + Format.load(w.plannedLoad) : m.plannedText,
            fraction: metric == .load ? loadFraction : m.fraction,
            secondaryText: metric == .load ? hoursSecondary : m.loadText,
            keyText: m.keyText,
            gaugeValueText: metric == .load ? Format.load(w.doneLoad) : Format.hours(w.doneSec),
            gaugeLabel: w.label,
            strip: strip,
            accessibilityLabel: a11y,
            deepLink: m.deepLink
        )
    }

    /// Sessions of the snapshot's week for the large widget, in day order, at most `limit` rows.
    /// With the week's `CalendarResponse` every session is known; without it (offline before the
    /// first calendar fetch) only today's and tomorrow's from the snapshot are listed.
    /// When there are more than `limit`, the window keeps today and the days after it in view.
    public static func weekSessions(calendar: CalendarResponse?, snapshot s: MobileSnapshot, now: Date,
                                    timeZone: TimeZone = .current, limit: Int = 6) -> WeekSessionsModel {
        let local = Day(now, timeZone: timeZone).string
        let dates = s.week.days.map(\.date)
        var rows: [WeekSessionRow] = []
        var complete = false
        if let cal = calendar, let first = dates.first, let last = dates.last, cal.from <= first, cal.to >= last {
            complete = true
            for date in dates {
                for w in cal.workouts(on: date) {
                    // the paired activity may sit on another date (late uploads), so search them all
                    let activity = w.pairedActivityId.flatMap { id in cal.activities.first { $0.id == id } }
                    rows.append(WeekSessionRow(id: w.id, date: date, dayText: Format.weekdayShort(date), isToday: date == local,
                                               line: SessionLine(workout: w, activity: activity, units: s.units),
                                               intensity: activity?.intensity ?? w.intensity))
                }
                for a in cal.unplannedActivities(on: date) {
                    rows.append(WeekSessionRow(id: a.id, date: date, dayText: Format.weekdayShort(date), isToday: date == local,
                                               line: SessionLine(activity: a, units: s.units), intensity: a.intensity))
                }
            }
        } else {
            let day = ResolvedDay.resolve(s, now: now, timeZone: timeZone)
            if day.freshness != .stale, let d = Day(day.date) {
                let pairs: [(LocalDate, [SnapshotSession])] = [(day.date, day.sessions), (d.adding(days: 1).string, day.nextSessions ?? [])]
                for (date, sessions) in pairs where dates.contains(date) {
                    for session in sessions {
                        rows.append(WeekSessionRow(id: session.id, date: date, dayText: Format.weekdayShort(date), isToday: date == local,
                                                   line: SessionLine(session: session, units: s.units), intensity: session.intensity))
                    }
                }
            }
        }

        let n = max(1, limit)
        var start = 0
        if rows.count > n {
            let firstCurrent = rows.firstIndex { $0.date >= local } ?? rows.count
            start = min(firstCurrent, rows.count - n)
        }
        let shown = Array(rows[start..<min(rows.count, start + n)])
        let hidden = rows.count - shown.count
        return WeekSessionsModel(
            rows: shown,
            moreText: hidden > 0 ? "+\(hidden) more" : nil,
            emptyText: rows.isEmpty ? (complete ? "Nothing planned this week" : "Open Cadence to load the week") : nil,
            isComplete: complete
        )
    }

    /// SF Symbol per day state (all neutral; no colour carries meaning).
    public static func daySymbol(_ state: SnapshotDayState) -> String {
        switch state {
        case .done: return "checkmark.circle.fill"
        case .partial: return "circle.lefthalf.filled"
        case .planned: return "circle"
        case .missed: return "circle.slash"
        case .rest: return "minus"
        case .unknown: return "circle.dashed"
        }
    }

    public static func dayTone(_ state: SnapshotDayState) -> StatusTone {
        switch state {
        case .done: return .good
        case .partial: return .warn
        case .missed: return .critical
        case .planned, .rest, .unknown: return .neutral
        }
    }

    static func dayStateWord(_ state: SnapshotDayState) -> String {
        switch state {
        case .done: return "done"
        case .partial: return "partly done"
        case .planned: return "planned"
        case .missed: return "missed"
        case .rest: return "rest"
        case .unknown: return "unknown"
        }
    }

    static func weekdayLong(_ date: LocalDate) -> String {
        guard let d = Day(date) else { return date }
        return Format.weekdaysLong[d.isoWeekday - 1]
    }

    /// "2026-W47" → "47"
    static func weekNumber(_ isoWeek: IsoWeek) -> String {
        String(Format.weekLabel(isoWeek).dropFirst())
    }
}
