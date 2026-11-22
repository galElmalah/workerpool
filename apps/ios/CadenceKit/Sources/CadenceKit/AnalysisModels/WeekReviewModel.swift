import Foundation

// The weekly review (`.week(IsoWeek)`): headline sentence → planned vs done (day by day) → by sport
// → key sessions → intensity → week note → previous/next week. Port of web features/week/pages.tsx.

public enum WeekMode: String, Hashable, Sendable {
    case past, current, future
}

public struct WeekDayRowModel: Hashable, Sendable, Identifiable {
    public var id: LocalDate { date }
    public var date: LocalDate
    /// "Mon"
    public var weekday: String
    /// "16 Nov"
    public var dateText: String
    public var isToday: Bool
    public var lines: [SessionLine]
    /// "Sick", "Rest" … from day markers
    public var markerText: String?
    /// "1:45 · 111 / 101" — done time · done load / planned load
    public var totalsText: String
    /// done load / planned load, 0…1 (nil when nothing planned)
    public var fraction: Double?
    public var accessibilityLabel: String
}

public struct SportRowModel: Hashable, Sendable, Identifiable {
    public var id: Sport { sport }
    public var sport: Sport
    /// "3:10"
    public var doneText: String
    /// "of 4:00"
    public var plannedText: String?
    /// "42.5 km"
    public var distanceText: String?
    /// "2 of 3 sessions"
    public var sessionsText: String
    public var fraction: Double?
}

public struct KeySessionRowModel: Hashable, Sendable, Identifiable {
    public var id: String { line.id }
    public var line: SessionLine
    /// "On plan", "Short", "Missed", "Skipped"
    public var statusText: String
    public var tone: AnalysisTone
}

public struct IntensitySplitRow: Hashable, Sendable, Identifiable {
    public var id: String { label }
    /// "This week", "Last week"
    public var label: String
    public var share: IntensityShare
    public var isDim: Bool
}

public struct WeekReviewModel: Hashable, Sendable {
    public var isoWeek: IsoWeek
    public var mode: WeekMode
    /// "Week 47"
    public var title: String
    /// "16–22 Nov 2026"
    public var rangeText: String
    /// "In progress", "Planned", "Done"
    public var statusText: String
    /// "7:48 of 9:45 h done so far, all 3 key sessions done."
    public var headline: String
    public var figures: [KeyFigure]
    /// "Against last week: hours −28% (10:51), load −28% (648), distance −13% (144 km)."
    public var wowLine: String?
    /// "Load rose more than 15%."
    public var cautionText: String?
    public var days: [WeekDayRowModel]
    public var bySport: [SportRowModel]
    public var keySessions: [KeySessionRowModel]
    public var intensity: [IntensitySplitRow]
    /// "Longest: Long ride 2h05 · 2:06", new bests …
    public var highlights: [String]
    public var note: String
    public var previousWeek: IsoWeek
    public var nextWeek: IsoWeek
    /// "Next week: 9:30 h planned, 2 key sessions"
    public var nextText: String?

    public init(review r: WeekReview, today: LocalDate, units: UnitSystem) {
        let s = r.summary
        isoWeek = r.isoWeek
        let start = Day.isoWeekStart(r.isoWeek) ?? Day(s.startDate) ?? Day(today) ?? Day(year: 2000, month: 1, day: 1)!
        let end = start.adding(days: 6)
        let mode: WeekMode = today > end.string ? .past : (today < start.string ? .future : .current)
        self.mode = mode
        title = "Week \(Format.weekLabel(r.isoWeek).dropFirst())"
        rangeText = "\(Format.weekRange(r.isoWeek)) \(end.year)"
        switch mode {
        case .past: statusText = (r.note?.body.isEmpty == false) ? "Reviewed" : "Done"
        case .current: statusText = "In progress"
        case .future: statusText = "Planned"
        }
        headline = WeekReviewModel.headline(s, mode: mode)
        figures = WeekReviewModel.figures(s, previous: r.previous, mode: mode)
        let (wow, caution) = WeekReviewModel.wow(s, previous: r.previous, mode: mode, units: units)
        wowLine = wow
        cautionText = caution
        days = r.days.map { WeekReviewModel.dayRow($0, today: today, units: units) }
        bySport = s.bySport
            .filter { $0.doneSec > 0 || $0.plannedSec > 0 }
            .sorted { max($0.doneSec, $0.plannedSec) > max($1.doneSec, $1.plannedSec) }
            .map { WeekReviewModel.sportRow($0, units: units) }
        keySessions = r.keySessions.map { k in
            let line = SessionLine(workout: k.workout, activity: k.activity, units: units)
            let status: String
            switch k.compliance.state {
            case .onTarget: status = "On plan"
            case .planned: status = "Planned"
            default: status = k.compliance.state.deviationLabel ?? "Done"
            }
            return KeySessionRowModel(line: line, statusText: status, tone: AnalysisTone.of(k.compliance.state))
        }
        var split: [IntensitySplitRow] = []
        let cur = IntensityShare.of(easy: s.intensitySec.easy, moderate: s.intensitySec.moderate, hard: s.intensitySec.hard)
        if !cur.isEmpty { split.append(IntensitySplitRow(label: "This week", share: cur, isDim: false)) }
        if let p = r.previous {
            let prev = IntensityShare.of(easy: p.intensitySec.easy, moderate: p.intensitySec.moderate, hard: p.intensitySec.hard)
            if !prev.isEmpty && !cur.isEmpty { split.append(IntensitySplitRow(label: "Last week", share: prev, isDim: true)) }
        }
        intensity = split
        highlights = WeekReviewModel.highlights(r.highlights, units: units)
        note = r.note?.body ?? ""
        previousWeek = start.adding(days: -7).isoWeek
        nextWeek = start.adding(days: 7).isoWeek
        if let n = r.next.summary, n.plannedSec > 0 {
            var t = "Next week: \(Format.duration(n.plannedSec, style: .clock)) h planned"
            if r.next.keyCount > 0 { t += ", \(r.next.keyCount) key session\(r.next.keyCount == 1 ? "" : "s")" }
            nextText = t + "."
        } else {
            nextText = nil
        }
    }

    static func h(_ sec: Double) -> String { Format.duration(sec, style: .clock) }

    /// One plain sentence answering "how did the week go?".
    public static func headline(_ s: WeekSummary, mode: WeekMode) -> String {
        var keys: String?
        if s.keyPlanned > 0 {
            let n = s.keyDone == s.keyPlanned ? "all \(s.keyPlanned)" : "\(s.keyDone) of \(s.keyPlanned)"
            keys = "\(n) key session\(s.keyPlanned == 1 ? "" : "s")"
        }
        switch mode {
        case .future:
            var t = "\(h(s.plannedSec)) h and \(Format.load(s.plannedLoad)) Load planned"
            if s.keyPlanned > 0 { t += ", with \(s.keyPlanned) key session\(s.keyPlanned == 1 ? "" : "s")" }
            return t + "."
        case .current:
            if s.plannedSec <= 0 && s.doneSec <= 0 { return "Nothing planned or done yet this week." }
            return "\(h(s.doneSec)) of \(h(s.plannedSec)) h done so far\(keys.map { ", \($0) done" } ?? "")."
        case .past:
            if s.plannedSec <= 0 && s.doneSec <= 0 { return "A week off: nothing planned, nothing done." }
            var t = s.plannedSec > 0
                ? "You completed \(Format.percent(s.doneSec / s.plannedSec)) of the planned time"
                : "You trained \(h(s.doneSec)) h"
            if let keys { t += " and \(keys)" }
            if let c = s.compliancePct { t += "; compliance \(Format.number(c))%" }
            return t + "."
        }
    }

    static func figures(_ s: WeekSummary, previous p: WeekSummary?, mode: WeekMode) -> [KeyFigure] {
        let future = mode == .future
        let hours = KeyFigure(id: "hours", label: future ? "Hours planned" : (mode == .current ? "Hours so far" : "Hours"),
                              value: h(future ? s.plannedSec : s.doneSec), unit: "h",
                              context: future ? s.targetHours.map { "target \(h($0 * 3600))" } : (s.plannedSec > 0 ? "of \(h(s.plannedSec)) planned" : nil))
        let load = KeyFigure(id: "load", label: future ? "Load planned" : "Load", value: Format.load(future ? s.plannedLoad : s.doneLoad),
                             context: future ? s.targetLoad.map { "target \(Format.load($0))" } : (s.plannedLoad > 0 ? "of \(Format.load(s.plannedLoad)) planned" : nil))
        let fitness = KeyFigure(id: "fitness", label: mode == .past ? "Fitness at week end" : "Fitness, projected",
                                value: Format.fitness(s.fitness), context: "\(Format.signed(s.fitnessDelta)) this week")
        var formCtx: [String] = []
        if let p { formCtx.append("\(Format.signed(s.form - p.form)) vs last week") }
        if let z = s.formZone, z != .unknown { formCtx.append(z.label) }
        let form = KeyFigure(id: "form", label: "Form at week end", value: Format.form(s.form),
                             context: formCtx.isEmpty ? nil : formCtx.joined(separator: Format.dot))
        return [hours, load, fitness, form]
    }

    static func pct(_ a: Double, _ b: Double) -> Double? { b > 0 ? a / b - 1 : nil }

    static func wow(_ s: WeekSummary, previous p: WeekSummary?, mode: WeekMode, units: UnitSystem) -> (String?, String?) {
        guard mode != .future, let p else { return (nil, nil) }
        func item(_ name: String, _ d: Double?, _ was: String) -> String {
            "\(name) \(d.map { Format.percent($0, signed: true) } ?? Format.placeholder) (\(was))"
        }
        let dist = Format.distance(p.doneDistanceM, sport: .run, units: units)
        let parts = [item("hours", pct(s.doneSec, p.doneSec), h(p.doneSec)),
                     item("load", pct(s.doneLoad, p.doneLoad), Format.load(p.doneLoad)),
                     item("distance", pct(s.doneDistanceM, p.doneDistanceM), dist)]
        let line = "\(mode == .current ? "So far against last week" : "Against last week"): \(parts.joined(separator: ", "))."
        let caution = mode == .past && (pct(s.doneLoad, p.doneLoad) ?? 0) > 0.15 ? "Load rose more than 15%." : nil
        return (line, caution)
    }

    static func markerLabel(_ t: DayMarkerType) -> String? {
        switch t {
        case .rest: return "Rest"
        case .sick: return "Sick"
        case .injured: return "Injured"
        case .travel: return "Travel"
        case .vacation: return "Vacation"
        case .altitude: return "Altitude"
        case .unknown: return nil
        }
    }

    static func dayRow(_ d: WeekReviewDay, today: LocalDate, units: UnitSystem) -> WeekDayRowModel {
        var lines: [SessionLine] = []
        var pairedIds = Set<String>()
        for w in d.workouts {
            let act = w.pairedActivityId.flatMap { id in d.activities.first { $0.id == id } }
            if let act { pairedIds.insert(act.id) }
            lines.append(SessionLine(workout: w, activity: act, units: units))
        }
        for a in d.activities where !pairedIds.contains(a.id) && a.pairedWorkoutId.map({ id in !d.workouts.contains { $0.id == id } }) ?? true {
            lines.append(SessionLine(activity: a, units: units, utcOffsetTime: false))
        }
        let doneSec = d.activities.reduce(0) { $0 + $1.displayDurationSec }
        let doneLoad = d.activities.reduce(0) { $0 + $1.load }
        let plannedLoad = d.workouts.filter { $0.status != .skipped }.reduce(0) { $0 + ($1.plannedLoad ?? 0) }
        var totals: [String] = []
        if doneSec > 0 { totals.append(Format.duration(doneSec, style: .clock)) }
        if plannedLoad > 0 {
            totals.append("\(doneLoad > 0 ? Format.load(doneLoad) : Format.placeholder) / \(Format.load(plannedLoad))")
        } else if doneLoad > 0 {
            totals.append("Load \(Format.load(doneLoad))")
        }
        let marker = d.markers.compactMap { m in m.label ?? markerLabel(m.type) }.first
        let isToday = d.date == today
        var spoken = [Format.dateLong(d.date)]
        if isToday { spoken.append("today") }
        if let marker { spoken.append(marker) }
        spoken += lines.map(\.accessibilityLabel)
        if lines.isEmpty && marker == nil { spoken.append("rest") }
        if plannedLoad > 0 { spoken.append("load \(Format.load(doneLoad)) of \(Format.load(plannedLoad)) planned") }
        return WeekDayRowModel(date: d.date, weekday: Format.weekdayShort(d.date), dateText: Format.dayMonth(d.date), isToday: isToday,
                               lines: lines, markerText: marker, totalsText: totals.joined(separator: Format.dot),
                               fraction: plannedLoad > 0 ? min(1, doneLoad / plannedLoad) : nil,
                               accessibilityLabel: spoken.joined(separator: ", "))
    }

    static func sportRow(_ t: SportTotals, units: UnitSystem) -> SportRowModel {
        let dist: String? = t.sport.style.hasDistance && t.doneDistanceM > 0 ? Format.distance(t.doneDistanceM, sport: t.sport, units: units) : nil
        let sessions = t.plannedCount > 0 ? "\(t.doneCount) of \(t.plannedCount) sessions" : "\(t.doneCount) session\(t.doneCount == 1 ? "" : "s")"
        return SportRowModel(sport: t.sport, doneText: h(t.doneSec), plannedText: t.plannedSec > 0 ? "of \(h(t.plannedSec))" : nil,
                             distanceText: dist, sessionsText: sessions, fraction: t.plannedSec > 0 ? min(1, t.doneSec / t.plannedSec) : nil)
    }

    static func highlights(_ hl: WeekHighlights, units: UnitSystem) -> [String] {
        var out: [String] = []
        if let a = hl.longest {
            out.append("Longest: \(a.title.isEmpty ? a.sport.label : a.title)\(Format.dot)\(Format.duration(a.displayDurationSec, style: .clock))")
        }
        if let a = hl.biggestLoad, a.id != hl.longest?.id {
            out.append("Biggest load: \(a.title.isEmpty ? a.sport.label : a.title)\(Format.dot)\(Format.load(a.load))")
        }
        for b in hl.newBests.prefix(3) {
            if b.kind == "power", let d = b.durationSec {
                out.append("New best: \(ActivityDetailModel.durationLabel(d)) power \(Format.power(b.value))")
            } else if let m = b.distanceM {
                out.append("New best: \(ActivityDetailModel.effortLabel(m, sport: b.sport, units: units)) in \(Format.duration(b.value, style: .hms))")
            }
        }
        return out
    }
}
