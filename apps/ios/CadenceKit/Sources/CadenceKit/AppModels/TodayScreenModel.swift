import Foundation

// The Today screen (web: features/today/pages.tsx): a one-sentence status, today's sessions as the
// hero, freshness (Form with its word, Fitness, Fatigue — once each), last night's wellness with the
// morning check-in, the week so far, up next, and "log how it went" for recent unlogged sessions.

public struct FreshnessModel: Hashable, Sendable {
    public var formValue: Double?
    /// "−2"
    public var formText: String
    /// "neutral" (lower case, after the number)
    public var zoneWord: String?
    /// one sentence about the zone
    public var zoneSummary: String?
    public var fitnessValue: Double?
    public var fitnessText: String
    public var fatigueValue: Double?
    public var fatigueText: String
    /// "+2.5 a week"
    public var rampText: String?
    public var accessibilityLabel: String
}

public struct WellnessMetric: Hashable, Sendable, Identifiable {
    public var id: String { label }
    public var label: String
    public var value: Double?
    /// "61", "7:51", "—"
    public var valueText: String
    public var unit: String
    /// "7-day average · in your normal range"
    public var context: String?
}

public struct WellnessModel: Hashable, Sendable {
    public var metrics: [WellnessMetric]
    /// readiness warnings, e.g. "HRV below your normal range · Short sleep"
    public var reasonsText: String?
    /// morning check-in, 1…5 each
    public var feel: Int?
    public var soreness: Int?
    public var feelLabels: [String]
    public var sorenessLabels: [String]
    /// soreness unfolds once feel (or soreness) is in
    public var showsSoreness: Bool
}

/// One small compliance mark in the week strip.
public struct StripMark: Hashable, Sendable {
    public var state: ComplianceState
    public var symbol: String
    public var isDim: Bool
}

public struct StripDay: Hashable, Sendable, Identifiable {
    public var id: LocalDate { date }
    public var date: LocalDate
    /// "Mo"
    public var label: String
    public var isToday: Bool
    /// up to two marks; empty = nothing planned (draw a quiet dot)
    public var marks: [StripMark]
    public var hasKey: Bool
    public var accessibilityLabel: String
}

public struct WeekStripModel: Hashable, Sendable {
    public var isoWeek: IsoWeek
    /// "W47"
    public var weekLabel: String
    public var days: [StripDay]
    public var doneSec: Double
    /// "7:48"
    public var hoursText: String
    /// "of 9:45 planned"
    public var plannedText: String
    /// done / max(planned, done), 0…1
    public var fraction: Double
    /// "Load 464 of 539 · 3 of 3 key"
    public var detailText: String
    public var accessibilityLabel: String
}

public struct UpNextItem: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable {
        case session(Sport)
        case event(EventPriority)
        case nothingPlanned
    }

    public var id: String
    public var kind: Kind
    public var title: String
    /// "Tomorrow · 1:30" / "In 36 days · B race · Sun 27 Dec"
    public var detail: String
    public var isKey: Bool
    /// days to the event (for a ticking number); nil for sessions
    public var daysUntil: Int?
    public var link: DeepLink?
}

public struct PendingLogItem: Hashable, Sendable, Identifiable {
    public var id: String { activityId }
    public var activityId: String
    public var sport: Sport
    public var title: String
    /// "Wednesday"
    public var dayText: String
    public var rpe: Int?
    public var feel: Int?
    public var note: String?
}

public struct TodayScreenModel: Hashable, Sendable {
    public var date: LocalDate
    /// "Saturday 21 November · W47"
    public var eyebrow: String
    /// "Long ride 2h05 — Gavarres loop done. You're ready to train."
    public var statusSentence: String
    /// "Heuristic, not a validated or medical score"
    public var readinessNote: String?
    /// "Travel · Girona" (markers other than rest)
    public var markersText: String?
    public var sessions: [SessionCardModel]
    /// no sessions today; `restIsPlanned` when a rest marker says so
    public var isRestDay: Bool
    public var restIsPlanned: Bool
    public var freshness: FreshnessModel
    public var wellness: WellnessModel
    public var week: WeekStripModel
    public var upNext: [UpNextItem]
    /// unlogged sessions from earlier days (today's are logged on their card)
    public var pendingLogs: [PendingLogItem]
    public var dayNote: String
}

extension TodayScreenModel {
    static let ready: [ReadinessState: String] = [
        .green: "You\u{2019}re ready to train.",
        .amber: "Go by feel today.",
        .red: "Consider easing off today.",
    ]

    static let markerLabels: [DayMarkerType: String] = [
        .sick: "Sick", .injured: "Injured", .travel: "Travel", .vacation: "Vacation", .rest: "Rest", .altitude: "Altitude",
    ]

    /// - Parameter tomorrow: tomorrow's sessions (from a snapshot whose `today` equals `t.date`), nil when unknown.
    public static func build(_ t: TodayResponse, units: UnitSystem, tomorrow: [SnapshotSession]? = nil, now: Date = Date()) -> TodayScreenModel {
        let cards = DayCards.build(workouts: t.workouts, activities: t.activities, date: t.date, units: units)
        let restMarker = t.markers.contains { $0.type == .rest }
        let others = t.markers.filter { $0.type != .rest }
        let markersText = others.isEmpty ? nil : others.map { m -> String in
            let name = markerLabels[m.type] ?? m.type.rawValue.capitalizedFirst
            if let label = m.label, !label.isEmpty { return name + Format.dot + label }
            return name
        }.joined(separator: Format.dot)
        let weekLabel = Day(t.date).map { Format.weekLabel($0.isoWeek) } ?? ""
        let pending = t.pendingLogs.filter { $0.localDate != t.date }.map {
            PendingLogItem(activityId: $0.id, sport: $0.sport, title: $0.title.isEmpty ? $0.sport.label : $0.title,
                           dayText: weekdayName($0.localDate), rpe: $0.rpe, feel: $0.feel, note: $0.postNote)
        }
        return TodayScreenModel(
            date: t.date,
            eyebrow: Format.dateLong(t.date) + (weekLabel.isEmpty ? "" : Format.dot + weekLabel),
            statusSentence: sessionSentence(cards, restDay: restMarker) + " " + (ready[t.wellness.readiness.state] ?? ready[.green]!),
            readinessNote: t.wellness.readiness.label,
            markersText: markersText,
            sessions: cards,
            isRestDay: cards.isEmpty,
            restIsPlanned: restMarker,
            freshness: freshness(t.fitness),
            wellness: wellness(t.wellness),
            week: week(t.week, strip: t.weekStrip),
            upNext: upNext(t, tomorrow: tomorrow, units: units),
            pendingLogs: pending,
            dayNote: t.dayNote?.body ?? ""
        )
    }

    /// "Long ride done." / "Tempo 3×15′ today." / "2 done, Swim still to go." / "Nothing planned today."
    public static func sessionSentence(_ cards: [SessionCardModel], restDay: Bool) -> String {
        if cards.isEmpty { return restDay ? "A planned rest day." : "Nothing planned today." }
        let done = cards.filter { $0.activityId != nil }
        let open = cards.filter { $0.activityId == nil && !$0.isSkipped && $0.state != .missed }
        if open.isEmpty {
            if done.isEmpty { return "Nothing left to do today." }
            return done.count == 1 ? "\(done[0].title) done." : "All \(done.count) sessions done."
        }
        if done.isEmpty { return open.count == 1 ? "\(open[0].title) today." : "\(open.count) sessions today." }
        return "\(done.count) done, \(open.count == 1 ? open[0].title : "\(open.count) sessions") still to go."
    }

    public static func freshness(_ f: FitnessDay) -> FreshnessModel {
        let zone = f.formZone.flatMap { $0 == .unknown ? nil : $0 }
        let formText = Format.form(f.form)
        let fitnessText = Format.fitness(f.fitness)
        let fatigueText = Format.fitness(f.fatigue)
        var summary = zone?.style.summary
        if let pct = f.formPct {
            let extra = "Form is \(Format.signed(pct.rounded()))% of fitness."
            summary = summary.map { $0 + " " + extra } ?? extra
        }
        var spoken = "Form \(formText)"
        if let zone { spoken += ", \(zone.label.lowercased())" }
        spoken += ". Fitness \(fitnessText). Fatigue \(fatigueText)."
        return FreshnessModel(
            formValue: f.form, formText: formText, zoneWord: zone?.label.lowercased(), zoneSummary: summary,
            fitnessValue: f.fitness, fitnessText: fitnessText, fatigueValue: f.fatigue, fatigueText: fatigueText,
            rampText: f.ramp.map { "\(Format.signed($0, decimals: 1)) a week" },
            accessibilityLabel: spoken
        )
    }

    public static func wellness(_ w: TodayWellness) -> WellnessModel {
        let hrvCopy: String
        switch w.hrv.status {
        case .normal?: hrvCopy = "in your normal range"
        case .suppressed?: hrvCopy = "below your normal range"
        case .elevated?: hrvCopy = "above your normal range"
        default: hrvCopy = "building a baseline"
        }
        let rhr = w.restingHr.today ?? w.restingHr.rhr7
        let sleepSec = w.sleep.lastHours.map { $0 * 3600 }
        var sleepContext: String?
        if let mean = w.sleep.mean3Hours {
            sleepContext = "3-night average \(Format.duration(mean * 3600))" + ((w.sleep.short ?? false) ? Format.dot + "short" : "")
        }
        var rhrContext: String?
        if let r60 = w.restingHr.rhr60 {
            rhrContext = "60-day average \(Format.number(r60))" + ((w.restingHr.elevated ?? false) ? Format.dot + "elevated" : "")
        }
        let metrics = [
            WellnessMetric(label: "HRV", value: w.hrv.b7Ms, valueText: Format.number(w.hrv.b7Ms), unit: "ms",
                           context: "7-day average" + Format.dot + hrvCopy),
            WellnessMetric(label: "Resting HR", value: rhr, valueText: Format.number(rhr), unit: "bpm", context: rhrContext),
            WellnessMetric(label: "Sleep", value: sleepSec, valueText: Format.duration(sleepSec), unit: "h", context: sleepContext),
        ]
        let feel = w.today?.feel
        let soreness = w.today?.soreness
        return WellnessModel(
            metrics: metrics,
            reasonsText: w.readiness.reasons.isEmpty ? nil : w.readiness.reasons.joined(separator: Format.dot),
            feel: feel, soreness: soreness,
            feelLabels: LogScales.checkInFeel, sorenessLabels: LogScales.soreness,
            showsSoreness: feel != nil || soreness != nil
        )
    }

    public static func week(_ w: WeekSummary, strip: [WeekStripDay]) -> WeekStripModel {
        let days = strip.map { d -> StripDay in
            let marks = d.states.prefix(2).map { s in StripMark(state: s, symbol: s.statusSymbol, isDim: s == .missed || s == .excused || s == .planned) }
            var spoken = "\(weekdayName(d.date)): \(d.doneCount) done of \(d.plannedCount) planned"
            if d.hasKey { spoken += ", key session" }
            if d.isToday { spoken += ", today" }
            return StripDay(date: d.date, label: String(Format.weekdayShort(d.date).prefix(2)), isToday: d.isToday,
                            marks: Array(marks), hasKey: d.hasKey, accessibilityLabel: spoken)
        }
        let denominator = max(w.plannedSec, w.doneSec, 1)
        var detail = "Load \(Format.load(w.doneLoad)) of \(Format.load(w.plannedLoad))"
        if w.keyPlanned > 0 { detail += Format.dot + "\(w.keyDone) of \(w.keyPlanned) key" }
        let hours = Format.duration(w.doneSec)
        let planned = Format.duration(w.plannedSec)
        return WeekStripModel(
            isoWeek: w.isoWeek, weekLabel: Format.weekLabel(w.isoWeek), days: days, doneSec: w.doneSec,
            hoursText: hours, plannedText: "of \(planned) planned", fraction: min(1, max(0, w.doneSec / denominator)),
            detailText: detail,
            accessibilityLabel: "This week: \(hours) of \(planned) hours. \(detail)."
        )
    }

    static func upNext(_ t: TodayResponse, tomorrow: [SnapshotSession]?, units: UnitSystem) -> [UpNextItem] {
        var items: [UpNextItem] = []
        let tomorrowDate = Day(t.date)?.adding(days: 1).string ?? t.date
        if let tomorrow {
            if tomorrow.isEmpty {
                items.append(UpNextItem(id: "tomorrow-none", kind: .nothingPlanned, title: "Tomorrow" + Format.dot + "nothing planned",
                                        detail: "", isKey: false, daysUntil: nil, link: .calendar(date: tomorrowDate)))
            }
            for s in tomorrow {
                let line = SessionLine(session: s, units: units)
                let duration = (s.durationSec ?? 0) > 0 ? Format.duration(s.durationSec) : nil
                items.append(UpNextItem(id: "s-" + s.id, kind: .session(s.sport), title: line.title,
                                        detail: ["Tomorrow", duration].compactMap { $0 }.joined(separator: Format.dot),
                                        isKey: s.isKey, daysUntil: nil, link: line.deepLink))
            }
        }
        var events: [EventCountdown] = []
        if let e = t.nextEvent { events.append(e) }
        if let a = t.nextAEvent, a.event.id != t.nextEvent?.event.id { events.append(a) }
        for e in events {
            items.append(UpNextItem(id: "e-" + e.event.id, kind: .event(e.event.priority), title: e.event.name,
                                    detail: eventDetail(e), isKey: false, daysUntil: e.daysUntil, link: .event(id: e.event.id)))
        }
        return items
    }

    /// "Race day" / "Tomorrow · A race · Sun 27 Dec" / "In 36 days · B race · Sun 27 Dec"
    public static func eventDetail(_ e: EventCountdown) -> String {
        if e.daysUntil <= 0 { return "Race day" }
        let when = e.daysUntil == 1 ? "Tomorrow" : "In \(e.daysUntil) days"
        return [when, e.event.priority.label, Format.dateMedium(e.event.date)].joined(separator: Format.dot)
    }
}

/// "Wednesday"
func weekdayName(_ date: LocalDate) -> String {
    guard let d = Day(date) else { return Format.placeholder }
    return Format.weekdaysLong[d.isoWeekday - 1]
}
