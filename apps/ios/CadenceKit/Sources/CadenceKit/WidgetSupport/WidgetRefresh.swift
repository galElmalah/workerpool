import Foundation

// Refresh policy for the widget extension (pure; the TimelineProviders only execute it).
//
// - Fetch: the App Group cache is used as is while it is younger than `maxCacheAge`; older → one
//   `GET /api/mobile/snapshot`.
// - Entries: now, the moment the "Updated … ago" line appears, and local midnight (the roll-over to
//   tomorrow's sessions works offline from the same snapshot, see `ResolvedDay`).
// - Reload: every `activeInterval` while a planned session is "around" (an hour before its start
//   until 90 minutes after its planned end: it may get done and synced from Garmin), at the start of
//   the next such window, just after midnight, otherwise every `idleInterval`. That is roughly 25–35
//   reloads a day, inside WidgetKit's budget (≈ 40–70 a day per widget).

/// What a timeline needs from the refresh policy.
public struct WidgetTimelinePlan: Hashable, Sendable {
    /// render times, ascending, the first one is `now`
    public var entryDates: [Date]
    /// `TimelineReloadPolicy.after(reloadAfter)`
    public var reloadAfter: Date

    public init(entryDates: [Date], reloadAfter: Date) {
        self.entryDates = entryDates
        self.reloadAfter = reloadAfter
    }
}

public enum WidgetRefresh {
    /// A cached snapshot younger than this is shown without a network request.
    public static let maxCacheAge: TimeInterval = 15 * 60
    /// Reload interval while a planned session is around.
    public static let activeInterval: TimeInterval = 20 * 60
    /// Reload interval otherwise.
    public static let idleInterval: TimeInterval = 60 * 60
    /// Reload interval without usable data (no snapshot yet, or one that is days old).
    public static let retryInterval: TimeInterval = 15 * 60
    /// Reload interval while signed out (the app reloads every timeline when it connects).
    public static let signedOutInterval: TimeInterval = 6 * 3600
    /// Never ask for a reload sooner than this.
    public static let minimumGap: TimeInterval = 5 * 60
    /// How long before a planned start the "around a session" window opens.
    public static let leadTime: TimeInterval = 60 * 60
    /// How long after the planned end it stays open (Garmin sync lag).
    public static let trailTime: TimeInterval = 90 * 60
    /// Assumed duration of a planned session without one.
    public static let defaultSessionDuration: TimeInterval = 60 * 60
    /// `TodayWidgetModel.staleText` appears after this age.
    public static let staleAfter: TimeInterval = 2 * 3600

    /// True when the cache is missing, older than `maxCacheAge`, or from the future (clock change).
    public static func shouldFetch(fetchedAt: Date?, now: Date) -> Bool {
        guard let fetchedAt else { return true }
        let age = now.timeIntervalSince(fetchedAt)
        return age >= maxCacheAge || age < -60
    }

    /// The timeline for one snapshot. `nil` snapshot: one entry, retry soon.
    public static func plan(for s: MobileSnapshot?, fetchedAt: Date?, now: Date, timeZone: TimeZone = .current) -> WidgetTimelinePlan {
        guard let s else {
            return WidgetTimelinePlan(entryDates: [now], reloadAfter: now.addingTimeInterval(retryInterval))
        }
        let midnight = Day(now, timeZone: timeZone).adding(days: 1).startDate(in: timeZone)
        var entries: [Date] = [now]
        let reference = fetchedAt ?? Instant.parse(s.generatedAt)
        if let reference {
            let staleAt = reference.addingTimeInterval(staleAfter + 60)
            if staleAt > now && staleAt < midnight { entries.append(staleAt) }
        }
        if midnight > now { entries.append(midnight) }

        let day = ResolvedDay.resolve(s, now: now, timeZone: timeZone)
        let reload: Date
        if day.freshness == .stale {
            reload = now.addingTimeInterval(retryInterval)
        } else {
            var candidates: [Date] = [now.addingTimeInterval(idleInterval), midnight.addingTimeInterval(5 * 60)]
            for w in sessionWindows(day, timeZone: timeZone) {
                if w.contains(now) {
                    candidates.append(now.addingTimeInterval(activeInterval))
                } else if w.lowerBound > now {
                    candidates.append(w.lowerBound)
                }
            }
            let earliest = candidates.min() ?? now.addingTimeInterval(idleInterval)
            reload = max(earliest, now.addingTimeInterval(minimumGap))
        }
        return WidgetTimelinePlan(entryDates: entries.sorted(), reloadAfter: reload)
    }

    /// [start − leadTime, end + trailTime) of every still-planned, timed session of the resolved day.
    static func sessionWindows(_ day: ResolvedDay, timeZone: TimeZone) -> [Range<Date>] {
        day.sessions.compactMap { session -> Range<Date>? in
            guard session.state == .planned,
                  let start = WidgetClock.date(on: day.date, at: session.startTime, timeZone: timeZone) else { return nil }
            let end = start.addingTimeInterval(max(session.durationSec ?? defaultSessionDuration, 0))
            return start.addingTimeInterval(-leadTime)..<end.addingTimeInterval(trailTime)
        }
    }
}

/// Smart Stack hint for one entry (`TimelineEntryRelevance(score:duration:)`). Scores are only
/// compared between entries of the same widget: 0 = not relevant now, 1 = most relevant.
public struct WidgetRelevanceHint: Hashable, Sendable {
    public var score: Double
    /// how long the score holds from the entry date (0 = until the next entry)
    public var duration: TimeInterval

    public init(score: Double, duration: TimeInterval) {
        self.score = score
        self.duration = duration
    }
}

/// The widget kinds, for relevance and logging.
public enum CadenceWidgetKind: String, CaseIterable, Sendable {
    case today, week, form, race, checkIn
}

extension WidgetModels {
    /// Smart Stack relevance at `now`:
    /// - today: high from an hour before a planned session until 30 minutes after its start, medium
    ///   in the morning while something is still planned, low otherwise;
    /// - check-in: high in the morning (05:00–11:00) until today's feel is logged;
    /// - race: rises in the final week;
    /// - week: Sunday evening and Monday morning (review / plan the week);
    /// - form: a little in the morning.
    public static func relevance(_ kind: CadenceWidgetKind, snapshot s: MobileSnapshot?, checkInLogged: Bool = false,
                                 now: Date, timeZone: TimeZone = .current) -> WidgetRelevanceHint {
        guard let s else { return WidgetRelevanceHint(score: 0, duration: 0) }
        let minute = WidgetClock.minuteOfDay(now, timeZone)
        let today = Day(now, timeZone: timeZone)
        let midnight = today.adding(days: 1).startDate(in: timeZone)
        let untilMidnight = max(0, midnight.timeIntervalSince(now))
        switch kind {
        case .today:
            let day = ResolvedDay.resolve(s, now: now, timeZone: timeZone)
            for session in day.sessions where session.state == .planned {
                guard let start = WidgetClock.date(on: day.date, at: session.startTime, timeZone: timeZone) else { continue }
                let from = start.addingTimeInterval(-3600)
                let to = start.addingTimeInterval(30 * 60)
                if now >= from && now < to { return WidgetRelevanceHint(score: 1, duration: to.timeIntervalSince(now)) }
            }
            let hasOpen = day.sessions.contains { $0.state == .planned }
            if hasOpen && (300..<720).contains(minute) {
                return WidgetRelevanceHint(score: 0.6, duration: Double(720 - minute) * 60)
            }
            return WidgetRelevanceHint(score: hasOpen ? 0.3 : 0.1, duration: 0)
        case .checkIn:
            if !checkInLogged && (300..<660).contains(minute) {
                return WidgetRelevanceHint(score: 0.9, duration: Double(660 - minute) * 60)
            }
            return WidgetRelevanceHint(score: 0, duration: 0)
        case .race:
            guard let r = race(s, now: now, timeZone: timeZone) else { return WidgetRelevanceHint(score: 0, duration: 0) }
            let score: Double = r.daysTo <= 1 ? 1 : (r.daysTo <= 7 ? 0.7 : 0.1)
            return WidgetRelevanceHint(score: score, duration: untilMidnight)
        case .week:
            let weekday = today.isoWeekday
            if (weekday == 7 && minute >= 17 * 60) || (weekday == 1 && minute < 10 * 60) {
                return WidgetRelevanceHint(score: 0.5, duration: 0)
            }
            return WidgetRelevanceHint(score: 0.1, duration: 0)
        case .form:
            if (360..<540).contains(minute) { return WidgetRelevanceHint(score: 0.3, duration: Double(540 - minute) * 60) }
            return WidgetRelevanceHint(score: 0.1, duration: 0)
        }
    }
}

/// Local wall-clock helpers (Gregorian, explicit zone).
enum WidgetClock {
    static func calendar(_ timeZone: TimeZone) -> Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        return c
    }

    /// Minutes since local midnight, 0…1439.
    static func minuteOfDay(_ date: Date, _ timeZone: TimeZone) -> Int {
        let c = calendar(timeZone).dateComponents([.hour, .minute], from: date)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    /// The instant of "HH:MM" on a local date.
    static func date(on day: LocalDate, at hhmm: String?, timeZone: TimeZone) -> Date? {
        guard let hhmm, let d = Day(day) else { return nil }
        let p = hhmm.split(separator: ":")
        guard p.count >= 2, let h = Int(p[0]), let m = Int(p[1]), (0..<24).contains(h), (0..<60).contains(m) else { return nil }
        return calendar(timeZone).date(from: DateComponents(year: d.year, month: d.month, day: d.day, hour: h, minute: m))
    }
}
