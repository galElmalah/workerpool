import Foundation

// The workout page (`Route.workout`): header, the plan's numbers (each once), the step structure as
// a clean list and a step-profile bar chart (height = intensity, tone = zone ramp).

public struct WorkoutStat: Hashable, Sendable, Identifiable {
    public var id: String { label }
    public var label: String
    public var value: String
    public var unit: String?
}

public struct StepRowModel: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable { case step, repeatHeader }

    public var id: String
    public var kind: Kind
    /// 0 top level, 1 inside a repeat, 2 inside a nested repeat
    public var depth: Int
    /// "Warm-up", "Sweet spot", "2 ×", "Back squat"
    public var title: String
    /// role word when the title is a custom label ("Interval")
    public var roleText: String?
    /// "20m", "400 m", "4 × 6"
    public var amountText: String
    /// "85–89% FTP", "Z2", "RPE 6–7"
    public var targetText: String?
    /// cue, swim stroke / send-off, strength load and rest
    public var note: String?
    /// zone-ramp tone for the leading mark (1…7); nil for repeat headers
    public var rampIndex: Int?
    public var accessibilityLabel: String
}

/// One bar of the profile chart, in fractions of the chart: x from `start`, `width` wide, `height` tall.
public struct ProfileBar: Hashable, Sendable, Identifiable {
    public var id: Int
    public var start: Double
    public var width: Double
    public var height: Double
    /// zone ramp 1…7
    public var rampIndex: Int
}

public struct StepProfile: Hashable, Sendable {
    public var bars: [ProfileBar]
    /// estimated seconds the profile spans
    public var totalSec: Double
    public var isEmpty: Bool { bars.isEmpty }
}

public struct WorkoutScreenModel: Hashable, Sendable {
    public var id: String
    public var sport: Sport
    /// "Ride · Indoor"
    public var sportText: String
    public var title: String
    /// "Tue 10 Nov · 18:30"
    public var dateLine: String
    /// "Tomorrow", "in 3 days"
    public var relativeText: String
    /// "Planned", "On plan", "Skipped · travel"
    public var statusText: String
    public var statusSymbol: String
    public var stats: [WorkoutStat]
    public var intensity: IntensityClass
    public var intensityText: String
    public var isKey: Bool
    public var description: String?
    public var preNote: String
    public var steps: [StepRowModel]
    public var profile: StepProfile
    /// "On your watch · sent 3 h ago"
    public var garminText: String?
    public var sendTitle: String
    public var canSendToWatch: Bool
    public var pairedActivityId: String?
    public var isSkipped: Bool
    public var tagsText: String?

    public static func build(_ w: PlannedWorkout, units: UnitSystem, today: LocalDate, now: Date = Date()) -> WorkoutScreenModel {
        let card = SessionCardModel(workout: w, activity: nil, units: units)
        var sportParts = [w.sport.label]
        if let sub = w.subSport, sub != .unknown, sub != .generic { sportParts.append(subSportLabel(sub)) }
        else if let env = w.environment.label { sportParts.append(env) }
        var stats: [WorkoutStat] = []
        if let d = w.plannedDurationSec, d > 0 { stats.append(WorkoutStat(label: "Duration", value: Format.duration(d, style: .clock))) }
        if w.sport.style.hasDistance, let m = w.plannedDistanceM, m > 0 {
            let p = Format.distanceParts(m, sport: w.sport, units: units)
            stats.append(WorkoutStat(label: "Distance", value: p.value, unit: p.unit))
        }
        if let l = w.plannedLoad, l > 0 { stats.append(WorkoutStat(label: "Load", value: Format.load(l))) }
        let structure = w.structure?.steps ?? []
        return WorkoutScreenModel(
            id: w.id,
            sport: w.sport,
            sportText: sportParts.joined(separator: Format.dot),
            title: card.title,
            dateLine: [Format.dateMedium(w.date), w.startTime.map { Format.clock($0) }].compactMap { $0 }.joined(separator: Format.dot),
            relativeText: Format.relativeDay(w.date, today: today),
            statusText: card.statusText,
            statusSymbol: card.statusSymbol,
            stats: stats,
            intensity: w.intensity,
            intensityText: w.intensity.label,
            isKey: w.isKey,
            description: w.description.flatMap { $0.isEmpty ? nil : $0 },
            preNote: w.preNote ?? "",
            steps: stepRows(structure, sport: w.sport, units: units),
            profile: profile(structure, sport: w.sport),
            garminText: w.garmin.statusText(now: now),
            sendTitle: w.garmin.sendButtonTitle,
            canSendToWatch: card.canSendToWatch,
            pairedActivityId: w.pairedActivityId,
            isSkipped: w.status == .skipped,
            tagsText: w.tags.isEmpty ? nil : w.tags.joined(separator: Format.dot)
        )
    }

    // MARK: Steps

    static func roleLabel(_ r: StepRole?) -> String {
        switch r {
        case .warmup?: return "Warm-up"
        case .active?: return "Interval"
        case .recovery?: return "Recovery"
        case .rest?: return "Rest"
        case .cooldown?: return "Cool-down"
        default: return "Step"
        }
    }

    public static func stepRows(_ nodes: [StructureNode], sport: Sport, units: UnitSystem, depth: Int = 0) -> [StepRowModel] {
        var rows: [StepRowModel] = []
        for n in nodes {
            if n.kind == .repeat {
                let count = max(1, n.count ?? 1)
                let children = n.steps ?? []
                let block = children.reduce(0.0) { $0 + stepSeconds($1, sport: sport) }
                let total = block * Double(count)
                let amount = total > 0 ? Format.duration(total, style: .short) : ""
                let title = "\(count) \u{00D7}"
                rows.append(StepRowModel(id: n.id, kind: .repeatHeader, depth: depth, title: title, roleText: n.label, amountText: amount,
                                         targetText: nil, note: nil, rampIndex: nil,
                                         accessibilityLabel: "Repeat \(count) times" + (amount.isEmpty ? "" : ", \(amount) in total")))
                rows.append(contentsOf: stepRows(children, sport: sport, units: units, depth: depth + 1))
            } else {
                rows.append(stepRow(n, sport: sport, units: units, depth: depth))
            }
        }
        return rows
    }

    static func stepRow(_ n: StructureNode, sport: Sport, units: UnitSystem, depth: Int) -> StepRowModel {
        let role = roleLabel(n.role)
        var title = role
        var roleText: String?
        if let s = n.strength, !s.exercise.isEmpty { title = s.exercise }
        else if let label = n.label, !label.isEmpty { title = label; roleText = label == role ? nil : role }
        let amount = amountText(n, sport: sport, units: units)
        let target = n.target.flatMap { targetText($0, sport: sport, units: units) }
        var notes: [String] = []
        if let cue = n.cue, !cue.isEmpty { notes.append(cue) }
        if let swim = n.swim {
            if let stroke = swim.stroke, stroke != .unknown, stroke != .choice { notes.append(strokeLabel(stroke)) }
            if let send = swim.sendOffSec, send > 0 { notes.append("on \(Format.duration(send, style: .hms))") }
            if let rest = swim.restSec, rest > 0 { notes.append("\(Format.duration(rest, style: .short)) rest") }
        }
        if let row = n.row, let lo = row.strokeRateLow {
            notes.append("\(range(lo, row.strokeRateHigh ?? lo)) spm")
        }
        if let s = n.strength {
            if let kg = s.weightKg, kg > 0 { notes.append(Format.weight(kg, units: units)) }
            if let rpe = s.rpe { notes.append("RPE \(Format.number(rpe, decimals: 1, trim: true))") }
            if let rest = s.restSec, rest > 0 { notes.append("rest \(Format.duration(rest, style: .hms))") }
        }
        let ramp = zoneIndex(intensityFraction(n.target, role: n.role, sport: sport))
        var spoken = [title, amount]
        if let target { spoken.append(target) }
        spoken.append(contentsOf: notes)
        return StepRowModel(id: n.id, kind: .step, depth: depth, title: title, roleText: roleText, amountText: amount,
                            targetText: target, note: notes.isEmpty ? nil : notes.joined(separator: Format.dot),
                            rampIndex: sport == .strength ? nil : ramp,
                            accessibilityLabel: spoken.filter { !$0.isEmpty }.joined(separator: ", "))
    }

    /// "20m", "400 m", "4 × 6", "Lap button"
    static func amountText(_ n: StructureNode, sport: Sport, units: UnitSystem) -> String {
        if let s = n.strength {
            if let reps = s.reps { return "\(s.sets) \u{00D7} \(reps)" }
            if let d = s.durationSec { return "\(s.sets) \u{00D7} \(Format.duration(d, style: .short))" }
            return "\(s.sets) sets"
        }
        guard let m = n.measure else { return "" }
        switch m.type {
        case .time: return Format.duration(m.sec ?? 0, style: .short)
        case .distance:
            let metres = m.m ?? 0
            if sport != .swim && sport != .row && metres < 1000 && units != .imperial {
                return Format.number(metres) + Format.unitSpace + "m"
            }
            return Format.distance(metres, sport: sport, units: units)
        case .reps: return "\(m.n ?? 0) reps"
        case .lapButton: return "Lap button"
        case .unknown: return ""
        }
    }

    static func range(_ a: Double, _ b: Double) -> String {
        let lo = Format.number(min(a, b), decimals: 1, trim: true)
        let hi = Format.number(max(a, b), decimals: 1, trim: true)
        return lo == hi ? lo : lo + Format.enDash + hi
    }

    /// Short target copy (core/workout/title.ts `targetShort`, without zone matching).
    public static func targetText(_ t: Target, sport: Sport, units: UnitSystem) -> String? {
        let lo = t.low ?? 0
        let hi = t.high ?? lo
        switch t.type {
        case .open: return "Open"
        case .powerPct: return "\(range(lo, hi))% " + (sport == .row ? "threshold" : "FTP")
        case .powerW: return "\(range(lo, hi))\(Format.unitSpace)W"
        case .hrZone: return "HR Z\(t.zone ?? 1)"
        case .hrPctLthr: return "\(range(lo, hi))% LTHR"
        case .hrBpm: return "\(range(lo, hi))\(Format.unitSpace)bpm"
        case .pace:
            guard let a = t.lowMps, let b = t.highMps else { return nil }
            let fast = Format.paceParts(max(a, b), sport: sport, units: units)
            let slow = Format.paceParts(min(a, b), sport: sport, units: units)
            let value = fast.value == slow.value ? fast.value : fast.value + Format.enDash + slow.value
            return value + Format.unitSpace + fast.unit
        case .pacePct:
            if sport == .swim { return lo == 100 && hi == 100 ? "CSS" : "\(range(lo, hi))% CSS" }
            return "\(range(lo, hi))% pace"
        case .rpe: return "RPE \(range(lo, hi))"
        case .cadence: return "\(range(lo, hi)) \(sport == .run ? "spm" : "rpm")"
        case .ramp:
            let suffix = t.basis == "hr_pct_lthr" ? " LTHR" : (t.basis == "pace_pct" && sport != .swim ? " pace" : "")
            return "\(Format.number(t.from ?? 0, decimals: 1, trim: true))\u{2192}\(Format.number(t.to ?? 0, decimals: 1, trim: true))%" + suffix
        case .unknown: return nil
        }
    }

    // MARK: Profile

    /// Rough intensity as a fraction of threshold (1.0 = threshold) for drawing only.
    static func intensityFraction(_ t: Target?, role: StepRole?, sport: Sport) -> Double {
        func roleDefault() -> Double {
            switch role {
            case .warmup?: return 0.6
            case .active?: return 0.85
            case .recovery?: return 0.5
            case .rest?: return 0.3
            case .cooldown?: return 0.55
            default: return 0.65
            }
        }
        guard let t else { return roleDefault() }
        let mid = ((t.low ?? 0) + (t.high ?? t.low ?? 0)) / 2
        switch t.type {
        case .powerPct, .pacePct, .hrPctLthr: return mid > 0 ? mid / 100 : roleDefault()
        case .hrZone:
            let byZone: [Double] = [0.75, 0.85, 0.92, 0.97, 1.03, 1.08, 1.15]
            return byZone[min(6, max(0, (t.zone ?? 1) - 1))]
        case .rpe: return mid > 0 ? 0.4 + mid * 0.08 : roleDefault()
        case .ramp: return ((t.from ?? 0) + (t.to ?? 0)) / 200
        default: return roleDefault()
        }
    }

    /// Zone-ramp tone for an intensity fraction (≈ Coggan power zones).
    public static func zoneIndex(_ fraction: Double) -> Int {
        let limits: [Double] = [0.56, 0.76, 0.91, 1.06, 1.21, 1.5]
        for (i, limit) in limits.enumerated() where fraction < limit { return i + 1 }
        return 7
    }

    /// Seconds a step takes (distance at a typical speed for the sport; reps ≈ 40 s a set).
    static func stepSeconds(_ n: StructureNode, sport: Sport) -> Double {
        if n.kind == .repeat {
            let block = (n.steps ?? []).reduce(0.0) { $0 + stepSeconds($1, sport: sport) }
            return block * Double(max(1, n.count ?? 1))
        }
        if let s = n.strength {
            let work = s.durationSec ?? Double(s.reps ?? 8) * 4
            return Double(s.sets) * (work + (s.restSec ?? 0))
        }
        guard let m = n.measure else { return 60 }
        switch m.type {
        case .time: return max(0, m.sec ?? 0)
        case .distance:
            let speed: Double
            switch sport {
            case .swim: speed = 1.2
            case .row: speed = 4.2
            case .bike: speed = 8.3
            case .run: speed = 3.3
            default: speed = 1.4
            }
            return max(0, (m.m ?? 0) / speed) + (n.swim?.restSec ?? 0)
        case .reps: return Double(m.n ?? 0) * 4
        case .lapButton: return 300
        case .unknown: return 60
        }
    }

    /// Bars for the profile chart. Repeats are expanded; ramps become a staircase of six bars.
    public static func profile(_ nodes: [StructureNode], sport: Sport) -> StepProfile {
        guard sport != .strength else { return StepProfile(bars: [], totalSec: 0) }
        var blocks: [(sec: Double, from: Double, to: Double)] = []
        func walk(_ list: [StructureNode]) {
            for n in list {
                if n.kind == .repeat {
                    for _ in 0..<max(1, n.count ?? 1) { walk(n.steps ?? []) }
                } else {
                    let sec = stepSeconds(n, sport: sport)
                    guard sec > 0 else { continue }
                    if let t = n.target, t.type == .ramp {
                        blocks.append((sec, (t.from ?? 0) / 100, (t.to ?? 0) / 100))
                    } else {
                        let f = intensityFraction(n.target, role: n.role, sport: sport)
                        blocks.append((sec, f, f))
                    }
                }
            }
        }
        walk(nodes)
        let total = blocks.reduce(0.0) { $0 + $1.sec }
        guard total > 0 else { return StepProfile(bars: [], totalSec: 0) }
        let top = 1.3
        func height(_ f: Double) -> Double { min(1, max(0.08, f / top)) }
        var bars: [ProfileBar] = []
        var t = 0.0
        for b in blocks {
            let pieces = b.from == b.to ? 1 : 6
            let w = b.sec / Double(pieces)
            for k in 0..<pieces {
                let f = pieces == 1 ? b.from : b.from + (b.to - b.from) * (Double(k) + 0.5) / Double(pieces)
                bars.append(ProfileBar(id: bars.count, start: t / total, width: w / total, height: height(f), rampIndex: zoneIndex(f)))
                t += w
            }
        }
        return StepProfile(bars: bars, totalSec: total)
    }

    // MARK: Labels

    static func strokeLabel(_ s: SwimStroke) -> String {
        switch s {
        case .free: return "Freestyle"
        case .back: return "Backstroke"
        case .breast: return "Breaststroke"
        case .fly: return "Butterfly"
        case .im: return "IM"
        case .choice: return "Choice"
        case .kick: return "Kick"
        case .drill: return "Drill"
        case .unknown: return ""
        }
    }

    public static func subSportLabel(_ s: SubSport) -> String {
        switch s {
        case .road, .roadRun: return "Road"
        case .indoor: return "Indoor"
        case .mtb: return "MTB"
        case .gravel: return "Gravel"
        case .virtual: return "Virtual"
        case .trail: return "Trail"
        case .treadmill: return "Treadmill"
        case .track: return "Track"
        case .pool: return "Pool"
        case .openWater: return "Open water"
        case .erg: return "Erg"
        case .onWater: return "On water"
        case .gym: return "Gym"
        case .bodyweight: return "Bodyweight"
        case .mobility: return "Mobility"
        case .hiit: return "HIIT"
        case .generic, .unknown: return "General"
        }
    }
}
