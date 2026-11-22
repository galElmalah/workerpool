import Foundation

// `GET /api/mobile/snapshot` (docs/MOBILE_API.md §2): everything widgets and the first paint need.

public enum SessionKind: String, TolerantEnum {
    /// planned workout, not (yet) done
    case planned
    /// completed activity without a plan
    case activity
    /// planned workout with its completed activity
    case paired
    case unknown
}

public enum SessionState: String, TolerantEnum {
    case planned, done, missed, skipped
    case unknown
}

public enum SnapshotDayState: String, TolerantEnum {
    case rest, planned, done, partial, missed
    case unknown
}

public struct SnapshotSession: Codable, Hashable, Sendable, Identifiable {
    /// workout id for planned/paired, activity id for activity
    public var id: String
    public var kind: SessionKind
    public var sport: Sport
    public var title: String
    /// "HH:MM" local, planned or actual
    public var startTime: String?
    /// actual when done, else planned
    public var durationSec: Double?
    public var distanceM: Double?
    public var load: Double?
    public var isKey: Bool
    public var intensity: IntensityClass?
    public var state: SessionState
    public var workoutId: String?
    public var activityId: String?

    public init(id: String, kind: SessionKind, sport: Sport, title: String, startTime: String? = nil, durationSec: Double? = nil,
                distanceM: Double? = nil, load: Double? = nil, isKey: Bool = false, intensity: IntensityClass? = nil,
                state: SessionState, workoutId: String? = nil, activityId: String? = nil) {
        self.id = id; self.kind = kind; self.sport = sport; self.title = title; self.startTime = startTime
        self.durationSec = durationSec; self.distanceM = distanceM; self.load = load; self.isKey = isKey
        self.intensity = intensity; self.state = state; self.workoutId = workoutId; self.activityId = activityId
    }
}

public struct SnapshotStatus: Codable, Hashable, Sendable {
    public var fitness: Double?
    public var fatigue: Double?
    public var form: Double?
    public var formZone: FormZone?
    public var rampPerWeek: Double?
    /// one short sentence, e.g. "Neutral · long ride today"
    public var headline: String
}

public struct SnapshotDay: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var plannedSec: Double
    public var doneSec: Double
    public var state: SnapshotDayState
}

public struct SnapshotWeek: Codable, Hashable, Sendable {
    /// "2026-W47"
    public var isoWeek: IsoWeek
    /// "W47"
    public var label: String
    /// phase label, e.g. "Run base"
    public var phase: String?
    public var doneSec: Double
    public var plannedSec: Double
    public var doneLoad: Double
    public var plannedLoad: Double
    public var keyDone: Int
    public var keyPlanned: Int
    /// 7 entries, Mon–Sun
    public var days: [SnapshotDay]
}

public struct SnapshotEvent: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var date: LocalDate
    public var daysTo: Int
    public var priority: EventPriority
}

public struct SnapshotFitnessPoint: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var fitness: Double
    public var fatigue: Double
    public var form: Double
}

public struct SnapshotWeekTotal: Codable, Hashable, Sendable {
    public var isoWeek: IsoWeek
    public var label: String
    public var hours: Double
    public var load: Double
}

public struct MobileSnapshot: Codable, Hashable, Sendable {
    public var generatedAt: IsoInstant
    public var today: LocalDate
    public var units: UnitSystem
    public var athleteName: String?
    public var status: SnapshotStatus
    /// in day order
    public var todaySessions: [SnapshotSession]
    public var tomorrowSessions: [SnapshotSession]
    public var week: SnapshotWeek
    public var nextEvent: SnapshotEvent?
    /// last 42 days incl. today
    public var fitnessSeries: [SnapshotFitnessPoint]
    /// last 8 complete weeks + current
    public var recentWeeks: [SnapshotWeekTotal]
    /// most recent completed activity
    public var lastActivity: SnapshotSession?
    /// last successful Garmin sync
    public var lastSyncAt: IsoInstant?
}
