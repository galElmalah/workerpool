import Foundation

// Calendar tab: a compact month grid (day number + up to three small session marks, today as an
// accent numeral), a one-week strip mode, the week summary line, and the day page.

/// A calendar month ("2026-11").
public struct MonthID: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int

    public init(year: Int, month: Int) {
        // normalise any month offset into 1…12
        let zeroBased = year * 12 + (month - 1)
        self.year = Int((Double(zeroBased) / 12).rounded(.down))
        self.month = zeroBased - self.year * 12 + 1
    }

    public init(_ day: Day) { self.init(year: day.year, month: day.month) }

    /// "2026-11" (or any 'YYYY-MM-DD', whose month is used)
    public init?(_ string: String) {
        let parts = string.split(separator: "-")
        guard parts.count >= 2, parts[0].count == 4, let y = Int(parts[0]), let m = Int(parts[1]), (1...12).contains(m) else { return nil }
        self.init(year: y, month: m)
    }

    /// "2026-11"
    public var string: String { "\(zeroPad(year, 4))-\(zeroPad(month, 2))" }
    public var description: String { string }

    public var firstDay: Day { Day(year: year, month: month, day: 1)! }
    public var lastDay: Day { Day(year: year, month: month, day: Day.daysInMonth(year: year, month: month))! }

    public func adding(months n: Int) -> MonthID { MonthID(year: year, month: month + n) }

    /// "November 2026"
    public var title: String { Format.monthYear(firstDay.string) }

    /// Monday of the first grid week … Sunday of the last.
    public var gridStart: Day { firstDay.weekStart }
    public var gridEnd: Day { lastDay.weekEnd }

    public func contains(_ day: Day) -> Bool { day.year == year && day.month == month }

    public static func < (a: MonthID, b: MonthID) -> Bool { (a.year, a.month) < (b.year, b.month) }
}

/// One small mark in a month cell (a session): done = solid neutral, planned = hollow, missed = dim,
/// skipped = dash. Hard planned sessions are toned from the zone ramp (the only tint).
public struct CalendarMark: Hashable, Sendable, Identifiable {
    public var id: String
    public var sport: Sport
    public var state: SessionState
    public var isKey: Bool
    public var intensity: IntensityClass
    public var showsIntensityDot: Bool
    public var intensityRamp: Int
}

public struct MonthCell: Hashable, Sendable, Identifiable {
    public var id: LocalDate { date }
    public var date: LocalDate
    /// "21"
    public var dayNumber: String
    public var isInMonth: Bool
    public var isToday: Bool
    public var isPast: Bool
    /// at most three
    public var marks: [CalendarMark]
    /// sessions beyond the three marks
    public var overflow: Int
    public var hasEvent: Bool
    public var accessibilityLabel: String
}

public struct MonthWeekRow: Hashable, Sendable, Identifiable {
    public var id: IsoWeek { isoWeek }
    public var isoWeek: IsoWeek
    public var cells: [MonthCell]
}

public struct MonthGridModel: Hashable, Sendable {
    public var month: MonthID
    /// "November 2026"
    public var title: String
    /// "M T W T F S S"
    public var weekdayInitials: [String]
    public var weeks: [MonthWeekRow]
    /// the date range to request (`calendar(from:to:)`)
    public var from: LocalDate
    public var to: LocalDate
}

/// Calendar week summary — three lines (DESIGN_V2 §5): "W47 · Run base", "7:48 of 9:45" + bar,
/// "Load 464 · Form −6". Future weeks show the planned hours.
public struct WeekSummaryLine: Hashable, Sendable {
    public var isoWeek: IsoWeek
    /// "W47 · Run base"
    public var title: String
    /// hero: "7:48" (done) or "10:29" (planned, future week)
    public var hoursText: String
    /// "of 9:45" or "planned"
    public var ofText: String
    /// 0…1; 0 for future weeks
    public var fraction: Double
    public var isFuture: Bool
    /// "Load 464 · Form −6"
    public var detailText: String
    public var accessibilityLabel: String
}

public struct DayEventLine: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    /// "B race · Run · 21.1 km"
    public var detail: String
}

/// The day page (`Route.day`).
public struct DayScreenModel: Hashable, Sendable {
    public var date: LocalDate
    /// "Saturday 21 November"
    public var title: String
    /// "Today", "Tomorrow", "in 3 days", "2 days ago" + " · W47"
    public var subtitle: String
    public var isToday: Bool
    public var isPast: Bool
    public var sessions: [SessionCardModel]
    public var events: [DayEventLine]
    /// "Run base" phase label
    public var phaseText: String?
    /// "Travel · Girona"
    public var markersText: String?
    public var note: String
    /// "Sleep 7:51 · HRV 60 ms · Resting HR 49 bpm"
    public var wellnessText: String?
    public var week: WeekSummaryLine?
}

public enum CalendarModels {
    public static let weekdayInitials = ["M", "T", "W", "T", "F", "S", "S"]

    /// The grid for `month`. `calendar` may be nil (still loading) or cover any range: days outside it
    /// simply have no marks.
    public static func month(_ month: MonthID, calendar: CalendarResponse?, today: LocalDate, units: UnitSystem = .metric) -> MonthGridModel {
        let days = Day.range(month.gridStart, month.gridEnd)
        var weeks: [MonthWeekRow] = []
        var i = 0
        while i < days.count {
            let slice = days[i..<min(i + 7, days.count)]
            let cells = slice.map { cell($0, month: month, calendar: calendar, today: today, units: units) }
            weeks.append(MonthWeekRow(isoWeek: slice.first!.isoWeek, cells: cells))
            i += 7
        }
        return MonthGridModel(month: month, title: month.title, weekdayInitials: weekdayInitials, weeks: weeks,
                              from: month.gridStart.string, to: month.gridEnd.string)
    }

    /// The seven cells of the week containing `date` (week-strip mode).
    public static func week(containing date: LocalDate, calendar: CalendarResponse?, today: LocalDate, units: UnitSystem = .metric) -> MonthWeekRow? {
        guard let d = Day(date) else { return nil }
        let month = MonthID(d)
        let cells = Day.range(d.weekStart, d.weekEnd).map { day -> MonthCell in
            var c = cell(day, month: month, calendar: calendar, today: today, units: units)
            c.isInMonth = true
            return c
        }
        return MonthWeekRow(isoWeek: d.isoWeek, cells: cells)
    }

    static func cell(_ day: Day, month: MonthID, calendar: CalendarResponse?, today: LocalDate, units: UnitSystem) -> MonthCell {
        let date = day.string
        let cards = calendar.map { DayCards.build($0, date: date, units: units) } ?? []
        let marks = cards.map { c in
            CalendarMark(id: c.id, sport: c.sport, state: c.line.state, isKey: c.isKey, intensity: c.intensity,
                         showsIntensityDot: c.showsIntensityDot && c.activityId == nil, intensityRamp: c.intensityRamp)
        }
        let hasEvent = !(calendar?.events(on: date).isEmpty ?? true)
        var spoken = Format.dateLong(date)
        if date == today { spoken = "Today, " + spoken }
        if cards.isEmpty { spoken += ", nothing planned" }
        else {
            let done = cards.filter { $0.line.state == .done }.count
            spoken += ", \(cards.count) session\(cards.count == 1 ? "" : "s")"
            if done > 0 { spoken += ", \(done) done" }
            if cards.contains(where: { $0.isKey }) { spoken += ", key session" }
        }
        if hasEvent { spoken += ", race" }
        return MonthCell(date: date, dayNumber: String(day.day), isInMonth: month.contains(day), isToday: date == today,
                         isPast: date < today, marks: Array(marks.prefix(3)), overflow: max(0, marks.count - 3),
                         hasEvent: hasEvent, accessibilityLabel: spoken)
    }

    public static func weekSummary(_ w: WeekSummary, phase: Phase?, today: LocalDate) -> WeekSummaryLine {
        let isFuture = w.startDate > today
        let title = [Format.weekLabel(w.isoWeek), phase?.label].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: Format.dot)
        let hours = Format.duration(isFuture ? w.plannedSec : w.doneSec)
        let ofText = isFuture ? "planned" : "of " + Format.duration(w.plannedSec)
        let fraction: Double = isFuture ? 0 : (w.plannedSec > 0 ? min(1, max(0, w.doneSec / w.plannedSec)) : (w.doneSec > 0 ? 1 : 0))
        let load = Format.load(isFuture ? w.plannedLoad : w.doneLoad)
        let detail = "Load \(load)" + Format.dot + "Form \(Format.form(w.form))"
        return WeekSummaryLine(isoWeek: w.isoWeek, title: title, hoursText: hours, ofText: ofText, fraction: fraction,
                               isFuture: isFuture, detailText: detail,
                               accessibilityLabel: "\(title). \(hours) \(ofText). \(detail). Opens the week review.")
    }

    /// Week summary for the week containing `date`, when the response covers it.
    public static func weekSummary(containing date: LocalDate, calendar: CalendarResponse, today: LocalDate) -> WeekSummaryLine? {
        guard let w = calendar.week(containing: date) else { return nil }
        return weekSummary(w, phase: calendar.phase(on: w.startDate), today: today)
    }

    public static func day(_ date: LocalDate, calendar: CalendarResponse, today: LocalDate, units: UnitSystem) -> DayScreenModel {
        let week = Day(date).map { Format.weekLabel($0.isoWeek) }
        let relative = Format.relativeDay(date, today: today)
        let markers = calendar.markers(on: date).map { m -> String in
            let name = TodayScreenModel.markerLabels[m.type] ?? m.type.rawValue.capitalizedFirst
            if let label = m.label, !label.isEmpty { return name + Format.dot + label }
            return name
        }
        let events = calendar.events(on: date).map { e -> DayEventLine in
            var parts = [e.priority.label]
            if let s = e.sport, s != .unknown { parts.append(s.label) }
            if let d = e.distanceM, d > 0, let s = e.sport { parts.append(Format.distance(d, sport: s, units: units)) }
            return DayEventLine(id: e.id, name: e.name, detail: parts.joined(separator: Format.dot))
        }
        var wellnessParts: [String] = []
        if let w = calendar.wellness.first(where: { $0.date == date }) {
            if let s = w.sleepSec { wellnessParts.append("Sleep \(Format.duration(s))") }
            if let h = w.hrvMs { wellnessParts.append("HRV \(Format.number(h))\(Format.unitSpace)ms") }
            if let r = w.restingHr { wellnessParts.append("Resting HR \(Format.heartRate(r))") }
        }
        return DayScreenModel(
            date: date,
            title: Format.dateLong(date),
            subtitle: [relative, week].compactMap { $0 }.joined(separator: Format.dot),
            isToday: date == today,
            isPast: date < today,
            sessions: DayCards.build(calendar, date: date, units: units),
            events: events,
            phaseText: calendar.phase(on: date)?.label,
            markersText: markers.isEmpty ? nil : markers.joined(separator: Format.dot),
            note: calendar.dayNote(on: date)?.body ?? "",
            wellnessText: wellnessParts.isEmpty ? nil : wellnessParts.joined(separator: Format.dot),
            week: weekSummary(containing: date, calendar: calendar, today: today)
        )
    }

    /// Short move/copy targets for a workout on `date`: tomorrow, +2 days, next week same day.
    public static func quickMoveTargets(from date: LocalDate) -> [QuickDateTarget] {
        guard let d = Day(date) else { return [] }
        return [d.adding(days: 1), d.adding(days: 2), d.adding(days: 7)].map { QuickDateTarget(date: $0.string, label: Format.dateMedium($0.string)) }
    }
}

/// A one-tap date choice ("Sun 22 Nov") in move / copy menus.
public struct QuickDateTarget: Hashable, Sendable, Identifiable {
    public var id: LocalDate { date }
    public var date: LocalDate
    public var label: String
}
