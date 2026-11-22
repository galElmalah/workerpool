import Foundation

// Pure builders: MobileSnapshot (+ "now") → exactly what each widget family draws.
// Widget views stay trivial: no formatting, no date math, no branching on data in SwiftUI.

/// Which day a (possibly cached) snapshot describes at `now`. After local midnight a snapshot from
/// yesterday still knows today's sessions (its `tomorrowSessions`), so widgets roll over offline.
public struct ResolvedDay: Hashable, Sendable {
    public enum Freshness: Hashable, Sendable {
        /// snapshot.today is the local date
        case current
        /// snapshot is from yesterday; today's sessions come from `tomorrowSessions`
        case rolledOver
        /// older than that (or from the future: clock skew) — sessions are unknown
        case stale
    }

    public var date: LocalDate
    public var sessions: [SnapshotSession]
    /// tomorrow's sessions when known (nil after a roll-over or when stale)
    public var nextSessions: [SnapshotSession]?
    public var freshness: Freshness

    public static func resolve(_ s: MobileSnapshot, now: Date, timeZone: TimeZone = .current) -> ResolvedDay {
        let local = Day(now, timeZone: timeZone)
        guard let snapDay = Day(s.today) else {
            return ResolvedDay(date: local.string, sessions: [], nextSessions: nil, freshness: .stale)
        }
        switch snapDay.days(until: local) {
        case 0: return ResolvedDay(date: s.today, sessions: s.todaySessions, nextSessions: s.tomorrowSessions, freshness: .current)
        case 1: return ResolvedDay(date: local.string, sessions: s.tomorrowSessions, nextSessions: nil, freshness: .rolledOver)
        default: return ResolvedDay(date: local.string, sessions: [], nextSessions: nil, freshness: .stale)
        }
    }
}

/// Today widget (small / medium / Lock Screen rectangular + inline).
public struct TodayWidgetModel: Hashable, Sendable {
    /// "Today"
    public var heading: String
    /// "Sat 21 Nov"
    public var dateText: String
    /// today's sessions in day order
    public var lines: [SessionLine]
    /// the session to feature in small/rectangular families: first not-yet-done, else the last one
    public var primary: SessionLine?
    /// shown when `lines` is empty: "Rest day" (or "Open Cadence to refresh" when stale)
    public var emptyText: String
    /// status headline ("Neutral · long ride today"); nil unless the snapshot is current
    public var headline: String?
    /// every session of the day is done or skipped
    public var allDone: Bool
    /// when today is finished (or empty): tomorrow's lines and their label, else empty
    public var upNext: [SessionLine]
    public var upNextLabel: String?
    /// one line for `.accessoryInline`: "Run 1:30 · 09:00", "Rest day", "Done · Ride 2:06"
    public var inlineText: String
    /// "Updated 3 h ago" when the data is older than 2 hours, else nil
    public var staleText: String?
    public var deepLink: DeepLink
}

/// Week progress widget.
public struct WeekWidgetModel: Hashable, Sendable {
    /// "W47 · Run base" (or "W47")
    public var title: String
    /// hero: "7:48"
    public var doneText: String
    /// "of 9:45"
    public var plannedText: String
    /// done / planned time, clamped to 0…1 (1 when nothing was planned but something was done)
    public var fraction: Double
    /// "Load 464 of 539"
    public var loadText: String
    /// "3 of 3 key" (nil when no key sessions are planned)
    public var keyText: String?
    /// Mon…Sun
    public var days: [WeekDayCell]
    /// last weeks' hours for a mini bar chart (oldest → current)
    public var recentWeeks: [WeekBar]
    /// false once `now` is past the snapshot's week (show it dimmed / "last week")
    public var isCurrentWeek: Bool
    public var deepLink: DeepLink
}

public struct WeekDayCell: Hashable, Sendable, Identifiable {
    public var id: LocalDate { date }
    public var date: LocalDate
    /// "M"
    public var initial: String
    public var state: SnapshotDayState
    /// done / planned seconds, 0…1 (1 for done days without a plan)
    public var fraction: Double
    public var isToday: Bool
}

public struct WeekBar: Hashable, Sendable, Identifiable {
    public var id: IsoWeek { isoWeek }
    public var isoWeek: IsoWeek
    /// "W47"
    public var label: String
    public var hours: Double
    /// hours / max hours of the series, 0…1
    public var fraction: Double
    public var isCurrent: Bool
}

/// Form widget (fitness / fatigue / form).
public struct FormWidgetModel: Hashable, Sendable {
    /// "−2" (signed)
    public var formText: String
    /// "Neutral"
    public var zoneText: String
    public var zone: FormZone?
    /// "Form −2 · Neutral"
    public var line: String
    /// "66"
    public var fitnessText: String
    /// "72"
    public var fatigueText: String
    /// "+2.5 a week" (nil when unknown)
    public var rampText: String?
    /// the 42-day series for a chart (fitness is the hero series; form secondary)
    public var series: [SnapshotFitnessPoint]
    /// (min, max) over fitness and fatigue, for a shared y-scale
    public var range: ClosedRange<Double>
    public var deepLink: DeepLink
}

/// Next race countdown.
public struct RaceWidgetModel: Hashable, Sendable {
    public var name: String
    /// "36 days", "Tomorrow", "Today"
    public var countdownText: String
    public var daysTo: Int
    /// "Sun 27 Dec"
    public var dateText: String
    /// "A race"
    public var priorityText: String
    public var deepLink: DeepLink
}

/// When the widget timeline should have entries and when WidgetKit should ask again.
public struct WidgetSchedule: Hashable, Sendable {
    /// render times: now, plus local midnight (roll-over to tomorrow's sessions)
    public var entryDates: [Date]
    /// `TimelineReloadPolicy.after(reloadAfter)`
    public var reloadAfter: Date
}

public enum WidgetModels {
    public static func today(_ s: MobileSnapshot, fetchedAt: Date? = nil, now: Date, timeZone: TimeZone = .current) -> TodayWidgetModel {
        let day = ResolvedDay.resolve(s, now: now, timeZone: timeZone)
        let lines = day.sessions.map { SessionLine(session: $0, units: s.units) }
        let open = lines.filter { $0.state == .planned }
        let allDone = !lines.isEmpty && open.isEmpty
        let primary = open.first ?? lines.last
        let upNext = (allDone || lines.isEmpty) ? (day.nextSessions ?? []).map { SessionLine(session: $0, units: s.units) } : []

        let inline: String
        if day.freshness == .stale {
            inline = "Open Cadence to refresh"
        } else if let p = open.first {
            inline = [p.sport.label + " " + (p.detail.components(separatedBy: Format.dot).first ?? ""), p.time]
                .compactMap { $0 }.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: Format.dot)
        } else if let p = lines.last {
            inline = "Done" + Format.dot + p.sport.label + " " + (p.detail.components(separatedBy: Format.dot).first ?? "")
        } else {
            inline = "Rest day"
        }

        var stale: String?
        let reference = fetchedAt ?? Instant.parse(s.generatedAt)
        if let reference, now.timeIntervalSince(reference) > 2 * 3600 {
            stale = "Updated " + Format.ago(reference, now: now)
        }

        return TodayWidgetModel(
            heading: "Today",
            dateText: Format.dateMedium(day.date),
            lines: lines,
            primary: primary,
            emptyText: day.freshness == .stale ? "Open Cadence to refresh" : "Rest day",
            headline: day.freshness == .current ? s.status.headline : nil,
            allDone: allDone,
            upNext: upNext,
            upNextLabel: upNext.isEmpty ? nil : "Tomorrow",
            inlineText: inline.trimmingCharacters(in: .whitespaces),
            staleText: stale,
            deepLink: primary?.deepLink ?? .today
        )
    }

    public static func week(_ s: MobileSnapshot, now: Date, timeZone: TimeZone = .current) -> WeekWidgetModel {
        let w = s.week
        let local = Day(now, timeZone: timeZone).string
        let fraction: Double = w.plannedSec > 0 ? min(1, max(0, w.doneSec / w.plannedSec)) : (w.doneSec > 0 ? 1 : 0)
        let days = w.days.map { d -> WeekDayCell in
            let f: Double = d.plannedSec > 0 ? min(1, max(0, d.doneSec / d.plannedSec)) : (d.doneSec > 0 ? 1 : 0)
            return WeekDayCell(date: d.date, initial: Format.weekdayInitial(d.date), state: d.state, fraction: f, isToday: d.date == local)
        }
        let maxHours = s.recentWeeks.map(\.hours).max() ?? 0
        let bars = s.recentWeeks.map {
            WeekBar(isoWeek: $0.isoWeek, label: $0.label, hours: $0.hours,
                    fraction: maxHours > 0 ? $0.hours / maxHours : 0, isCurrent: $0.isoWeek == w.isoWeek)
        }
        let isCurrent = w.days.contains { $0.date == local }
        return WeekWidgetModel(
            title: [w.label, w.phase].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: Format.dot),
            doneText: Format.duration(w.doneSec),
            plannedText: "of " + Format.duration(w.plannedSec),
            fraction: fraction,
            loadText: "Load \(Format.load(w.doneLoad)) of \(Format.load(w.plannedLoad))",
            keyText: w.keyPlanned > 0 ? "\(w.keyDone) of \(w.keyPlanned) key" : nil,
            days: days,
            recentWeeks: bars,
            isCurrentWeek: isCurrent,
            deepLink: .week(w.isoWeek)
        )
    }

    public static func form(_ s: MobileSnapshot) -> FormWidgetModel {
        let st = s.status
        let zone = st.formZone
        let zoneText = zone.map { $0.label } ?? ""
        let formText = Format.form(st.form)
        let values = s.fitnessSeries.flatMap { [$0.fitness, $0.fatigue] }
        let lo = values.min() ?? 0
        let hi = values.max() ?? 1
        return FormWidgetModel(
            formText: formText,
            zoneText: zoneText,
            zone: zone,
            line: zoneText.isEmpty ? "Form \(formText)" : "Form \(formText)\(Format.dot)\(zoneText)",
            fitnessText: Format.fitness(st.fitness),
            fatigueText: Format.fitness(st.fatigue),
            rampText: st.rampPerWeek.map { "\(Format.signed($0, decimals: 1)) a week" },
            series: s.fitnessSeries,
            range: lo < hi ? lo...hi : (lo - 1)...(hi + 1),
            deepLink: .trends
        )
    }

    /// nil when there is no upcoming event (or it is already past at `now`).
    public static func race(_ s: MobileSnapshot, now: Date, timeZone: TimeZone = .current) -> RaceWidgetModel? {
        guard let e = s.nextEvent, let eventDay = Day(e.date) else { return nil }
        let daysTo = Day(now, timeZone: timeZone).days(until: eventDay)
        guard daysTo >= 0 else { return nil }
        return RaceWidgetModel(
            name: e.name,
            countdownText: Format.countdown(daysTo: daysTo),
            daysTo: daysTo,
            dateText: Format.dateMedium(e.date),
            priorityText: e.priority.label,
            deepLink: .event(id: e.id)
        )
    }

    /// Entries at `now` and at the next local midnight; ask WidgetKit to reload sooner while a
    /// session is still open today (it may get done and synced), else every two hours, and always
    /// shortly after midnight. Without a snapshot: retry in 15 minutes.
    public static func schedule(for s: MobileSnapshot?, now: Date, timeZone: TimeZone = .current) -> WidgetSchedule {
        let midnight = Day(now, timeZone: timeZone).adding(days: 1).startDate(in: timeZone)
        guard let s else {
            return WidgetSchedule(entryDates: [now], reloadAfter: now.addingTimeInterval(15 * 60))
        }
        let day = ResolvedDay.resolve(s, now: now, timeZone: timeZone)
        let hasOpen = day.sessions.contains { $0.state == .planned }
        let interval: TimeInterval = day.freshness == .stale ? 15 * 60 : (hasOpen ? 30 * 60 : 2 * 3600)
        let reload = min(now.addingTimeInterval(interval), midnight.addingTimeInterval(5 * 60))
        var entries = [now]
        if midnight > now && midnight < reload.addingTimeInterval(1) { entries.append(midnight) }
        return WidgetSchedule(entryDates: entries, reloadAfter: reload)
    }
}
