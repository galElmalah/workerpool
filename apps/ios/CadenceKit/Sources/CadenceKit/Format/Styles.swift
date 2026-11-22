import Foundation

/// Display metadata per sport. `symbol` is an SF Symbol name (all exist since iOS 16 / SF Symbols 4).
public struct SportStyle: Hashable, Sendable {
    public let label: String
    public let symbol: String
    public let hasDistance: Bool
}

extension Sport {
    public var style: SportStyle {
        switch self {
        case .bike: return SportStyle(label: "Ride", symbol: "figure.outdoor.cycle", hasDistance: true)
        case .run: return SportStyle(label: "Run", symbol: "figure.run", hasDistance: true)
        case .swim: return SportStyle(label: "Swim", symbol: "figure.pool.swim", hasDistance: true)
        case .row: return SportStyle(label: "Row", symbol: "figure.rower", hasDistance: true)
        case .strength: return SportStyle(label: "Strength", symbol: "figure.strengthtraining.traditional", hasDistance: false)
        case .hike: return SportStyle(label: "Hike", symbol: "figure.hiking", hasDistance: true)
        case .walk: return SportStyle(label: "Walk", symbol: "figure.walk", hasDistance: true)
        case .yoga: return SportStyle(label: "Yoga", symbol: "figure.yoga", hasDistance: false)
        case .ski: return SportStyle(label: "Ski", symbol: "figure.skiing.crosscountry", hasDistance: true)
        case .other: return SportStyle(label: "Other", symbol: "figure.mixed.cardio", hasDistance: false)
        case .unknown: return SportStyle(label: "Session", symbol: "circle.dashed", hasDistance: false)
        }
    }

    public var label: String { style.label }
    public var symbolName: String { style.symbol }
}

/// Intensity metadata (domain.ts INTENSITY_META). DESIGN_V2: only hard sessions (threshold, high,
/// race) carry a small dot toned from the upper zone ramp; easy/moderate show nothing.
public struct IntensityStyle: Hashable, Sendable {
    public let label: String
    /// 1…5 (race is 5)
    public let level: Int
    public let bucket: IntensityBucket
    /// draw the small intensity dot
    public var showsDot: Bool { bucket == .hard }
    /// zone-ramp index 1…7 for the dot / bars (z5 threshold, z6 high, z7 race)
    public let rampIndex: Int
}

extension IntensityClass {
    public var style: IntensityStyle {
        switch self {
        case .recovery: return IntensityStyle(label: "Recovery", level: 1, bucket: .easy, rampIndex: 1)
        case .endurance: return IntensityStyle(label: "Endurance", level: 2, bucket: .easy, rampIndex: 2)
        case .tempo: return IntensityStyle(label: "Tempo", level: 3, bucket: .moderate, rampIndex: 3)
        case .threshold: return IntensityStyle(label: "Threshold", level: 4, bucket: .hard, rampIndex: 5)
        case .high: return IntensityStyle(label: "High", level: 5, bucket: .hard, rampIndex: 6)
        case .race: return IntensityStyle(label: "Race", level: 5, bucket: .hard, rampIndex: 7)
        case .unknown: return IntensityStyle(label: "Unknown", level: 0, bucket: .unknown, rampIndex: 1)
        }
    }

    public var label: String { style.label }
}

/// Form zone wording (web: ui/domain/Status.tsx). Zones from Form % of fitness:
/// ≥ +20 transition, +5…+20 fresh, −10…+5 neutral, −30…−10 productive, < −30 overreaching.
public struct FormZoneStyle: Hashable, Sendable {
    public let label: String
    /// one sentence for a tooltip / detail line
    public let summary: String
    /// 0 (overreaching) … 4 (transition) for a 5-step position scale
    public let position: Int
}

extension FormZone {
    public var style: FormZoneStyle {
        switch self {
        case .overreaching: return FormZoneStyle(label: "Overreaching", summary: "Deep fatigue. Back off soon or risk getting run down.", position: 0)
        case .productive: return FormZoneStyle(label: "Productive", summary: "Carrying fatigue that builds fitness. Fine for blocks, not forever.", position: 1)
        case .neutral: return FormZoneStyle(label: "Neutral", summary: "Balanced: maintaining fitness without much fatigue.", position: 2)
        case .fresh: return FormZoneStyle(label: "Fresh", summary: "Rested and ready. Ideal before a race.", position: 3)
        case .transition: return FormZoneStyle(label: "Transition", summary: "Very fresh: fitness is starting to fade.", position: 4)
        case .unknown: return FormZoneStyle(label: "Form", summary: "", position: 2)
        }
    }

    public var label: String { style.label }

    /// Zone for a Form % value (same thresholds as core/metrics formZoneOf).
    public static func of(formPct: Double) -> FormZone {
        if formPct >= 20 { return .transition }
        if formPct >= 5 { return .fresh }
        if formPct >= -10 { return .neutral }
        if formPct >= -30 { return .productive }
        return .overreaching
    }
}

extension ComplianceState {
    /// Short label shown only when a session deviates (DESIGN_V2 §5); nil when on target/planned.
    public var deviationLabel: String? {
        switch self {
        case .partialShort: return "Short"
        case .partialLong: return "Long"
        case .offShort: return "Well short"
        case .offLong: return "Well over"
        case .missed: return "Missed"
        case .excused: return "Skipped"
        case .unplanned: return "Unplanned"
        case .planned, .onTarget, .unknown: return nil
        }
    }
}

extension EventPriority {
    /// "A race", "B race", "C race"
    public var label: String {
        switch self {
        case .a: return "A race"
        case .b: return "B race"
        case .c: return "C race"
        case .unknown: return "Event"
        }
    }
}

extension SkipReason {
    public var label: String {
        switch self {
        case .sick: return "Sick"
        case .injury: return "Injury"
        case .travel: return "Travel"
        case .fatigue: return "Fatigue"
        case .life: return "Life"
        case .weather: return "Weather"
        case .other: return "Other"
        case .unknown: return "Skipped"
        }
    }
}
