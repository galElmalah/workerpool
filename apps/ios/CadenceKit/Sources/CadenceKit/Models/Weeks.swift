import Foundation

// `GET /api/weeks/:isoWeek` (routes/weeks.ts): the weekly review.

public struct WeekReview: Codable, Hashable, Sendable {
    public var isoWeek: IsoWeek
    public var summary: WeekSummary
    public var previous: WeekSummary?
    /// Mon…Sun
    public var days: [WeekReviewDay]
    /// missed first, then excused, then by date
    public var keySessions: [KeySession]
    public var highlights: WeekHighlights
    public var wellness: WeekWellness
    public var previousWellness: WeekWellness?
    public var events: [Event]
    public var note: WeekNote?
    public var next: NextWeekPreview
}

public struct WeekReviewDay: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var workouts: [PlannedWorkout]
    public var activities: [Activity]
    public var markers: [DayMarker]
    public var note: DayNote?
    public var wellness: WellnessDay?
}

public struct KeySession: Codable, Hashable, Sendable {
    public var workout: PlannedWorkout
    public var activity: Activity?
    public var compliance: Compliance
}

public struct WeekHighlights: Codable, Hashable, Sendable {
    public var longest: Activity?
    public var biggestLoad: Activity?
    public var biggestLoadDay: DayLoad?
    public var newBests: [NewBest]
}

public struct DayLoad: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var load: Double
}

/// A best set this week. power: `value` W over `durationSec`; effort: `value` seconds over `distanceM`.
public struct NewBest: Codable, Hashable, Sendable {
    public var activityId: String
    public var date: LocalDate
    public var sport: Sport
    /// "power" | "effort"
    public var kind: String
    public var durationSec: Double?
    public var distanceM: Double?
    public var value: Double
    public var previous: Double?
}

public struct WeekWellness: Codable, Hashable, Sendable {
    public var avgHrvMs: Double?
    public var hrvBaselineMs: Double?
    public var hrvVsBaselinePct: Double?
    public var avgSleepSec: Double?
    public var avgRestingHr: Double?
    public var weightDeltaKg: Double?
    public var avgFeel: Double?
}

public struct NextWeekPreview: Codable, Hashable, Sendable {
    public var summary: WeekSummary?
    public var workoutCount: Int
    public var keyCount: Int
}
