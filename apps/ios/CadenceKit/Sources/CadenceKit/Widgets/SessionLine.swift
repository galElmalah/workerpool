import Foundation

/// One session row, ready to draw (widgets, Today, lists): glyph · title · "1:25 · 42.2 km".
/// DESIGN_V2 §5: key = semibold title + neutral star; only hard sessions get the small intensity dot;
/// done = neutral solid mark, planned = quiet, missed = struck + dimmed. No colour for "done".
public struct SessionLine: Hashable, Sendable, Identifiable {
    public var id: String
    public var sport: Sport
    /// SF Symbol name
    public var symbol: String
    public var title: String
    /// "1:25 · 42.2 km", "45m · Load 52", "1:00" — duration first, then distance (distance sports) or load
    public var detail: String
    /// "07:30" when a start time is known
    public var time: String?
    public var state: SessionState
    public var isKey: Bool
    /// draw the small intensity dot (threshold, high, race)
    public var showsIntensityDot: Bool
    /// zone-ramp index 1…7 for the dot colour
    public var intensityRamp: Int
    public var deepLink: DeepLink?

    public init(id: String, sport: Sport, title: String, detail: String, time: String? = nil, state: SessionState,
                isKey: Bool = false, intensity: IntensityClass? = nil, deepLink: DeepLink? = nil) {
        self.id = id
        self.sport = sport
        self.symbol = sport.symbolName
        self.title = title.isEmpty ? sport.label : title
        self.detail = detail
        self.time = time
        self.state = state
        self.isKey = isKey
        let style = (intensity ?? .endurance).style
        self.showsIntensityDot = intensity != nil && style.showsDot
        self.intensityRamp = style.rampIndex
        self.deepLink = deepLink
    }

    /// "1:25 · 42.2 km" / "45m · Load 52" / "1:25"
    public static func detailText(durationSec: Double?, distanceM: Double?, load: Double?, sport: Sport, units: UnitSystem) -> String {
        var parts: [String] = []
        if let d = durationSec, d > 0 { parts.append(Format.duration(d, style: .compact)) }
        if sport.style.hasDistance, let m = distanceM, m > 0 {
            parts.append(Format.distance(m, sport: sport, units: units))
        } else if let l = load, l > 0 {
            parts.append("Load \(Format.load(l))")
        }
        return parts.joined(separator: Format.dot)
    }

    public init(session s: SnapshotSession, units: UnitSystem) {
        let link: DeepLink?
        if let a = s.activityId, s.state == .done { link = .activity(id: a) }
        else if let w = s.workoutId { link = .workout(id: w) }
        else if let a = s.activityId { link = .activity(id: a) }
        else { link = nil }
        self.init(id: s.id, sport: s.sport, title: s.title,
                  detail: SessionLine.detailText(durationSec: s.durationSec, distanceM: s.distanceM, load: s.load, sport: s.sport, units: units),
                  time: s.startTime.map { Format.clock($0) }, state: s.state, isKey: s.isKey, intensity: s.intensity, deepLink: link)
    }

    /// A planned workout, with its paired activity when done (actual numbers win).
    public init(workout w: PlannedWorkout, activity: Activity? = nil, units: UnitSystem) {
        let state: SessionState
        if activity != nil { state = .done }
        else if w.status == .skipped { state = .skipped }
        else if w.compliance?.state == .missed { state = .missed }
        else { state = .planned }
        let duration = activity.map { $0.displayDurationSec } ?? w.plannedDurationSec
        let distance = activity?.distanceM ?? w.plannedDistanceM
        let load = activity?.load ?? w.plannedLoad
        self.init(id: w.id, sport: w.sport, title: w.title,
                  detail: SessionLine.detailText(durationSec: duration, distanceM: distance, load: load, sport: w.sport, units: units),
                  time: w.startTime.map { Format.clock($0) }, state: state, isKey: w.isKey || (activity?.isKey ?? false),
                  intensity: activity?.intensity ?? w.intensity,
                  deepLink: activity.map { DeepLink.activity(id: $0.id) } ?? DeepLink.workout(id: w.id))
    }

    /// A completed activity (unplanned, or shown on its own).
    public init(activity a: Activity, units: UnitSystem, utcOffsetTime: Bool = true) {
        self.init(id: a.id, sport: a.sport, title: a.title,
                  detail: SessionLine.detailText(durationSec: a.displayDurationSec, distanceM: a.distanceM, load: a.load, sport: a.sport, units: units),
                  time: utcOffsetTime ? SessionLine.localTime(startedAt: a.startedAt, utcOffsetMin: a.utcOffsetMin) : nil,
                  state: .done, isKey: a.isKey, intensity: a.intensity, deepLink: .activity(id: a.id))
    }

    /// Local wall-clock "HH:MM" of an activity start.
    public static func localTime(startedAt: IsoInstant, utcOffsetMin: Int) -> String? {
        guard let date = Instant.parse(startedAt) else { return nil }
        let local = Int(date.timeIntervalSince1970) + utcOffsetMin * 60
        let secOfDay = ((local % 86_400) + 86_400) % 86_400
        return "\(zeroPad(secOfDay / 3600, 2)):\(zeroPad((secOfDay % 3600) / 60, 2))"
    }

    /// Accessibility sentence: "Run, Easy 45, planned, 45m · 8.5 km, key session".
    public var accessibilityLabel: String {
        var parts = [sport.label, title]
        switch state {
        case .done: parts.append("done")
        case .missed: parts.append("missed")
        case .skipped: parts.append("skipped")
        case .planned, .unknown: parts.append("planned")
        }
        if !detail.isEmpty { parts.append(detail) }
        if isKey { parts.append("key session") }
        return parts.joined(separator: ", ")
    }
}
