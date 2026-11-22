import Foundation

// Planned workouts and their structure (domain.ts → PlannedWorkout, WorkoutStructure, Step, Repeat).

public enum WorkoutStatus: String, TolerantEnum {
    case planned, skipped
    case unknown
}

public enum WorkoutEnvironment: String, TolerantEnum {
    case indoor, outdoor, any
    case unknown
}

public enum GarminSyncState: String, TolerantEnum {
    case none, pending, synced, error
    case unknown
}

public enum TargetType: String, TolerantEnum {
    case open
    case powerPct = "power_pct"
    case powerW = "power_w"
    case hrZone = "hr_zone"
    case hrPctLthr = "hr_pct_lthr"
    case hrBpm = "hr_bpm"
    case pace
    case pacePct = "pace_pct"
    case rpe, cadence, ramp
    case unknown
}

public enum MeasureType: String, TolerantEnum {
    case time, distance
    case lapButton = "lap_button"
    case reps
    case unknown
}

public enum StepRole: String, TolerantEnum {
    case warmup, active, recovery, rest, cooldown, other
    case unknown
}

public enum NodeKind: String, TolerantEnum {
    case step, `repeat`
    case unknown
}

public enum SwimStroke: String, TolerantEnum {
    case free, back, breast, fly, im, choice, kick, drill
    case unknown
}

public enum SwimEquipment: String, TolerantEnum {
    case pullBuoy = "pull_buoy"
    case paddles, fins
    case kickBoard = "kick_board"
    case snorkel
    case unknown
}

public struct Compliance: Codable, Hashable, Sendable {
    public var metric: ComplianceMetric
    /// actual / planned, e.g. 0.93
    public var ratio: Double
    public var state: ComplianceState
}

/// One flat struct for every target variant; which fields are set depends on `type`
/// (power_pct/power_w/hr_pct_lthr/hr_bpm/pace_pct/rpe/cadence: low+high · hr_zone: zone ·
/// pace: lowMps+highMps · ramp: basis+from+to).
public struct Target: Codable, Hashable, Sendable {
    public var type: TargetType
    public var low: Double?
    public var high: Double?
    public var zone: Int?
    public var lowMps: Double?
    public var highMps: Double?
    public var basis: String?
    public var from: Double?
    public var to: Double?

    public init(type: TargetType, low: Double? = nil, high: Double? = nil, zone: Int? = nil, lowMps: Double? = nil,
                highMps: Double? = nil, basis: String? = nil, from: Double? = nil, to: Double? = nil) {
        self.type = type; self.low = low; self.high = high; self.zone = zone; self.lowMps = lowMps
        self.highMps = highMps; self.basis = basis; self.from = from; self.to = to
    }
}

/// time: sec · distance: m · reps: n · lap_button: nothing.
public struct StepMeasure: Codable, Hashable, Sendable {
    public var type: MeasureType
    public var sec: Double?
    public var m: Double?
    public var n: Int?

    public init(type: MeasureType, sec: Double? = nil, m: Double? = nil, n: Int? = nil) {
        self.type = type; self.sec = sec; self.m = m; self.n = n
    }

    public static func time(_ sec: Double) -> StepMeasure { StepMeasure(type: .time, sec: sec) }
    public static func distance(_ m: Double) -> StepMeasure { StepMeasure(type: .distance, m: m) }
    public static func reps(_ n: Int) -> StepMeasure { StepMeasure(type: .reps, n: n) }
    public static var lapButton: StepMeasure { StepMeasure(type: .lapButton) }
}

public struct SwimStepOptions: Codable, Hashable, Sendable {
    public var stroke: SwimStroke?
    public var equipment: [SwimEquipment]?
    public var sendOffSec: Double?
    public var restSec: Double?

    public init(stroke: SwimStroke? = nil, equipment: [SwimEquipment]? = nil, sendOffSec: Double? = nil, restSec: Double? = nil) {
        self.stroke = stroke; self.equipment = equipment; self.sendOffSec = sendOffSec; self.restSec = restSec
    }
}

public struct RowStepOptions: Codable, Hashable, Sendable {
    public var strokeRateLow: Double?
    public var strokeRateHigh: Double?

    public init(strokeRateLow: Double? = nil, strokeRateHigh: Double? = nil) {
        self.strokeRateLow = strokeRateLow; self.strokeRateHigh = strokeRateHigh
    }
}

public struct StrengthPrescription: Codable, Hashable, Sendable {
    public var exercise: String
    public var exerciseKey: String?
    public var sets: Int
    public var reps: Int?
    public var durationSec: Double?
    public var weightKg: Double?
    public var rpe: Double?
    public var restSec: Double?
    public var supersetGroup: String?

    public init(exercise: String, exerciseKey: String? = nil, sets: Int, reps: Int? = nil, durationSec: Double? = nil,
                weightKg: Double? = nil, rpe: Double? = nil, restSec: Double? = nil, supersetGroup: String? = nil) {
        self.exercise = exercise; self.exerciseKey = exerciseKey; self.sets = sets; self.reps = reps
        self.durationSec = durationSec; self.weightKg = weightKg; self.rpe = rpe; self.restSec = restSec
        self.supersetGroup = supersetGroup
    }
}

/// A step (`kind == .step`: role, measure, targets, sport options) or a repeat block
/// (`kind == .repeat`: count + nested `steps`; nesting depth ≤ 2). One flat recursive struct.
public struct StructureNode: Codable, Hashable, Sendable, Identifiable {
    public var kind: NodeKind
    public var id: String
    public var role: StepRole?
    public var label: String?
    public var cue: String?
    public var measure: StepMeasure?
    public var target: Target?
    public var secondary: Target?
    public var swim: SwimStepOptions?
    public var row: RowStepOptions?
    public var strength: StrengthPrescription?
    public var count: Int?
    public var steps: [StructureNode]?

    public init(kind: NodeKind, id: String, role: StepRole? = nil, label: String? = nil, cue: String? = nil,
                measure: StepMeasure? = nil, target: Target? = nil, secondary: Target? = nil,
                swim: SwimStepOptions? = nil, row: RowStepOptions? = nil, strength: StrengthPrescription? = nil,
                count: Int? = nil, steps: [StructureNode]? = nil) {
        self.kind = kind; self.id = id; self.role = role; self.label = label; self.cue = cue
        self.measure = measure; self.target = target; self.secondary = secondary; self.swim = swim
        self.row = row; self.strength = strength; self.count = count; self.steps = steps
    }

    public static func step(id: String, role: StepRole, measure: StepMeasure, target: Target? = nil, label: String? = nil) -> StructureNode {
        StructureNode(kind: .step, id: id, role: role, label: label, measure: measure, target: target)
    }

    public static func repeatBlock(id: String, count: Int, steps: [StructureNode], label: String? = nil) -> StructureNode {
        StructureNode(kind: .repeat, id: id, label: label, count: count, steps: steps)
    }
}

public struct WorkoutStructure: Codable, Hashable, Sendable {
    public var steps: [StructureNode]
    public var poolLengthM: Double?

    public init(steps: [StructureNode], poolLengthM: Double? = nil) {
        self.steps = steps; self.poolLengthM = poolLengthM
    }
}

public struct GarminLink: Codable, Hashable, Sendable {
    public var workoutId: String?
    public var scheduleId: String?
    public var syncState: GarminSyncState
    public var lastPushedAt: IsoInstant?
    public var error: String?
}

public struct PlannedWorkout: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var date: LocalDate
    /// "HH:MM" local
    public var startTime: String?
    public var sport: Sport
    public var subSport: SubSport?
    public var title: String
    public var description: String?
    public var preNote: String?
    public var plannedDurationSec: Double?
    public var plannedDistanceM: Double?
    public var plannedLoad: Double?
    public var plannedIntensityFactor: Double?
    public var structure: WorkoutStructure?
    public var isKey: Bool
    public var intensity: IntensityClass
    public var tags: [String]
    public var environment: WorkoutEnvironment
    public var templateId: String?
    public var seriesId: String?
    public var eventId: String?
    public var pairedActivityId: String?
    public var status: WorkoutStatus
    public var skipReason: SkipReason?
    public var compliance: Compliance?
    /// ≤ 48 values 0…1: planned intensity profile.
    public var sparkline: [Double]?
    public var garmin: GarminLink
    public var createdAt: IsoInstant
    public var updatedAt: IsoInstant
}

/// `POST /api/workouts` body. The server fills ids, timestamps and planned totals from `structure`.
public struct WorkoutInput: Codable, Hashable, Sendable {
    public var date: LocalDate
    public var startTime: String?
    public var sport: Sport
    public var subSport: SubSport?
    public var title: String?
    public var description: String?
    public var preNote: String?
    public var plannedDurationSec: Double?
    public var plannedDistanceM: Double?
    public var plannedLoad: Double?
    public var structure: WorkoutStructure?
    public var isKey: Bool?
    public var intensity: IntensityClass?
    public var tags: [String]?
    public var environment: WorkoutEnvironment?
    public var eventId: String?

    public init(date: LocalDate, sport: Sport, title: String? = nil, startTime: String? = nil, subSport: SubSport? = nil,
                description: String? = nil, preNote: String? = nil, plannedDurationSec: Double? = nil,
                plannedDistanceM: Double? = nil, plannedLoad: Double? = nil, structure: WorkoutStructure? = nil,
                isKey: Bool? = nil, intensity: IntensityClass? = nil, tags: [String]? = nil,
                environment: WorkoutEnvironment? = nil, eventId: String? = nil) {
        self.date = date; self.sport = sport; self.title = title; self.startTime = startTime; self.subSport = subSport
        self.description = description; self.preNote = preNote; self.plannedDurationSec = plannedDurationSec
        self.plannedDistanceM = plannedDistanceM; self.plannedLoad = plannedLoad; self.structure = structure
        self.isKey = isKey; self.intensity = intensity; self.tags = tags; self.environment = environment
        self.eventId = eventId
    }
}

/// `PATCH /api/workouts/:id` body. `nil` = leave unchanged; `.null` clears (nullable fields only).
/// Changing `date` moves the workout.
public struct WorkoutPatch: Codable, Hashable, Sendable {
    public var date: LocalDate?
    public var startTime: Nullable<String>?
    public var sport: Sport?
    public var subSport: Nullable<SubSport>?
    public var title: String?
    public var description: Nullable<String>?
    public var preNote: Nullable<String>?
    public var plannedDurationSec: Nullable<Double>?
    public var plannedDistanceM: Nullable<Double>?
    public var plannedLoad: Nullable<Double>?
    public var structure: Nullable<WorkoutStructure>?
    public var isKey: Bool?
    public var intensity: IntensityClass?
    public var tags: [String]?
    public var environment: WorkoutEnvironment?
    public var eventId: Nullable<String>?

    public init() {}
}

/// `scope` query for workouts that belong to a repeating series.
public enum SeriesScope: String, Sendable {
    case this, following
}

/// `POST /api/workouts/quick` response.
public struct QuickAddResponse: Codable, Hashable, Sendable {
    public var workout: PlannedWorkout
    public var issues: [TextIssue]
}

public struct TextIssue: Codable, Hashable, Sendable {
    public var line: Int
    public var col: Int
    public var message: String
    /// "error" | "warning" | "info"
    public var severity: String
}

/// `DELETE /api/workouts/:id` response (the deleted rows, for undo via `restoreWorkouts`).
public struct DeletedWorkouts: Codable, Hashable, Sendable {
    public var deleted: [PlannedWorkout]
}

public struct RestoredWorkouts: Codable, Hashable, Sendable {
    public var restored: [PlannedWorkout]
}
