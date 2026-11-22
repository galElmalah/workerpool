import Foundation

// `/api/trends/*` (routes/trends.ts).

/// `GET /api/trends/fitness?from&to&sport` (to is capped at today + 56 days; later days are projected).
public struct FitnessTrend: Codable, Hashable, Sendable {
    public var from: LocalDate
    public var to: LocalDate
    public var today: LocalDate
    public var days: [FitnessDay]
    public var events: [Event]
    public var phases: [Phase]
    public var thresholdChanges: [Threshold]
}

/// `GET /api/trends/intensity?weeks`
public struct IntensityTrend: Codable, Hashable, Sendable {
    public var weeks: [IntensityWeek]
    public var total: IntensityTotal
    public var bySport: [IntensitySport]
}

/// Seconds per bucket. fixture-ignore: source
public struct IntensityWeek: Codable, Hashable, Sendable {
    public var isoWeek: IsoWeek
    public var startDate: LocalDate
    public var easy: Double
    public var moderate: Double
    public var hard: Double
    /// percent per bucket, nil for an empty week
    public var pct: IntensityPercent?
    public var distribution: DistributionType?
}

public struct IntensityTotal: Codable, Hashable, Sendable {
    public var easy: Double
    public var moderate: Double
    public var hard: Double
    public var pct: IntensityPercent?
    public var distribution: DistributionType?
}

public struct IntensityPercent: Codable, Hashable, Sendable {
    public var easy: Double
    public var moderate: Double
    public var hard: Double
}

public struct IntensitySport: Codable, Hashable, Sendable {
    public var sport: Sport
    public var seconds: Double
    public var hr: [ZoneSeconds]?
    public var power: [ZoneSeconds]?
    public var pace: [ZoneSeconds]?
}

public struct ZoneSeconds: Codable, Hashable, Sendable {
    public var zone: Int
    public var name: String
    public var seconds: Double
}

/// `GET /api/trends/peaks?sport&ranges` — power/HR curves and best efforts per range.
public struct PeaksTrend: Codable, Hashable, Sendable {
    public var sport: Sport
    public var today: LocalDate
    public var ranges: [PeakRange]
    public var estimate: PeakEstimate
}

public struct PeakRange: Codable, Hashable, Sendable {
    /// "42d", "90d", "season", "last_season", "all", "2025"
    public var key: String
    public var from: LocalDate
    public var to: LocalDate
    public var activities: Int
    /// bike, row
    public var power: [SourcedPeakPoint]?
    /// run (m/s)
    public var speed: [SourcedPeakPoint]?
    public var hr: [SourcedPeakPoint]?
    /// run, swim, row, walk, hike
    public var efforts: [SourcedBestEffort]?
}

public struct SourcedPeakPoint: Codable, Hashable, Sendable {
    public var durationSec: Double
    public var value: Double
    public var activityId: String?
    public var date: LocalDate?
}

public struct SourcedBestEffort: Codable, Hashable, Sendable {
    public var distanceM: Double
    public var timeSec: Double
    public var activityId: String
    public var date: LocalDate
}

/// Suggestions only — never applied automatically.
public struct PeakEstimate: Codable, Hashable, Sendable {
    public var ftp: FtpEstimate?
    public var criticalPower: CriticalPowerEstimate?
    public var thresholds: [ThresholdSuggestion]?
}

public struct FtpEstimate: Codable, Hashable, Sendable {
    public var value: Double
    public var basis: String
}

public struct CriticalPowerEstimate: Codable, Hashable, Sendable {
    public var cp: Double
    public var wPrime: Double
    public var r2: Double?
    public var valid: Bool
    public var reason: String?
}

public struct ThresholdSuggestion: Codable, Hashable, Sendable {
    public var kind: ThresholdKind
    /// a Sport raw value or "all"
    public var sport: String
    public var value: Double
    public var basis: String?
    public var current: Double?
}

/// `GET /api/trends/wellness?from&to`
public struct WellnessTrend: Codable, Hashable, Sendable {
    public var from: LocalDate
    public var to: LocalDate
    public var today: LocalDate
    public var days: [WellnessTrendDay]
    public var readinessLabel: String
}

/// A `WellnessDay` plus derived baselines. Note `readiness` here is the heuristic object, not the
/// device score (that one is not included in this payload).
public struct WellnessTrendDay: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var hrvMs: Double?
    public var hrvStatus: String?
    public var restingHr: Double?
    public var sleepSec: Double?
    public var sleepScore: Double?
    public var weightKg: Double?
    public var bodyBattery: Double?
    public var stress: Double?
    public var vo2max: Double?
    public var feel: Int?
    public var soreness: Int?
    public var note: String?
    public var load: Double
    public var hrvBaseline: HrvBaselineInfo
    public var restingHrTrend: RestingHrTrendInfo
    public var readiness: ReadinessInfo
}

public struct HrvBaselineInfo: Codable, Hashable, Sendable {
    public var b7Ms: Double?
    public var lowMs: Double?
    public var highMs: Double?
    public var cv7: Double?
    public var status: HrvStatus?
}

public struct RestingHrTrendInfo: Codable, Hashable, Sendable {
    public var rhr7: Double?
    public var rhr60: Double?
    public var elevated: Bool?
}

/// `GET /api/trends/consistency?days`
public struct ConsistencyTrend: Codable, Hashable, Sendable {
    public var from: LocalDate
    public var to: LocalDate
    public var days: [ConsistencyDay]
    public var streaks: Streaks
}

public struct ConsistencyDay: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var load: Double
    public var durationSec: Double
    public var count: Int
    public var key: Bool
}

public struct Streaks: Codable, Hashable, Sendable {
    public var currentDays: Int
    public var longestDays: Int
    public var currentWeeks: Int
    public var longestWeeks: Int
    /// weeks with ≥ 3 sessions
    public var currentWeeks3: Int
    public var longestWeeks3: Int
    public var daysSinceRest: Int
}
