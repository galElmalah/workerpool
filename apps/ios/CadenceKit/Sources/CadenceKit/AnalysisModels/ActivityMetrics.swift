import Foundation

// The full metric set of an activity, in labelled groups (DESIGN_V2 §8 owner request: "a lot of
// data, metrics"). Built from optionals: a metric appears only when it has a value, so a new API
// field is one `add(...)` line in the right group.

public enum MetricGroupKind: String, CaseIterable, Hashable, Sendable {
    case timeDistance, heartRate, power, paceSpeed, cadence, elevation, swim, row, strength, energy, conditions

    public var title: String {
        switch self {
        case .timeDistance: return "Time & distance"
        case .heartRate: return "Heart rate"
        case .power: return "Power"
        case .paceSpeed: return "Pace & speed"
        case .cadence: return "Cadence & dynamics"
        case .elevation: return "Elevation"
        case .swim: return "Swim"
        case .row: return "Row"
        case .strength: return "Strength"
        case .energy: return "Energy & effect"
        case .conditions: return "Conditions & device"
        }
    }
}

public struct MetricItem: Hashable, Sendable, Identifiable {
    public var id: String { label }
    public var label: String
    public var value: String
    public var unit: String

    public init(label: String, value: String, unit: String = "") {
        self.label = label; self.value = value; self.unit = unit
    }

    public var accessibilityText: String { "\(label), \(value)\(unit.isEmpty ? "" : " " + unit)" }
}

public struct MetricGroup: Hashable, Sendable, Identifiable {
    public var id: MetricGroupKind { kind }
    public var kind: MetricGroupKind
    public var title: String { kind.title }
    public var items: [MetricItem]
}

public enum ActivityMetrics {
    /// Every metric with a value, grouped in `MetricGroupKind` order; empty groups are dropped.
    /// `streams` (optional) adds stream-derived figures such as average temperature.
    /// `extras` (device facts, location) wins over stream-derived values when both exist.
    public static func groups(_ d: ActivityDetail, units: UnitSystem, streams: ActivityStreams? = nil,
                              extras: ActivityExtras? = nil) -> [MetricGroup] {
        let a = d.activity
        let sport = a.sport
        let th = d.thresholdsUsed
        let f = extras?.facts ?? ActivityExtraFacts()
        var b = Builder()

        func num(_ v: Double?, _ decimals: Int = 0) -> String? {
            guard let v, v.isFinite else { return nil }
            return Format.number(v, decimals: decimals)
        }
        func pos(_ v: Double?) -> Double? { (v ?? 0) > 0 ? v : nil }

        // Time & distance
        b.add(.timeDistance, "Elapsed time", a.durationSec > 0 ? Format.duration(a.durationSec, style: .hms) : nil)
        b.add(.timeDistance, "Moving time", a.movingSec > 0 ? Format.duration(a.movingSec, style: .hms) : nil)
        if a.movingSec > 0 && a.durationSec > a.movingSec + 30 {
            b.add(.timeDistance, "Stopped", Format.duration(a.durationSec - a.movingSec, style: .hms))
        }
        if let m = pos(a.distanceM) {
            let p = Format.distanceParts(m, sport: sport, units: units)
            b.add(.timeDistance, "Distance", p.value, p.unit)
        }
        b.add(.timeDistance, "Timer time", pos(f.timerSec).map { Format.duration($0, style: .hms) })
        if let p = pos(f.pausedSec) {
            let n = Int(f.pauseCount ?? 0)
            b.add(.timeDistance, "Paused", Format.duration(p, style: .hms), n > 0 ? "\(n) stop\(n == 1 ? "" : "s")" : "")
        }
        b.add(.timeDistance, "Laps", d.laps.count > 1 ? "\(d.laps.count)" : nil)
        b.add(.timeDistance, "Start", SessionLine.localTime(startedAt: a.startedAt, utcOffsetMin: a.utcOffsetMin))

        // Heart rate
        b.add(.heartRate, "Average", num(pos(a.avgHr)), "bpm")
        b.add(.heartRate, "Maximum", num(pos(a.maxHr)), "bpm")
        b.add(.heartRate, "Minimum", num(pos(f.minHr)), "bpm")
        if let hr = pos(a.avgHr), let lthr = pos(th.lthr) {
            b.add(.heartRate, "Average of threshold", Format.percent(hr / lthr))
        }
        b.add(.heartRate, "Threshold used", num(pos(th.lthr)), "bpm")

        // Power
        b.add(.power, "Average", num(pos(a.avgPower)), "W")
        b.add(.power, "Weighted", num(pos(a.weightedPower)), "W")
        b.add(.power, "Maximum", num(pos(a.maxPower)), "W")
        b.add(.power, "Intensity", num(pos(a.intensityFactor), 2))
        b.add(.power, "Variability", num(pos(a.variability), 2))
        if let l = pos(f.powerBalanceLeftPct) {
            b.add(.power, "Balance left / right", "\(Format.number(l)) / \(Format.number(100 - l))", "%")
        }
        if let w = pos(th.weightKg), let p = pos(a.weightedPower ?? a.avgPower) {
            b.add(.power, "Watts per kilo", Format.number(p / w, decimals: 2), "W/kg")
        }
        b.add(.power, "Work", num(pos(a.workKj)), "kJ")
        let thresholdPower = sport == .row ? th.rowThresholdW : th.ftp
        if pos(a.avgPower) != nil { b.add(.power, sport == .row ? "Threshold used" : "FTP used", num(pos(thresholdPower)), "W") }

        // Pace & speed
        if let v = pos(a.avgSpeedMps) {
            if Format.usesPace(sport) {
                let p = Format.paceParts(v, sport: sport, units: units)
                b.add(.paceSpeed, sport == .row ? "Average split" : "Average pace", p.value, p.unit)
            }
            let s = Format.speedParts(v, units: units)
            b.add(.paceSpeed, "Average speed", s.value, s.unit)
        }
        if let v = pos(a.adjustedSpeedMps) {
            let p = Format.paceParts(v, sport: sport, units: units)
            b.add(.paceSpeed, "Grade-adjusted pace", p.value, p.unit)
        }
        if let top = pos(f.maxSpeedMps) {
            let s = Format.speedParts(top, units: units)
            b.add(.paceSpeed, "Top speed", s.value, s.unit)
        } else if let peak = streams?.speed?.compactMap({ $0 }).max(), peak > 0, sport != .swim {
            let s = Format.speedParts(peak, units: units)
            b.add(.paceSpeed, "Top speed", s.value, s.unit)
        }

        // Cadence & dynamics
        let cadUnit = sport == .bike ? "rpm" : "spm"
        b.add(.cadence, sport == .swim || sport == .row ? "Stroke rate" : "Average cadence", num(pos(a.avgCadence)), cadUnit)
        if let c = pos(f.maxCadence) ?? streams?.cadence?.compactMap({ $0 }).max(), c > 0 {
            b.add(.cadence, "Maximum cadence", Format.number(c), cadUnit)
        }
        b.add(.cadence, "Ground contact", num(pos(f.avgGroundContactMs)), "ms")
        if let l = pos(f.avgGroundContactBalanceLeftPct) {
            b.add(.cadence, "Contact balance left / right", "\(Format.number(l, decimals: 1)) / \(Format.number(100 - l, decimals: 1))", "%")
        }
        b.add(.cadence, "Vertical oscillation", num(pos(f.avgVerticalOscillationCm), 1), "cm")
        b.add(.cadence, "Vertical ratio", num(pos(f.avgVerticalRatioPct), 1), "%")
        if let stride = pos(f.avgStrideLengthM) {
            b.add(.cadence, "Stride length", units == .imperial ? Format.number(stride / Format.metresPerFoot, decimals: 1) : Format.number(stride, decimals: 2),
                  units == .imperial ? "ft" : "m")
        }
        b.add(.cadence, "Steps", num(pos(f.steps)))
        if sport == .row, let c = pos(a.avgCadence), let m = pos(a.distanceM), a.movingSec > 0 {
            b.add(.cadence, "Distance per stroke", Format.number(m / (c * a.movingSec / 60), decimals: 1), "m")
        }

        // Elevation
        let elevUnit = units == .imperial ? "ft" : "m"
        func elev(_ m: Double?) -> String? { m.map { Format.number(units == .imperial ? $0 / Format.metresPerFoot : $0) } }
        b.add(.elevation, "Gain", elev(pos(a.elevationGainM)), elevUnit)
        if f.elevationLossM != nil || f.maxAltitudeM != nil {
            b.add(.elevation, "Loss", elev(f.elevationLossM), elevUnit)
            b.add(.elevation, "Highest", elev(f.maxAltitudeM), elevUnit)
            b.add(.elevation, "Lowest", elev(f.minAltitudeM), elevUnit)
        } else if let alt = streams?.altitude?.compactMap({ $0 }), let lo = alt.min(), let hi = alt.max(), hi > lo {
            var loss = 0.0
            var last: Double?
            for v in alt { if let l = last, v < l { loss += l - v }; last = v }
            b.add(.elevation, "Loss", elev(loss), elevUnit)
            b.add(.elevation, "Highest", elev(hi), elevUnit)
            b.add(.elevation, "Lowest", elev(lo), elevUnit)
        }

        b.add(.elevation, "Steepest climb", num(pos(f.maxGradePct), 1), "%")
        if let g = f.minGradePct, g < 0 { b.add(.elevation, "Steepest descent", Format.number(g, decimals: 1), "%") }

        // Swim
        if sport == .swim {
            b.add(.swim, "Active lengths", num(pos(f.activeLengths)))
            b.add(.swim, "Strokes per length", num(pos(f.avgStrokesPerLength), 1))
            b.add(.swim, "Distance per stroke", num(pos(f.avgDistancePerStrokeM), 2), "m")
            b.add(.swim, "Pool length", num(pos(a.poolLengthM)), "m")
            if let pool = pos(a.poolLengthM), let m = pos(a.distanceM) { b.add(.swim, "Lengths", Format.number(m / pool)) }
            b.add(.swim, "Strokes", num(pos(a.strokes)))
            if let s = pos(a.strokes), let pool = pos(a.poolLengthM), let m = pos(a.distanceM) {
                if f.avgStrokesPerLength == nil { b.add(.swim, "Strokes per length", Format.number(s / (m / pool), decimals: 1)) }
            }
            b.add(.swim, "SWOLF", num(pos(a.avgSwolf)))
            b.add(.swim, "CSS used", th.swimCssMps.flatMap { pos($0) }.map { Format.paceParts($0, sport: .swim, units: units).value },
                  Format.paceBasis(sport: .swim, units: units).label)
        }

        // Row
        if sport == .row {
            b.add(.row, "Strokes", num(pos(f.totalStrokes ?? a.strokes)))
            b.add(.row, "Distance per stroke", num(pos(f.avgDistancePerStrokeM), 1), "m")
        }

        // Strength
        if sport == .strength {
            b.add(.strength, "Sets", num(pos(a.totalSets)))
            b.add(.strength, "Reps", num(pos(a.totalReps)))
            if let v = pos(a.volumeKg) {
                b.add(.strength, "Volume", Format.number(units == .imperial ? v / Format.kgPerPound : v), units == .imperial ? "lb" : "kg")
            }
            let exercises = Set((d.strengthSets ?? []).filter { !($0.isRest ?? false) }.map(\.exercise)).count
            b.add(.strength, "Exercises", exercises > 0 ? "\(exercises)" : nil)
        }

        // Energy & effect
        let src = ActivityDetailModel.loadSourceText(a.loadSource)
        b.add(.energy, "Load", Format.load(a.load), src)
        b.add(.energy, "Calories", num(pos(a.calories)), "kcal")
        b.add(.energy, "Aerobic effect", num(pos(a.aerobicEffect), 1))
        b.add(.energy, "Anaerobic effect", num(pos(a.anaerobicEffect), 1))
        b.add(.energy, "Training effect", f.trainingEffectLabel.map { ActivityExtras.trainingEffectText($0) })
        b.add(.energy, "Garmin training load", num(pos(f.deviceLoad)))
        b.add(.energy, "Sweat loss", num(pos(f.sweatLossMl)), "ml")
        b.add(.energy, "Efficiency", num(pos(a.efficiency), sport == .bike || sport == .row ? 2 : 3))
        b.add(.energy, "Decoupling", num(a.decouplingPct, 1), "%")
        if let rpe = a.rpe { b.add(.energy, "RPE", "\(rpe)", EffortScale.rpeLabel(rpe).lowercased()) }

        // Conditions & device
        func temp(_ c: Double) -> String { Format.number(units == .imperial ? c * 9 / 5 + 32 : c) }
        let tempUnit = units == .imperial ? "°F" : "°C"
        b.add(.conditions, "Location", extras?.locationName.flatMap { $0.isEmpty ? nil : $0 })
        if let avg = f.avgTempC {
            var range = ""
            if let lo = f.minTempC, let hi = f.maxTempC, hi > lo { range = "\(temp(lo))\(Format.enDash)\(temp(hi))\(tempUnit) range" }
            b.add(.conditions, "Temperature", temp(avg), range.isEmpty ? tempUnit : "\(tempUnit) · \(range)")
        } else if let temps = streams?.temp?.compactMap({ $0 }), !temps.isEmpty {
            b.add(.conditions, "Temperature", temp(temps.reduce(0, +) / Double(temps.count)), tempUnit)
        }
        b.add(.conditions, "Time zone", f.timezone)
        var device = f.deviceName ?? ""
        if let sw = f.deviceSoftware, !device.isEmpty { device += " (\(sw))" }
        b.add(.conditions, "Device", device.isEmpty ? nil : device)
        b.add(.conditions, "Sport profile", f.sportProfile)
        if let sensors = f.sensors, !sensors.isEmpty {
            b.add(.conditions, "Sensors", sensors.map { s in s.name.map { "\($0) (\(s.kind))" } ?? s.kind }.joined(separator: ", "))
        }
        b.add(.conditions, "Source", sourceLabel(a.source))
        b.add(.conditions, "Recorded as", a.garminTypeKey.map { $0.replacingOccurrences(of: "_", with: " ") })
        if let sub = a.subSport, sub != .unknown { b.add(.conditions, "Type", ActivityDetailModel.subSportLabel(sub)) }

        return b.groups()
    }

    public static func sourceLabel(_ s: ActivitySource) -> String? {
        switch s {
        case .garmin: return "Garmin"
        case .upload: return "File upload"
        case .manual: return "Entered by hand"
        case .demo: return "Demo data"
        case .unknown: return nil
        }
    }

    struct Builder {
        private var items: [MetricGroupKind: [MetricItem]] = [:]

        /// Adds a metric when `value` is non-nil and not empty.
        mutating func add(_ kind: MetricGroupKind, _ label: String, _ value: String?, _ unit: String = "") {
            guard let value, !value.isEmpty, value != Format.placeholder else { return }
            items[kind, default: []].append(MetricItem(label: label, value: value, unit: unit))
        }

        func groups() -> [MetricGroup] {
            MetricGroupKind.allCases.compactMap { k in
                guard let list = items[k], !list.isEmpty else { return nil }
                return MetricGroup(kind: k, items: list)
            }
        }
    }
}

/// Status vocabulary (DESIGN_V2 §8.3) — always shown with its symbol or a word.
public enum AnalysisTone: String, Hashable, Sendable {
    case good, warn, serious, critical, neutral

    /// SF Symbol paired with the colour
    public var symbol: String {
        switch self {
        case .good: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .serious: return "exclamationmark.circle.fill"
        case .critical: return "xmark.circle.fill"
        case .neutral: return "circle"
        }
    }

    public static func of(_ state: ComplianceState) -> AnalysisTone {
        switch state {
        case .onTarget: return .good
        case .partialShort, .partialLong: return .warn
        case .offShort, .offLong: return .serious
        case .missed: return .critical
        case .excused, .planned, .unplanned, .unknown: return .neutral
        }
    }
}
