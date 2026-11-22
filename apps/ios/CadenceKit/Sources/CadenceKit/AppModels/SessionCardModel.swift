import Foundation

// One session as the Today / Day / Calendar screens draw it: a planned workout, a planned workout with
// its completed activity ("paired"), or an unplanned activity. Port of the web `dayCards` +
// `SessionCard` copy (apps/web/src/lib/queries/training.ts, features/today/kit.tsx).

/// What tapping a session opens.
public enum SessionTarget: Hashable, Sendable {
    case workout(id: String)
    case activity(id: String)
}

extension ComplianceState {
    /// Copy for the status part of a session line (web ui/domain/Compliance.tsx LABELS).
    public var statusLabel: String {
        switch self {
        case .planned, .unknown: return "Planned"
        case .onTarget: return "On plan"
        case .partialShort: return "Short"
        case .partialLong: return "Long"
        case .offShort: return "Way short"
        case .offLong: return "Way over"
        case .missed: return "Missed"
        case .excused: return "Skipped"
        case .unplanned: return "Unplanned"
        }
    }

    /// SF Symbol for the state. Done = solid neutral, partial = half, planned = hollow, missed = ×,
    /// skipped = dash. The app tints every one of them neutrally (never accent).
    public var statusSymbol: String {
        switch self {
        case .planned, .unknown: return "circle"
        case .onTarget, .unplanned: return "checkmark.circle.fill"
        case .partialShort, .partialLong, .offShort, .offLong: return "circle.lefthalf.filled"
        case .missed: return "xmark.circle"
        case .excused: return "minus.circle"
        }
    }

    /// Something was completed (pairs and unplanned activities).
    public var isDone: Bool {
        switch self {
        case .onTarget, .partialShort, .partialLong, .offShort, .offLong, .unplanned: return true
        default: return false
        }
    }
}

extension GarminLink {
    /// "On your watch · sent 3 h ago", "Sending to your watch…", "Couldn't send: …"; nil when never sent.
    public func statusText(now: Date) -> String? {
        switch syncState {
        case .synced:
            if let at = Instant.parse(lastPushedAt) { return "On your watch" + Format.dot + "sent " + Format.ago(at, now: now) }
            return "On your watch"
        case .pending: return "Sending to your watch\u{2026}"
        case .error:
            if let error, !error.isEmpty { return "Couldn\u{2019}t send: \(error)" }
            return "Couldn\u{2019}t send to your watch"
        case .none, .unknown: return nil
        }
    }

    public var sendButtonTitle: String { syncState == .synced ? "Send again" : "Send to watch" }
}

extension WorkoutEnvironment {
    /// "Indoor" / "Outdoor"; nil for any.
    public var label: String? {
        switch self {
        case .indoor: return "Indoor"
        case .outdoor: return "Outdoor"
        case .any, .unknown: return nil
        }
    }
}

public struct SessionCardModel: Hashable, Sendable, Identifiable {
    /// workout id for planned/paired sessions, activity id for unplanned ones
    public var id: String
    public var target: SessionTarget
    public var workoutId: String?
    public var activityId: String?
    public var date: LocalDate
    public var sport: Sport
    public var title: String
    public var state: ComplianceState
    /// "On plan", "Skipped · travel"
    public var statusText: String
    public var statusSymbol: String
    /// missed / skipped read quieter
    public var isDimmed: Bool
    /// missed: title struck through
    public var isStruck: Bool
    /// planned start "18:30" (planned sessions only) or the activity's local start
    public var timeText: String?
    /// "2:06"
    public var durationText: String?
    /// "57.8 km" or "52 load"
    public var amountText: String?
    /// "On plan · 2:06 · 57.8 km" (time only for sessions not yet done)
    public var summaryLine: String
    public var isKey: Bool
    public var intensity: IntensityClass
    public var showsIntensityDot: Bool
    public var intensityRamp: Int
    /// 0…1 values for the mini profile (activity effort when done, else the planned profile)
    public var profile: [Double]
    public var profileIsPlan: Bool
    public var preNote: String?
    /// "RPE 4 · Felt okay · “note”" when something is logged
    public var logSummary: String?
    /// a completed activity still missing RPE or feel
    public var needsLog: Bool
    public var rpe: Int?
    public var feel: Int?
    public var postNote: String?
    /// a planned (not done, not skipped, not missed) workout: "Send to watch" applies
    public var canSendToWatch: Bool
    public var garmin: GarminLink?
    /// "Indoor" / "Outdoor"
    public var environmentText: String?
    /// a planned workout without an activity: move / duplicate / skip / delete apply
    public var isEditableWorkout: Bool
    public var isSkipped: Bool
    /// compact row model (calendar lists, up next)
    public var line: SessionLine
    public var accessibilityLabel: String

    /// Builds one card. `workout` and/or `activity` must be set.
    public init(workout w: PlannedWorkout?, activity a: Activity?, units: UnitSystem) {
        let sport = a?.sport ?? w?.sport ?? .unknown
        let rawTitle = w?.title ?? a?.title ?? ""
        let title = rawTitle.isEmpty ? sport.label : rawTitle
        let state: ComplianceState
        if let a {
            state = (a.compliance ?? w?.compliance)?.state ?? (w == nil ? .unplanned : .onTarget)
        } else if let w {
            state = w.status == .skipped ? .excused : (w.compliance?.state ?? .planned)
        } else {
            state = .planned
        }
        var status = state.statusLabel
        if state == .excused, let reason = w?.skipReason, reason != .unknown { status += Format.dot + reason.label.lowercased() }

        let time: String?
        if let a { time = SessionLine.localTime(startedAt: a.startedAt, utcOffsetMin: a.utcOffsetMin) }
        else { time = w?.startTime.map { Format.clock($0) } }
        let duration = a.map { $0.displayDurationSec } ?? w?.plannedDurationSec
        let distance = a != nil ? a?.distanceM : w?.plannedDistanceM
        let load = a != nil ? a?.load : w?.plannedLoad
        let durationText = (duration ?? 0) > 0 ? Format.duration(duration, style: .clock) : nil
        let amountText: String?
        if let d = distance, d > 0 { amountText = Format.distance(d, sport: sport, units: units) }
        else if let l = load, l > 0 { amountText = Format.load(l) + Format.unitSpace + "load" }
        else { amountText = nil }
        let intensity = a?.intensity ?? w?.intensity ?? .endurance
        let style = intensity.style
        let isKey = (w?.isKey ?? false) || (a?.isKey ?? false)

        self.id = w?.id ?? a?.id ?? ""
        self.target = a.map { SessionTarget.activity(id: $0.id) } ?? .workout(id: w?.id ?? "")
        self.workoutId = w?.id
        self.activityId = a?.id
        self.date = w?.date ?? a?.localDate ?? ""
        self.sport = sport
        self.title = title
        self.state = state
        self.statusText = status
        self.statusSymbol = state.statusSymbol
        self.isDimmed = state == .missed || state == .excused
        self.isStruck = state == .missed
        self.timeText = time
        self.durationText = durationText
        self.amountText = amountText
        self.summaryLine = [status, a == nil ? time : nil, durationText, amountText].compactMap { $0 }.joined(separator: Format.dot)
        self.isKey = isKey
        self.intensity = intensity
        self.showsIntensityDot = style.showsDot
        self.intensityRamp = style.rampIndex
        let profile = a?.sparkline ?? w?.sparkline ?? []
        self.profile = profile.map { min(1, max(0, $0)) }
        self.profileIsPlan = a == nil
        self.preNote = a == nil ? w?.preNote.flatMap { $0.isEmpty ? nil : $0 } : nil
        self.logSummary = a.flatMap { LogScales.activitySummary(rpe: $0.rpe, feel: $0.feel, note: $0.postNote) }
        self.needsLog = a.map { $0.rpe == nil || $0.feel == nil } ?? false
        self.rpe = a?.rpe
        self.feel = a?.feel
        self.postNote = a?.postNote
        self.canSendToWatch = a == nil && w != nil && w?.pairedActivityId == nil && w?.status != .skipped && state != .missed
        self.garmin = a == nil ? w?.garmin : nil
        self.environmentText = a == nil ? w?.environment.label : nil
        self.isEditableWorkout = a == nil && w != nil
        self.isSkipped = w?.status == .skipped
        if let w { self.line = SessionLine(workout: w, activity: a, units: units) }
        else if let a { self.line = SessionLine(activity: a, units: units) }
        else { self.line = SessionLine(id: "", sport: .unknown, title: "", detail: "", state: .planned) }

        var spoken = [sport.label, title, status]
        if let durationText { spoken.append(durationText) }
        if let amountText { spoken.append(amountText) }
        if isKey { spoken.append("key session") }
        self.accessibilityLabel = spoken.joined(separator: ", ")
    }
}

public enum DayCards {
    /// Every session on `date`: each planned workout (with its paired activity when that activity is in
    /// `activities`), then activities without a plan on that day. Ordered by start (activities by their
    /// actual start, planned by start time, untimed last); ties: key first, then longer first.
    public static func build(workouts: [PlannedWorkout], activities: [Activity], date: LocalDate, units: UnitSystem) -> [SessionCardModel] {
        var byId: [String: Activity] = [:]
        for a in activities { byId[a.id] = a }
        var pairedIds = Set<String>()
        var items: [(sortKey: String, card: SessionCardModel, duration: Double)] = []

        for w in workouts where w.date == date {
            if let pid = w.pairedActivityId, let a = byId[pid] {
                pairedIds.insert(a.id)
                items.append((a.startedAt, SessionCardModel(workout: w, activity: a, units: units), a.displayDurationSec))
            } else {
                items.append((w.startTime.map { "~" + $0 } ?? "~~", SessionCardModel(workout: w, activity: nil, units: units), w.plannedDurationSec ?? 0))
            }
        }
        for a in activities where a.localDate == date && !pairedIds.contains(a.id) {
            items.append((a.startedAt, SessionCardModel(workout: nil, activity: a, units: units), a.displayDurationSec))
        }
        return items.sorted { x, y in
            if x.sortKey != y.sortKey { return x.sortKey < y.sortKey }
            if x.card.isKey != y.card.isKey { return x.card.isKey }
            return x.duration > y.duration
        }.map { $0.card }
    }

    public static func build(_ cal: CalendarResponse, date: LocalDate, units: UnitSystem) -> [SessionCardModel] {
        build(workouts: cal.workouts, activities: cal.activities, date: date, units: units)
    }
}
