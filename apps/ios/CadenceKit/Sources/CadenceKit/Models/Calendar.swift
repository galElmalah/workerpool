import Foundation

// Calendar range, week summaries and the fitness model (domain.ts → CalendarResponse, WeekSummary, FitnessDay).

/// One day of the fitness model. `projected` days use planned load.
public struct FitnessDay: Codable, Hashable, Sendable {
    public var date: LocalDate
    /// completed load that day
    public var load: Double
    /// planned (unpaired remaining) load that day
    public var plannedLoad: Double
    /// 42-day EWMA (end of day)
    public var fitness: Double
    /// 7-day EWMA (end of day)
    public var fatigue: Double
    /// yesterday's fitness − fatigue
    public var form: Double
    /// form as PERCENT of fitness (−24 = −24 %)
    public var formPct: Double?
    public var formZone: FormZone?
    /// fitness − fitness 7 days earlier
    public var ramp: Double?
    public var projected: Bool
}

public struct SportTotals: Codable, Hashable, Sendable {
    public var sport: Sport
    public var plannedSec: Double
    public var doneSec: Double
    public var plannedLoad: Double
    public var doneLoad: Double
    public var plannedDistanceM: Double
    public var doneDistanceM: Double
    public var plannedCount: Int
    public var doneCount: Int
    public var elevationGainM: Double
}

/// Seconds of done time by intensity bucket.
public struct IntensitySeconds: Codable, Hashable, Sendable {
    public var easy: Double
    public var moderate: Double
    public var hard: Double
}

/// WoW deltas are fractions (0.08 = +8 %), nil when the previous week is zero.
public struct WeekSummary: Codable, Hashable, Sendable {
    public var isoWeek: IsoWeek
    public var startDate: LocalDate
    public var endDate: LocalDate
    public var plannedSec: Double
    public var doneSec: Double
    public var plannedLoad: Double
    public var doneLoad: Double
    public var plannedDistanceM: Double
    public var doneDistanceM: Double
    public var elevationGainM: Double
    /// done so far + still-planned remainder
    public var projectedSec: Double
    public var projectedLoad: Double
    public var targetHours: Double?
    public var targetLoad: Double?
    public var bySport: [SportTotals]
    public var keyPlanned: Int
    public var keyDone: Int
    public var intensitySec: IntensitySeconds
    /// mean clamped compliance in PERCENT (0–100)
    public var compliancePct: Double?
    public var fitness: Double
    public var fatigue: Double
    public var form: Double
    public var formPct: Double?
    public var formZone: FormZone?
    public var fitnessDelta: Double
    public var wowSec: Double?
    public var wowLoad: Double?
    public var wowDistanceM: Double?
    public var isProjected: Bool
    public var hasNote: Bool
    public var phaseId: String?
    /// daily done load Mon…Sun (7 values)
    public var dailyLoad: [Double]
}

/// `GET /api/calendar?from&to` — the range is expanded to whole ISO weeks (`from`/`to` echo that).
public struct CalendarResponse: Codable, Hashable, Sendable {
    public var from: LocalDate
    public var to: LocalDate
    public var today: LocalDate
    public var workouts: [PlannedWorkout]
    public var activities: [Activity]
    public var events: [Event]
    public var phases: [Phase]
    public var markers: [DayMarker]
    public var dayNotes: [DayNote]
    public var wellness: [WellnessDay]
    public var weeks: [WeekSummary]
}

extension CalendarResponse {
    public func workouts(on date: LocalDate) -> [PlannedWorkout] {
        workouts.filter { $0.date == date }.sorted { ($0.startTime ?? "99") < ($1.startTime ?? "99") }
    }

    public func activities(on date: LocalDate) -> [Activity] {
        activities.filter { $0.localDate == date }.sorted { $0.startedAt < $1.startedAt }
    }

    /// Unpaired activities on a day (paired ones are shown with their workout).
    public func unplannedActivities(on date: LocalDate) -> [Activity] {
        activities(on: date).filter { $0.pairedWorkoutId == nil }
    }

    public func week(containing date: LocalDate) -> WeekSummary? {
        weeks.first { $0.startDate <= date && date <= $0.endDate }
    }

    public func phase(on date: LocalDate) -> Phase? {
        phases.first { $0.startDate <= date && date <= $0.endDate }
    }

    public func markers(on date: LocalDate) -> [DayMarker] {
        markers.filter { $0.date <= date && date <= ($0.endDate ?? $0.date) }
    }

    public func dayNote(on date: LocalDate) -> DayNote? { dayNotes.first { $0.date == date } }

    public func events(on date: LocalDate) -> [Event] { events.filter { $0.date == date } }
}
