import Foundation

// Completed activities (domain.ts → Activity, ActivityDetail, ActivityStreams, Lap, ZoneTime …).

public struct Activity: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var source: ActivitySource
    public var garminActivityId: String?
    public var garminTypeKey: String?
    public var startedAt: IsoInstant
    /// local = UTC + offset
    public var utcOffsetMin: Int
    public var localDate: LocalDate
    public var sport: Sport
    public var subSport: SubSport?
    public var title: String
    /// elapsed
    public var durationSec: Double
    public var movingSec: Double
    public var distanceM: Double?
    public var elevationGainM: Double?
    public var load: Double
    public var loadSource: LoadSource
    public var intensityFactor: Double?
    public var avgHr: Double?
    public var maxHr: Double?
    public var avgPower: Double?
    public var weightedPower: Double?
    public var maxPower: Double?
    public var avgSpeedMps: Double?
    public var adjustedSpeedMps: Double?
    public var avgCadence: Double?
    public var calories: Double?
    public var workKj: Double?
    public var variability: Double?
    public var efficiency: Double?
    public var decouplingPct: Double?
    public var aerobicEffect: Double?
    public var anaerobicEffect: Double?
    public var poolLengthM: Double?
    public var strokes: Double?
    public var avgSwolf: Double?
    public var totalSets: Double?
    public var totalReps: Double?
    public var volumeKg: Double?
    public var intensityAuto: IntensityClass
    public var intensityOverride: IntensityClass?
    /// Resolved: override ?? auto.
    public var intensity: IntensityClass
    public var isKey: Bool
    /// 1…10
    public var rpe: Int?
    /// 1 awful … 5 great
    public var feel: Int?
    public var postNote: String?
    public var tags: [String]
    public var pairedWorkoutId: String?
    public var compliance: Compliance?
    public var hasStreams: Bool
    public var sparkline: [Double]?
    public var createdAt: IsoInstant
    public var updatedAt: IsoInstant

    /// Moving time when recorded, else elapsed (what the UI shows as "duration").
    public var displayDurationSec: Double { movingSec > 0 ? movingSec : durationSec }
}

public struct Lap: Codable, Hashable, Sendable {
    public var index: Int
    public var startSec: Double
    public var durationSec: Double
    public var movingSec: Double?
    public var distanceM: Double?
    public var avgHr: Double?
    public var maxHr: Double?
    public var avgPower: Double?
    public var weightedPower: Double?
    public var avgSpeedMps: Double?
    public var avgCadence: Double?
    public var elevationGainM: Double?
    public var lengths: Double?
    public var stroke: String?
    public var swolf: Double?
    public var isRest: Bool?
}

public struct ZoneTime: Codable, Hashable, Sendable {
    /// 1-based
    public var zone: Int
    public var name: String
    /// native unit of the zone model (W, bpm, m/s)
    public var low: Double?
    public var high: Double?
    public var seconds: Double
}

public struct ActivityZones: Codable, Hashable, Sendable {
    public var hr: [ZoneTime]?
    public var power: [ZoneTime]?
    public var pace: [ZoneTime]?
}

/// Mean-maximal point: best average `value` held for `durationSec`.
public struct PeakPoint: Codable, Hashable, Sendable {
    public var durationSec: Double
    public var value: Double
    public var startSec: Double?
}

/// Best time over a fixed distance.
public struct BestEffort: Codable, Hashable, Sendable {
    public var distanceM: Double
    public var timeSec: Double
    public var startSec: Double?
}

public struct ActivityPeaks: Codable, Hashable, Sendable {
    public var power: [PeakPoint]?
    public var hr: [PeakPoint]?
    /// m/s
    public var speed: [PeakPoint]?
    public var efforts: [BestEffort]?
}

public struct StrengthSet: Codable, Hashable, Sendable {
    public var index: Int
    public var exercise: String
    public var category: String?
    public var reps: Double?
    public var weightKg: Double?
    public var durationSec: Double?
    public var isRest: Bool?
}

public struct ThresholdSnapshot: Codable, Hashable, Sendable {
    public var ftp: Double?
    public var runThresholdMps: Double?
    public var swimCssMps: Double?
    public var rowThresholdW: Double?
    public var lthr: Double?
    public var hrMax: Double?
    public var hrRest: Double?
    public var weightKg: Double?
}

/// `GET /api/activities/:id`: an `Activity` plus analysis extras. Activity fields are reachable
/// directly (`detail.title`) through dynamic member lookup, or as `detail.activity`.
/// fixture-flatten: Activity
@dynamicMemberLookup
public struct ActivityDetail: Codable, Hashable, Sendable, Identifiable {
    public var activity: Activity
    public var laps: [Lap]
    public var zones: ActivityZones
    public var peaks: ActivityPeaks
    public var strengthSets: [StrengthSet]?
    public var thresholdsUsed: ThresholdSnapshot
    public var plannedWorkout: PlannedWorkout?
    public var previousSimilar: Activity?

    public var id: String { activity.id }

    public subscript<T>(dynamicMember keyPath: KeyPath<Activity, T>) -> T {
        activity[keyPath: keyPath]
    }

    enum CodingKeys: String, CodingKey {
        case laps, zones, peaks, strengthSets, thresholdsUsed, plannedWorkout, previousSimilar
    }

    public init(from decoder: Decoder) throws {
        activity = try Activity(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        laps = try c.decodeIfPresent([Lap].self, forKey: .laps) ?? []
        zones = try c.decodeIfPresent(ActivityZones.self, forKey: .zones) ?? ActivityZones()
        peaks = try c.decodeIfPresent(ActivityPeaks.self, forKey: .peaks) ?? ActivityPeaks()
        strengthSets = try c.decodeIfPresent([StrengthSet].self, forKey: .strengthSets)
        thresholdsUsed = try c.decodeIfPresent(ThresholdSnapshot.self, forKey: .thresholdsUsed) ?? ThresholdSnapshot()
        plannedWorkout = try c.decodeIfPresent(PlannedWorkout.self, forKey: .plannedWorkout)
        previousSimilar = try c.decodeIfPresent(Activity.self, forKey: .previousSimilar)
    }

    public func encode(to encoder: Encoder) throws {
        try activity.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(laps, forKey: .laps)
        try c.encode(zones, forKey: .zones)
        try c.encode(peaks, forKey: .peaks)
        try c.encodeIfPresent(strengthSets, forKey: .strengthSets)
        try c.encode(thresholdsUsed, forKey: .thresholdsUsed)
        try c.encodeIfPresent(plannedWorkout, forKey: .plannedWorkout)
        try c.encodeIfPresent(previousSimilar, forKey: .previousSimilar)
    }
}

/// 1 Hz (resampled) series; every array has the length of `t`; `nil` = no sample.
/// Request with `maxPoints` (the client always does) to get a thinned JSON payload.
public struct ActivityStreams: Codable, Hashable, Sendable {
    /// seconds from start
    public var t: [Double]
    public var hr: [Double?]?
    public var power: [Double?]?
    /// m/s
    public var speed: [Double?]?
    public var cadence: [Double?]?
    /// m
    public var altitude: [Double?]?
    /// cumulative m
    public var distance: [Double?]?
    /// fraction
    public var grade: [Double?]?
    public var temp: [Double?]?
    public var lat: [Double?]?
    public var lng: [Double?]?
}

/// `GET /api/activities` response.
public struct ActivityPage: Codable, Hashable, Sendable {
    public var items: [Activity]
    public var totals: ActivityTotals?
    public var nextCursor: String?
}

public struct ActivityTotals: Codable, Hashable, Sendable {
    public var count: Int
    public var durationSec: Double
    public var movingSec: Double?
    public var distanceM: Double
    public var load: Double
    public var elevationGainM: Double?
}

/// Filters for `GET /api/activities`.
public struct ActivityQuery: Hashable, Sendable {
    public var from: LocalDate?
    public var to: LocalDate?
    public var sport: Sport?
    public var text: String?
    public var keyOnly: Bool?
    public var intensity: IntensityClass?
    public var limit: Int
    public var cursor: String?

    public init(from: LocalDate? = nil, to: LocalDate? = nil, sport: Sport? = nil, text: String? = nil, keyOnly: Bool? = nil,
                intensity: IntensityClass? = nil, limit: Int = 50, cursor: String? = nil) {
        self.from = from; self.to = to; self.sport = sport; self.text = text; self.keyOnly = keyOnly
        self.intensity = intensity; self.limit = limit; self.cursor = cursor
    }
}

/// `PATCH /api/activities/:id` body. `nil` = unchanged, `.null` = clear.
public struct ActivityPatch: Codable, Hashable, Sendable {
    public var title: String?
    public var sport: Sport?
    public var subSport: SubSport?
    public var isKey: Bool?
    public var intensityOverride: Nullable<IntensityClass>?
    /// 1…10
    public var rpe: Nullable<Int>?
    /// 1…5
    public var feel: Nullable<Int>?
    public var postNote: Nullable<String>?
    public var tags: [String]?
    /// Manual load override.
    public var loadManual: Nullable<Double>?

    public init(title: String? = nil, isKey: Bool? = nil, intensityOverride: Nullable<IntensityClass>? = nil,
                rpe: Nullable<Int>? = nil, feel: Nullable<Int>? = nil, postNote: Nullable<String>? = nil,
                tags: [String]? = nil, loadManual: Nullable<Double>? = nil) {
        self.title = title; self.isKey = isKey; self.intensityOverride = intensityOverride; self.rpe = rpe
        self.feel = feel; self.postNote = postNote; self.tags = tags; self.loadManual = loadManual
    }
}

/// `POST /api/activities/manual` body.
public struct ManualActivityInput: Codable, Hashable, Sendable {
    public var localDate: LocalDate
    public var startTime: String?
    public var sport: Sport
    public var subSport: SubSport?
    public var title: String
    public var durationSec: Double
    public var distanceM: Double?
    public var avgHr: Double?
    public var avgPower: Double?
    public var rpe: Int?
    public var feel: Int?
    public var postNote: String?
    public var load: Double?

    public init(localDate: LocalDate, sport: Sport, title: String, durationSec: Double, startTime: String? = nil,
                distanceM: Double? = nil, rpe: Int? = nil, feel: Int? = nil, postNote: String? = nil) {
        self.localDate = localDate; self.sport = sport; self.title = title; self.durationSec = durationSec
        self.startTime = startTime; self.distanceM = distanceM; self.rpe = rpe; self.feel = feel; self.postNote = postNote
    }
}
