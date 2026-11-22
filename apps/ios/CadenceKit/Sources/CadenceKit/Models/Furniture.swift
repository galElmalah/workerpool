import Foundation

// Calendar furniture: events, phases, day markers, notes, wellness (domain.ts + routes/furniture.ts).

public struct Event: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var date: LocalDate
    public var name: String
    public var priority: EventPriority
    public var sport: Sport?
    public var distanceM: Double?
    public var goal: String?
    public var location: String?
    public var note: String?
    public var resultActivityId: String?
}

/// `POST /api/events` body (priority defaults to B on the server).
public struct EventInput: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var name: String
    public var priority: EventPriority?
    public var sport: Sport?
    public var distanceM: Double?
    public var goal: String?
    public var location: String?
    public var note: String?

    public init(date: LocalDate, name: String, priority: EventPriority? = nil, sport: Sport? = nil, distanceM: Double? = nil,
                goal: String? = nil, location: String? = nil, note: String? = nil) {
        self.date = date; self.name = name; self.priority = priority; self.sport = sport; self.distanceM = distanceM
        self.goal = goal; self.location = location; self.note = note
    }
}

/// `PATCH /api/events/:id` body. `nil` = unchanged, `.null` = clear.
public struct EventPatch: Codable, Hashable, Sendable {
    public var date: LocalDate?
    public var name: String?
    public var priority: EventPriority?
    public var sport: Nullable<Sport>?
    public var distanceM: Nullable<Double>?
    public var goal: Nullable<String>?
    public var location: Nullable<String>?
    public var note: Nullable<String>?

    public init() {}
}

public struct Phase: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var type: PhaseType
    public var label: String
    /// inclusive, a Monday
    public var startDate: LocalDate
    /// inclusive, a Sunday
    public var endDate: LocalDate
    public var weeklyLoadTarget: Double?
}

public struct DayMarker: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var type: DayMarkerType
    public var date: LocalDate
    /// inclusive
    public var endDate: LocalDate?
    public var label: String?
}

public struct DayNote: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var body: String
    public var updatedAt: IsoInstant
}

public struct WeekNote: Codable, Hashable, Sendable {
    public var isoWeek: IsoWeek
    public var body: String
    public var targetHours: Double?
    public var targetLoad: Double?
    public var updatedAt: IsoInstant
}

/// `PUT /api/week-notes/:isoWeek` body: omitted body keeps the stored reflection; "" clears it.
public struct WeekNoteInput: Codable, Hashable, Sendable {
    public var body: String?
    public var targetHours: Nullable<Double>?
    public var targetLoad: Nullable<Double>?

    public init(body: String? = nil, targetHours: Nullable<Double>? = nil, targetLoad: Nullable<Double>? = nil) {
        self.body = body; self.targetHours = targetHours; self.targetLoad = targetLoad
    }
}

public struct WellnessDay: Codable, Hashable, Sendable {
    public var date: LocalDate
    /// overnight rMSSD
    public var hrvMs: Double?
    /// Garmin's label, e.g. "BALANCED"
    public var hrvStatus: String?
    public var restingHr: Double?
    public var sleepSec: Double?
    public var sleepScore: Double?
    public var weightKg: Double?
    public var bodyBattery: Double?
    public var stress: Double?
    /// device training readiness 0–100
    public var readiness: Double?
    public var vo2max: Double?
    /// manual morning check-in 1…5
    public var feel: Int?
    /// 1…5
    public var soreness: Int?
    public var note: String?
}

/// `PUT /api/wellness/:date` body — the manual morning check-in (also used by the interactive widget).
public struct WellnessCheckIn: Codable, Hashable, Sendable {
    /// 1 awful … 5 great
    public var feel: Nullable<Int>?
    /// 1 none … 5 very sore
    public var soreness: Nullable<Int>?
    public var note: Nullable<String>?
    public var weightKg: Nullable<Double>?

    public init(feel: Nullable<Int>? = nil, soreness: Nullable<Int>? = nil, note: Nullable<String>? = nil, weightKg: Nullable<Double>? = nil) {
        self.feel = feel; self.soreness = soreness; self.note = note; self.weightKg = weightKg
    }
}

/// `DELETE /api/day-notes/:date` response.
public struct DeletedDayNote: Codable, Hashable, Sendable {
    public var deleted: DayNote?
}
