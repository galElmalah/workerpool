import Foundation

// `GET /api/today` (routes/today.ts): the daily cockpit.

public struct TodayResponse: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var workouts: [PlannedWorkout]
    public var activities: [Activity]
    public var wellness: TodayWellness
    public var fitness: FitnessDay
    /// Mon…Sun of the current week
    public var weekStrip: [WeekStripDay]
    public var week: WeekSummary
    public var nextEvent: EventCountdown?
    public var nextAEvent: EventCountdown?
    public var dayNote: DayNote?
    public var markers: [DayMarker]
    /// Recent activities (≤ 7 days, max 5) still missing RPE or feel.
    public var pendingLogs: [Activity]
}

public struct TodayWellness: Codable, Hashable, Sendable {
    public var today: WellnessDay?
    public var hrv: HrvSummary
    public var restingHr: RestingHrSummary
    public var sleep: SleepSummary
    public var readiness: ReadinessInfo
}

public struct HrvSummary: Codable, Hashable, Sendable {
    /// 7-day mean (ms)
    public var b7Ms: Double?
    /// normal band (ms)
    public var lowMs: Double?
    public var highMs: Double?
    public var status: HrvStatus?
}

public struct RestingHrSummary: Codable, Hashable, Sendable {
    public var today: Double?
    public var rhr7: Double?
    public var rhr60: Double?
    public var elevated: Bool?
}

public struct SleepSummary: Codable, Hashable, Sendable {
    public var lastHours: Double?
    public var mean3Hours: Double?
    public var short: Bool?
}

/// Readiness HEURISTIC (green/amber/red from warning flags) — label it as such in the UI.
public struct ReadinessInfo: Codable, Hashable, Sendable {
    public var state: ReadinessState
    public var reasons: [String]
    public var inputs: [String]
    public var label: String?
}

public struct WeekStripDay: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var plannedCount: Int
    public var doneCount: Int
    public var load: Double
    public var plannedLoad: Double
    public var states: [ComplianceState]
    public var isToday: Bool
    public var hasKey: Bool
}

public struct EventCountdown: Codable, Hashable, Sendable {
    public var event: Event
    public var daysUntil: Int
}
