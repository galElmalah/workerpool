import Foundation

// View-models for the Activities list and the Activity detail screen. Pure: every string the
// screens show is produced here.

// MARK: - List

public struct ActivityRowModel: Hashable, Sendable, Identifiable {
    public var id: String
    public var sport: Sport
    public var title: String
    /// "Sat 21 Nov" (+ year when not this year), "Today", "Yesterday"
    public var dateText: String
    /// "2:06 · 57.8 km" — duration, then distance for distance sports
    public var detail: String
    /// "103" (unitless; the row labels it)
    public var loadText: String
    public var isKey: Bool
    public var showsIntensityDot: Bool
    public var intensityRamp: Int
    public var accessibilityLabel: String

    public init(activity a: Activity, units: UnitSystem, today: LocalDate? = nil) {
        id = a.id
        sport = a.sport
        title = a.title.isEmpty ? a.sport.label : a.title
        dateText = ActivityRowModel.dateText(a.localDate, today: today)
        var parts = [Format.duration(a.displayDurationSec, style: .clock)]
        if a.sport.style.hasDistance, let d = a.distanceM, d > 0 { parts.append(Format.distance(d, sport: a.sport, units: units)) }
        detail = parts.joined(separator: Format.dot)
        loadText = Format.load(a.load)
        isKey = a.isKey
        let style = a.intensity.style
        showsIntensityDot = style.showsDot
        intensityRamp = style.rampIndex
        var spoken = [a.sport.label, title, dateText, detail, "load \(loadText)"]
        if a.isKey { spoken.append("key session") }
        if style.showsDot { spoken.append(style.label) }
        accessibilityLabel = spoken.joined(separator: ", ")
    }

    static func dateText(_ date: LocalDate, today: LocalDate?) -> String {
        guard let today, let t = Day(today), let d = Day(date) else { return Format.dateMedium(date) }
        switch d.days(until: t) {
        case 0: return "Today"
        case 1: return "Yesterday"
        default: return Format.dateMedium(date, withYear: d.year != t.year)
        }
    }
}

public struct ActivitySection: Hashable, Sendable, Identifiable {
    /// "2026-11"
    public var id: String
    /// "November 2026"
    public var title: String
    public var rows: [ActivityRowModel]
}

public enum ActivityListModel {
    /// Groups rows by month, keeping the input order (newest first from the API).
    public static func sections(_ activities: [Activity], units: UnitSystem, today: LocalDate? = nil) -> [ActivitySection] {
        var out: [ActivitySection] = []
        for a in activities {
            let key = String(a.localDate.prefix(7))
            let row = ActivityRowModel(activity: a, units: units, today: today)
            if let last = out.indices.last, out[last].id == key {
                out[last].rows.append(row)
            } else {
                out.append(ActivitySection(id: key, title: Format.monthYear(key), rows: [row]))
            }
        }
        return out
    }

    /// One quiet line: "128 activities · 212 h · 3,412 km · Load 12,340". nil without totals.
    public static func totalsLine(_ t: ActivityTotals?, sport: Sport?, units: UnitSystem) -> String? {
        guard let t else { return nil }
        if t.count == 0 { return "No activities" }
        var parts = ["\(Format.number(Double(t.count))) \(t.count == 1 ? "activity" : "activities")"]
        let sec = (t.movingSec ?? 0) > 0 ? (t.movingSec ?? 0) : t.durationSec
        parts.append(Format.duration(sec, style: .short))
        let distSport = sport ?? .run
        if distSport.style.hasDistance && t.distanceM > 0 {
            parts.append(Format.distance(t.distanceM, sport: distSport, units: units))
        }
        parts.append("Load \(Format.load(t.load))")
        return parts.joined(separator: Format.dot)
    }

    /// Menu title for the sport filter.
    public static func filterTitle(_ sport: Sport?) -> String { sport?.label ?? "All sports" }

    /// Sports offered in the filter menu.
    public static var filterSports: [Sport] { Sport.knownCases }
}

// MARK: - Detail

/// A figure: label above, value (+ unit), one line of context.
public struct KeyFigure: Hashable, Sendable, Identifiable {
    public var id: String
    public var label: String
    public var value: String
    public var unit: String
    public var context: String?

    public init(id: String, label: String, value: String, unit: String = "", context: String? = nil) {
        self.id = id; self.label = label; self.value = value; self.unit = unit; self.context = context
    }

    public var accessibilityText: String {
        [label, value + (unit.isEmpty ? "" : " " + unit), context ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// Plan vs actual for a paired activity: "On plan · 107% of planned load" + a thin bar.
public struct PlanComparisonModel: Hashable, Sendable {
    public var workoutId: String
    public var workoutTitle: String
    /// "On plan", "Short", "Well over"…
    public var stateLabel: String
    /// "107% of planned load"
    public var detail: String
    /// 0…1 for the thin bar (actual / planned, capped)
    public var fraction: Double
    /// true when actual exceeds plan (the bar is full)
    public var isOver: Bool

    public var accessibilityText: String { "\(stateLabel), \(detail), planned \(workoutTitle)" }
}

public struct LapTableModel: Hashable, Sendable {
    public var columns: [String]
    public var rows: [LapRowModel]
}

public struct LapRowModel: Hashable, Sendable, Identifiable {
    public var id: Int
    public var cells: [String]
    public var isRest: Bool
}

public struct ZoneBarModel: Hashable, Sendable, Identifiable {
    public var id: Int { zone }
    public var zone: Int
    public var name: String
    /// "34:49"
    public var timeText: String
    /// "28%"
    public var shareText: String
    /// share of total time 0…1
    public var share: Double
    /// bar length relative to the largest zone, 0…1
    public var fraction: Double
    /// "152–207 W", "< 152 W"
    public var rangeText: String?
}

public struct ZoneSetModel: Hashable, Sendable, Identifiable {
    /// "power" | "hr" | "pace"
    public var id: String
    /// "Power", "Heart rate", "Pace"
    public var title: String
    public var bars: [ZoneBarModel]
}

public struct PeakRowModel: Hashable, Sendable, Identifiable {
    public var id: String
    /// "5 s", "1 min", "5 km"
    public var label: String
    /// "704 W", "4:05 /km", "24:10"
    public var value: String
}

public struct StrengthExerciseModel: Hashable, Sendable, Identifiable {
    public var id: String
    public var exercise: String
    /// "3 sets · 8, 8, 6 reps · 60 kg"
    public var detail: String
}

public struct ActivityDetailModel: Hashable, Sendable {
    public var id: String
    public var sport: Sport
    public var title: String
    /// "Saturday 21 November 2026 · 09:26"
    public var whenText: String
    /// "Ride · road · Garmin"
    public var kindText: String
    /// four hero figures, per sport
    public var figures: [KeyFigure]
    /// everything else with a value (compact grid)
    public var moreFigures: [KeyFigure]
    public var plan: PlanComparisonModel?
    public var laps: LapTableModel?
    public var zones: [ZoneSetModel]
    public var peaks: [PeakRowModel]
    /// "Best efforts" (run/swim/row distances) — shown under peaks
    public var efforts: [PeakRowModel]
    public var strength: [StrengthExerciseModel]
    public var isKey: Bool
    public var intensity: IntensityClass
    public var intensityIsAuto: Bool
    /// "Auto · Tempo"
    public var intensityAutoLabel: String
    public var rpe: Int?
    public var feel: Int?
    public var note: String

    public init(detail d: ActivityDetail, units: UnitSystem) {
        let a = d.activity
        id = a.id
        sport = a.sport
        title = a.title.isEmpty ? a.sport.label : a.title
        var when = Format.dateLong(a.localDate, withYear: true)
        if let time = SessionLine.localTime(startedAt: a.startedAt, utcOffsetMin: a.utcOffsetMin) { when += Format.dot + time }
        whenText = when
        var kind = [a.sport.label]
        if let sub = a.subSport, sub != .unknown { kind.append(ActivityDetailModel.subSportLabel(sub)) }
        if a.source == .garmin { kind.append("Garmin") }
        kindText = kind.joined(separator: Format.dot)
        let all = ActivityDetailModel.figures(d, units: units)
        figures = Array(all.prefix(4))
        moreFigures = Array(all.dropFirst(4))
        plan = ActivityDetailModel.plan(d)
        laps = ActivityDetailModel.lapTable(d.laps, sport: a.sport, units: units)
        zones = ActivityDetailModel.zoneSets(d.zones, sport: a.sport, units: units)
        peaks = ActivityDetailModel.peakRows(d.peaks, sport: a.sport, units: units)
        efforts = ActivityDetailModel.effortRows(d.peaks.efforts, sport: a.sport, units: units)
        strength = ActivityDetailModel.strengthRows(d.strengthSets ?? [], units: units)
        isKey = a.isKey
        intensity = a.intensity
        intensityIsAuto = a.intensityOverride == nil
        intensityAutoLabel = "Auto\(Format.dot)\(a.intensityAuto.label)"
        rpe = a.rpe
        feel = a.feel
        note = a.postNote ?? ""
    }

    public static func subSportLabel(_ s: SubSport) -> String {
        switch s {
        case .roadRun: return "road"
        case .openWater: return "open water"
        case .onWater: return "on water"
        case .mtb: return "MTB"
        case .hiit: return "HIIT"
        default: return s.rawValue
        }
    }

    // MARK: figures

    /// "+8% vs last time" when both values exist and the previous one is non-zero.
    static func versus(_ value: Double?, _ prev: Double?) -> String? {
        guard let value, let prev, prev != 0, value.isFinite, prev.isFinite else { return nil }
        return "\(Format.percent(value / prev - 1, signed: true)) vs last time"
    }

    /// "4 s faster than last time" / "12 s slower than last time" / "same pace as last time" (per pace unit).
    static func paceVersus(_ mps: Double, _ prev: Double?, sport: Sport, units: UnitSystem) -> String? {
        guard let prev, prev > 0, mps > 0 else { return nil }
        let basis = Format.paceBasis(sport: sport, units: units).metres
        let diff = (basis / mps - basis / prev).rounded()
        if diff == 0 { return "same pace as last time" }
        return "\(Format.number(abs(diff)))\(Format.unitSpace)s \(diff < 0 ? "faster" : "slower") than last time"
    }

    public static func loadSourceText(_ s: LoadSource) -> String {
        switch s {
        case .power: return "from power"
        case .pace: return "from pace"
        case .swimPace: return "from swim pace"
        case .hr: return "from heart rate"
        case .rpe: return "estimated from RPE"
        case .duration: return "estimated from duration"
        case .device: return "from the device"
        case .manual: return "set by you"
        case .unknown: return ""
        }
    }

    static func figures(_ d: ActivityDetail, units: UnitSystem) -> [KeyFigure] {
        let a = d.activity
        let p = d.previousSimilar
        let sport = a.sport
        func time(_ x: Activity) -> Double { x.displayDurationSec }
        let moving = a.movingSec > 0 && a.movingSec < a.durationSec - 60
        let dur = KeyFigure(id: "duration", label: moving ? "Moving time" : "Duration", value: Format.duration(time(a), style: .hms),
                            context: versus(time(a), p.map(time)))
        let distParts = Format.distanceParts(a.distanceM, sport: sport, units: units)
        let dist: KeyFigure? = (a.distanceM ?? 0) > 0
            ? KeyFigure(id: "distance", label: "Distance", value: distParts.value, unit: distParts.unit, context: versus(a.distanceM, p?.distanceM))
            : nil
        let src = loadSourceText(a.loadSource)
        let load = KeyFigure(id: "load", label: "Load", value: Format.load(a.load), context: src.isEmpty ? nil : src)
        func pace(_ label: String, _ mps: Double?, _ prev: Double?) -> KeyFigure? {
            guard let mps, mps > 0 else { return nil }
            let parts = Format.paceParts(mps, sport: sport, units: units)
            return KeyFigure(id: label.lowercased(), label: label, value: parts.value, unit: parts.unit,
                             context: paceVersus(mps, prev, sport: sport, units: units))
        }
        func num(_ id: String, _ label: String, _ v: Double?, unit: String = "", decimals: Int = 0, prev: Double? = nil) -> KeyFigure? {
            guard let v, v.isFinite, v > 0 else { return nil }
            return KeyFigure(id: id, label: label, value: Format.number(v, decimals: decimals), unit: unit, context: versus(v, prev))
        }
        let avgHr = num("avgHr", "Avg HR", a.avgHr, unit: "bpm", prev: p?.avgHr)
        let maxHr = num("maxHr", "Max HR", a.maxHr, unit: "bpm")
        let elevUnit = units == .imperial ? "ft" : "m"
        let elev = num("elev", "Elevation", a.elevationGainM.map { units == .imperial ? $0 / Format.metresPerFoot : $0 }, unit: elevUnit)
        let cals = num("cal", "Calories", a.calories, unit: "kcal")
        let speed = a.avgSpeedMps.flatMap { v -> KeyFigure? in
            guard v > 0 else { return nil }
            let s = Format.speedParts(v, units: units)
            return KeyFigure(id: "speed", label: "Speed", value: s.value, unit: s.unit, context: versus(v, p?.avgSpeedMps))
        }

        var head: [KeyFigure?]
        var tail: [KeyFigure?]
        switch sport {
        case .bike:
            head = [dur, dist, load, num("if", "Intensity", a.intensityFactor, decimals: 2, prev: p?.intensityFactor)]
            tail = [num("wp", "Weighted power", a.weightedPower, unit: "W", prev: p?.weightedPower),
                    num("avgP", "Avg power", a.avgPower, unit: "W", prev: p?.avgPower),
                    avgHr, maxHr, speed, num("cad", "Cadence", a.avgCadence, unit: "rpm"), elev,
                    num("work", "Work", a.workKj, unit: "kJ"), cals]
        case .run, .walk, .hike:
            head = [dur, dist, load, pace("Pace", a.avgSpeedMps, p?.avgSpeedMps)]
            tail = [sport == .run ? pace("Adjusted pace", a.adjustedSpeedMps, p?.adjustedSpeedMps) : nil,
                    avgHr, maxHr, num("cad", "Cadence", a.avgCadence, unit: "spm"), elev,
                    num("avgP", "Run power", a.avgPower, unit: "W"), cals]
        case .swim:
            head = [dist, dur, load, pace("Pace", a.avgSpeedMps, p?.avgSpeedMps)]
            tail = [num("swolf", "SWOLF", a.avgSwolf), num("strokes", "Strokes", a.strokes),
                    num("pool", "Pool length", a.poolLengthM, unit: "m"), avgHr, cals]
        case .row:
            head = [dist, dur, load, pace("Split", a.avgSpeedMps, p?.avgSpeedMps)]
            tail = [num("avgP", "Avg power", a.avgPower, unit: "W", prev: p?.avgPower),
                    num("rate", "Stroke rate", a.avgCadence, unit: "spm"), avgHr, maxHr, cals]
        case .strength:
            let vol = a.volumeKg.map { units == .imperial ? $0 / Format.kgPerPound : $0 }
            head = [dur, num("sets", "Sets", a.totalSets, prev: p?.totalSets), num("reps", "Reps", a.totalReps, prev: p?.totalReps),
                    num("vol", "Volume", vol, unit: units == .imperial ? "lb" : "kg", prev: p?.volumeKg.map { units == .imperial ? $0 / Format.kgPerPound : $0 })]
            tail = [load, avgHr, maxHr, cals]
        default:
            head = [dur, dist, load, avgHr]
            tail = [maxHr, elev, cals]
        }
        // hero = first four that exist (falling back to tail figures), then the rest
        var all = (head + tail).compactMap { $0 }
        var seen = Set<String>()
        all = all.filter { seen.insert($0.id).inserted }
        return all
    }

    // MARK: plan

    static func plan(_ d: ActivityDetail) -> PlanComparisonModel? {
        guard let w = d.plannedWorkout, let c = d.activity.compliance ?? w.compliance else { return nil }
        let label: String
        switch c.state {
        case .onTarget: label = "On plan"
        default: label = c.state.deviationLabel ?? "Done"
        }
        let what: String
        switch c.metric {
        case .duration: what = "planned time"
        case .distance: what = "planned distance"
        default: what = "planned load"
        }
        return PlanComparisonModel(workoutId: w.id, workoutTitle: w.title.isEmpty ? w.sport.label : w.title, stateLabel: label,
                                   detail: "\(Format.percent(c.ratio)) of \(what)", fraction: min(1, max(0, c.ratio)), isOver: c.ratio > 1)
    }

    // MARK: laps

    static func lapTable(_ laps: [Lap], sport: Sport, units: UnitSystem) -> LapTableModel? {
        guard laps.count > 1 else { return nil }
        let hasPower = laps.contains { ($0.avgPower ?? 0) > 0 }
        let hasHr = laps.contains { ($0.avgHr ?? 0) > 0 }
        let hasDist = laps.contains { ($0.distanceM ?? 0) > 0 }
        let pacey = Format.usesPace(sport)
        let showPower = hasPower && (sport == .bike || sport == .row)
        var cols = ["Lap", "Time"]
        if hasDist { cols.append("Distance") }
        if showPower { cols.append("Power") } else if laps.contains(where: { ($0.avgSpeedMps ?? 0) > 0 }) { cols.append(pacey ? "Pace" : "Speed") }
        if hasHr { cols.append("HR") }
        let rows = laps.map { l -> LapRowModel in
            var cells = ["\(l.index + 1)", Format.duration(l.movingSec ?? l.durationSec, style: .hms)]
            if hasDist { cells.append(Format.distance(l.distanceM, sport: sport, units: units)) }
            if cols.contains("Power") { cells.append(Format.power(l.avgPower)) }
            else if cols.contains("Pace") { cells.append(Format.paceParts(l.avgSpeedMps, sport: sport, units: units).value) }
            else if cols.contains("Speed") { cells.append(Format.speedParts(l.avgSpeedMps, units: units).value) }
            if hasHr { cells.append(Format.number(l.avgHr)) }
            return LapRowModel(id: l.index, cells: cells, isRest: l.isRest ?? false)
        }
        return LapTableModel(columns: cols, rows: rows)
    }

    // MARK: zones

    static func zoneSets(_ z: ActivityZones, sport: Sport, units: UnitSystem) -> [ZoneSetModel] {
        var out: [ZoneSetModel] = []
        func make(_ id: String, _ title: String, _ zones: [ZoneTime]?, range: (ZoneTime) -> String?) {
            guard let zones, !zones.isEmpty else { return }
            let total = zones.reduce(0) { $0 + $1.seconds }
            guard total > 0 else { return }
            let maxSec = zones.map(\.seconds).max() ?? 1
            let bars = zones.sorted { $0.zone < $1.zone }.map { zt in
                ZoneBarModel(zone: zt.zone, name: zt.name, timeText: Format.duration(zt.seconds, style: .hms),
                             shareText: Format.percent(zt.seconds / total), share: zt.seconds / total,
                             fraction: maxSec > 0 ? zt.seconds / maxSec : 0, rangeText: range(zt))
            }
            out.append(ZoneSetModel(id: id, title: title, bars: bars))
        }
        func span(_ zt: ZoneTime, unit: String, fmt: (Double) -> String) -> String? {
            switch (zt.low, zt.high) {
            case let (lo?, hi?): return "\(fmt(lo))\(Format.enDash)\(fmt(hi))\(Format.unitSpace)\(unit)"
            case let (nil, hi?): return "< \(fmt(hi))\(Format.unitSpace)\(unit)"
            case let (lo?, nil): return "> \(fmt(lo))\(Format.unitSpace)\(unit)"
            default: return nil
            }
        }
        make("power", "Power", z.power) { span($0, unit: "W") { Format.number($0) } }
        make("hr", "Heart rate", z.hr) { span($0, unit: "bpm") { Format.number($0) } }
        let basis = Format.paceBasis(sport: sport, units: units).label
        make("pace", "Pace", z.pace) { zt in
            // faster pace = higher m/s: show slow–fast
            switch (zt.low, zt.high) {
            case let (lo?, hi?): return "\(Format.paceParts(lo, sport: sport, units: units).value)\(Format.enDash)\(Format.paceParts(hi, sport: sport, units: units).value)\(Format.unitSpace)\(basis)"
            default: return nil
            }
        }
        return out
    }

    // MARK: peaks

    static let peakDurations: [Double] = [5, 60, 300, 1200, 3600]

    public static func durationLabel(_ sec: Double) -> String {
        if sec < 60 { return "\(Int(sec)) s" }
        if sec < 3600 || Int(sec) % 3600 != 0 { return "\(Int((sec / 60).rounded())) min" }
        return "\(Int(sec / 3600)) h"
    }

    static func peakRows(_ p: ActivityPeaks, sport: Sport, units: UnitSystem) -> [PeakRowModel] {
        var out: [PeakRowModel] = []
        if let power = p.power, !power.isEmpty {
            for d in peakDurations {
                if let pt = power.first(where: { $0.durationSec == d }) {
                    out.append(PeakRowModel(id: "p\(Int(d))", label: durationLabel(d), value: Format.power(pt.value)))
                }
            }
        } else if let speed = p.speed, !speed.isEmpty, Format.usesPace(sport) {
            for d in peakDurations {
                if let pt = speed.first(where: { $0.durationSec == d }) {
                    out.append(PeakRowModel(id: "s\(Int(d))", label: durationLabel(d), value: Format.pace(pt.value, sport: sport, units: units)))
                }
            }
        } else if let hr = p.hr, !hr.isEmpty {
            for d in peakDurations {
                if let pt = hr.first(where: { $0.durationSec == d }) {
                    out.append(PeakRowModel(id: "h\(Int(d))", label: durationLabel(d), value: Format.heartRate(pt.value)))
                }
            }
        }
        return out
    }

    static func effortRows(_ efforts: [BestEffort]?, sport: Sport, units: UnitSystem) -> [PeakRowModel] {
        guard let efforts else { return [] }
        return efforts.sorted { $0.distanceM < $1.distanceM }.map { e in
            PeakRowModel(id: "e\(Int(e.distanceM))", label: effortLabel(e.distanceM, sport: sport, units: units),
                         value: Format.duration(e.timeSec, style: .hms))
        }
    }

    /// 21097.5 → "Half marathon", 42195 → "Marathon", 1609 → "1 mile", else "5 km" / "400 m".
    public static func effortLabel(_ m: Double, sport: Sport, units: UnitSystem) -> String {
        if abs(m - 42_195) < 50 { return "Marathon" }
        if abs(m - 21_097.5) < 50 { return "Half marathon" }
        if abs(m - Format.metresPerMile) < 5 { return "1 mile" }
        if m < 1000 || sport == .swim || sport == .row { return "\(Format.number(m))\(Format.unitSpace)m" }
        return "\(Format.number(m / 1000, decimals: 1, trim: true))\(Format.unitSpace)km"
    }

    // MARK: strength

    static func strengthRows(_ sets: [StrengthSet], units: UnitSystem) -> [StrengthExerciseModel] {
        var order: [String] = []
        var groups: [String: [StrengthSet]] = [:]
        for s in sets where !(s.isRest ?? false) {
            if groups[s.exercise] == nil { order.append(s.exercise) }
            groups[s.exercise, default: []].append(s)
        }
        return order.map { ex in
            let g = groups[ex] ?? []
            var parts = ["\(g.count) set\(g.count == 1 ? "" : "s")"]
            let reps = g.compactMap(\.reps).map { Format.number($0) }
            if !reps.isEmpty { parts.append("\(reps.joined(separator: ", ")) reps") }
            if let w = g.compactMap(\.weightKg).max(), w > 0 { parts.append(Format.weight(w, units: units)) }
            return StrengthExerciseModel(id: ex, exercise: ex, detail: parts.joined(separator: Format.dot))
        }
    }
}

// MARK: - Effort scales (RPE, feel)

public enum EffortScale {
    /// RPE 1…10 wording.
    public static func rpeLabel(_ rpe: Int) -> String {
        switch rpe {
        case ...2: return "Very easy"
        case 3...4: return "Easy"
        case 5...6: return "Moderate"
        case 7...8: return "Hard"
        case 9: return "Very hard"
        default: return "Max effort"
        }
    }

    /// Feel 1 (awful) … 5 (great).
    public static func feelLabel(_ feel: Int) -> String {
        switch feel {
        case ...1: return "Awful"
        case 2: return "Bad"
        case 3: return "OK"
        case 4: return "Good"
        default: return "Great"
        }
    }

    public static let rpeValues = Array(1...10)
    public static let feelValues = Array(1...5)
}
