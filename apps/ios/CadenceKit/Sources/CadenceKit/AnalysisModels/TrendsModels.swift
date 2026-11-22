import Foundation

// Trends screen view-models: range, headline figures, Fitness/Fatigue/Form series (with the
// projection), weekly volume, week-over-week progression (sentence + delta bars), intensity
// distribution and the consistency heatmap. x values on day-based charts are days since
// 1970-01-01 (`Day.daysSinceEpoch`), so no time zone is involved.

public enum TrendRange: String, CaseIterable, Hashable, Sendable, Identifiable {
    case sixWeeks = "6W"
    case twelveWeeks = "12W"
    case sixMonths = "6M"
    case oneYear = "1Y"

    public var id: String { rawValue }
    /// short label for the segmented picker
    public var label: String { rawValue }
    public var weeks: Int {
        switch self {
        case .sixWeeks: return 6
        case .twelveWeeks: return 12
        case .sixMonths: return 26
        case .oneYear: return 52
        }
    }

    public var title: String {
        switch self {
        case .sixWeeks: return "Last 6 weeks"
        case .twelveWeeks: return "Last 12 weeks"
        case .sixMonths: return "Last 6 months"
        case .oneYear: return "Last 12 months"
        }
    }

    public var accessibilityLabel: String { title }

    /// First day shown: Monday of the week `weeks − 1` before today's week.
    public func startDay(today: Day) -> Day { today.weekStart.adding(days: -7 * (weeks - 1)) }

    /// "Last 12 weeks · 31 Aug – 22 Nov"
    public func subtitle(today: Day) -> String {
        let a = startDay(today: today)
        return "\(title)\(Format.dot)\(Format.dayMonth(a.string)) \(Format.enDash) \(Format.dayMonth(today.string))"
    }
}

/// What the volume and progression charts measure.
public enum VolumeMetric: String, CaseIterable, Hashable, Sendable, Identifiable {
    case hours, load, distance

    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .hours: return "Hours"
        case .load: return "Load"
        case .distance: return "Distance"
        }
    }

    public func value(_ w: WeekSummary, units: UnitSystem) -> Double {
        switch self {
        case .hours: return w.doneSec / 3600
        case .load: return w.doneLoad
        case .distance: return w.doneDistanceM / (units == .imperial ? Format.metresPerMile : 1000)
        }
    }

    /// WoW fraction from the server (nil when the previous week is zero).
    public func wow(_ w: WeekSummary) -> Double? {
        switch self {
        case .hours: return w.wowSec
        case .load: return w.wowLoad
        case .distance: return w.wowDistanceM
        }
    }

    /// "7:48 h", "464", "57 km"
    public func format(_ v: Double, units: UnitSystem) -> String {
        switch self {
        case .hours: return Format.duration(v * 3600, style: .clock) + Format.unitSpace + "h"
        case .load: return Format.number(v)
        case .distance: return Format.number(v) + Format.unitSpace + (units == .imperial ? "mi" : "km")
        }
    }

    /// Short axis label: "10h", "500", "80 km"
    public func axisLabel(_ v: Double, units: UnitSystem) -> String {
        switch self {
        case .hours: return Format.number(v, decimals: 1, trim: true) + "h"
        case .load: return Format.number(v)
        case .distance: return Format.number(v) + Format.unitSpace + (units == .imperial ? "mi" : "km")
        }
    }
}

// MARK: - Headline

public enum TrendsHeadline {
    /// Hours, Load, Fitness, Form for the current week, each with its week-over-week change.
    /// `weeks` oldest → newest (last = current week); `fitness` days (may include projected days).
    public static func figures(weeks: [WeekSummary], fitness: [FitnessDay], today: LocalDate) -> [KeyFigure] {
        var out: [KeyFigure] = []
        let current = weeks.last { $0.startDate <= today && today <= $0.endDate } ?? weeks.last
        let previous = current.flatMap { c in weeks.last { $0.endDate < c.startDate } }
        if let c = current {
            out.append(KeyFigure(id: "hours", label: "Hours this week", value: Format.duration(c.doneSec, style: .clock), unit: "h",
                                 context: previous.map { "last week \(Format.duration($0.doneSec, style: .clock))" }))
            out.append(KeyFigure(id: "load", label: "Load this week", value: Format.load(c.doneLoad),
                                 context: previous.map { "last week \(Format.load($0.doneLoad))" }))
        }
        let actual = fitness.filter { !$0.projected && $0.date <= today }
        if let t = actual.last {
            let weekAgo = actual.last { $0.date <= (Day(today)?.adding(days: -7).string ?? today) }
            let ramp = t.ramp ?? weekAgo.map { t.fitness - $0.fitness }
            out.append(KeyFigure(id: "fitness", label: "Fitness", value: Format.fitness(t.fitness),
                                 context: ramp.map { "\(Format.signed($0)) in 7 days" }))
            var ctx: [String] = []
            if let w = weekAgo { ctx.append("\(Format.signed(t.form - w.form)) in 7 days") }
            if let z = t.formZone ?? t.formPct.map({ FormZone.of(formPct: $0) }), z != .unknown { ctx.append(z.label) }
            out.append(KeyFigure(id: "form", label: "Form", value: Format.form(t.form),
                                 context: ctx.isEmpty ? nil : ctx.joined(separator: Format.dot)))
        }
        return out
    }
}

// MARK: - Fitness chart

public enum FitnessSeriesKind: String, CaseIterable, Hashable, Sendable {
    case fitness, fatigue, form

    public var label: String {
        switch self {
        case .fitness: return "Fitness"
        case .fatigue: return "Fatigue"
        case .form: return "Form"
        }
    }
}

public struct FitnessSeries: Hashable, Sendable, Identifiable {
    /// "fitness", "fitness-projected" … (use as the chart `series` value)
    public var id: String
    public var kind: FitnessSeriesKind
    public var projected: Bool
    public var points: [XYPoint]
}

public struct ChartMarker: Hashable, Sendable, Identifiable {
    public var id: String
    public var x: Double
    public var label: String
    /// A races are emphasised (fg1), B/C quieter
    public var isPrimary: Bool
}

public struct FitnessChartModel: Hashable, Sendable {
    public var series: [FitnessSeries]
    public var markers: [ChartMarker]
    public var todayX: Double
    public var xDomain: ClosedRange<Double>
    public var yDomain: ClosedRange<Double>
    public var xTicks: [ChartTick]
    public var yTicks: [ChartTick]
    /// direct labels at the right end: last value per kind
    public var endLabels: [FitnessSeriesKind: Double]
    /// "Fitness rose 3 in 12 weeks, to 66. Dashed lines follow the plan to Riu Ter Half on 27 Dec."
    public var sentence: String
    private var days: [FitnessDay]

    public var isEmpty: Bool { series.allSatisfy { $0.points.isEmpty } }

    public init(trend: FitnessTrend, range: TrendRange) {
        let today = Day(trend.today) ?? Day(year: 2000, month: 1, day: 1)!
        let start = range.startDay(today: today)
        // projection: up to 4 weeks ahead for short ranges, 8 for longer ones
        let ahead = range.weeks <= 12 ? 28 : 56
        let end = today.adding(days: ahead)
        let days = trend.days.filter { d in
            guard let x = Day(d.date) else { return false }
            return x >= start && x <= end
        }
        self.days = days
        let todayX = Double(today.daysSinceEpoch)
        self.todayX = todayX
        func pts(_ kind: FitnessSeriesKind, projected: Bool) -> [XYPoint] {
            days.compactMap { d -> XYPoint? in
                guard let day = Day(d.date) else { return nil }
                let x = Double(day.daysSinceEpoch)
                // the projected line starts at today's actual value so the two lines join
                if projected ? (!d.projected && x != todayX) : d.projected { return nil }
                let y: Double
                switch kind {
                case .fitness: y = d.fitness
                case .fatigue: y = d.fatigue
                case .form: y = d.form
                }
                return XYPoint(x: x, y: y)
            }
        }
        var series: [FitnessSeries] = []
        for kind in FitnessSeriesKind.allCases {
            series.append(FitnessSeries(id: kind.rawValue, kind: kind, projected: false, points: pts(kind, projected: false)))
            let proj = pts(kind, projected: true)
            if proj.count > 1 { series.append(FitnessSeries(id: kind.rawValue + "-projected", kind: kind, projected: true, points: proj)) }
        }
        self.series = series
        let lastX = days.compactMap { Day($0.date) }.last.map { Double($0.daysSinceEpoch) } ?? todayX
        self.xDomain = Double(start.daysSinceEpoch)...max(lastX, Double(start.daysSinceEpoch) + 1)
        let ys = series.flatMap { $0.points.map(\.y) }
        let lo = min(0, (ys.min() ?? 0)), hi = max(10, (ys.max() ?? 10))
        let pad = (hi - lo) * 0.06
        self.yDomain = (lo - pad)...(hi + pad)
        self.yTicks = ChartMath.niceTicks(lo: lo, hi: hi, maxCount: 3).map { ChartTick(value: $0, label: Format.number($0)) }
        self.xTicks = DayAxis.ticks(from: start, to: Day.fromChartX(lastX), weeks: range.weeks)
        self.markers = trend.events.compactMap { e -> ChartMarker? in
            guard let d = Day(e.date), d >= start, d <= end else { return nil }
            return ChartMarker(id: e.id, x: Double(d.daysSinceEpoch), label: e.name, isPrimary: e.priority == .a)
        }
        var ends: [FitnessSeriesKind: Double] = [:]
        if let t = days.last(where: { !$0.projected }) {
            ends[.fitness] = t.fitness; ends[.fatigue] = t.fatigue; ends[.form] = t.form
        }
        self.endLabels = ends
        self.sentence = FitnessChartModel.sentence(days: days, events: trend.events, today: today, range: range)
    }

    static func sentence(days: [FitnessDay], events: [Event], today: Day, range: TrendRange) -> String {
        let actual = days.filter { !$0.projected }
        guard let first = actual.first, let last = actual.last else { return "No fitness history in this range yet." }
        let delta = (last.fitness - first.fitness).rounded()
        let span = range.weeks >= 26 ? (range.weeks == 52 ? "12 months" : "6 months") : "\(range.weeks) weeks"
        var s: String
        if delta == 0 {
            s = "Fitness held at \(Format.fitness(last.fitness)) over \(span)."
        } else {
            s = "Fitness \(delta > 0 ? "rose" : "fell") \(Format.number(abs(delta))) in \(span), to \(Format.fitness(last.fitness))."
        }
        if days.contains(where: { $0.projected }) {
            let lastProjected = days.last { $0.projected }?.date ?? today.string
            if let race = events.filter({ $0.date > today.string && $0.date <= lastProjected }).sorted(by: { $0.date < $1.date }).first {
                s += " Dashed lines follow the plan to \(race.name) on \(Format.dayMonth(race.date))."
            } else {
                s += " Dashed lines follow the plan."
            }
        }
        return s
    }

    /// "Sat 21 Nov · Fitness 66 · Fatigue 72 · Form −2" (+ " · planned" for projected days).
    public func readout(at x: Double) -> String? {
        let xs = days.compactMap { Day($0.date).map { Double($0.daysSinceEpoch) } }
        guard xs.count == days.count, let i = ChartMath.nearestIndex(xs, to: x) else { return nil }
        let d = days[i]
        var s = "\(Format.dateMedium(d.date))\(Format.dot)Fitness \(Format.fitness(d.fitness))\(Format.dot)Fatigue \(Format.fitness(d.fatigue))\(Format.dot)Form \(Format.form(d.form))"
        if d.projected { s += "\(Format.dot)planned" }
        return s
    }

    /// x of the day nearest to `x` (snaps the selection rule to a real day).
    public func snappedX(_ x: Double) -> Double? {
        let xs = days.compactMap { Day($0.date).map { Double($0.daysSinceEpoch) } }
        guard let i = ChartMath.nearestIndex(xs, to: x) else { return nil }
        return xs[i]
    }

    public var accessibilitySummary: String { sentence }
}

extension Day {
    /// The day for a chart x value (days since 1970-01-01).
    public static func fromChartX(_ x: Double) -> Day {
        Day(year: 1970, month: 1, day: 1)!.adding(days: Int(x.rounded()))
    }

    /// x value for charts (days since 1970-01-01).
    public var chartX: Double { Double(daysSinceEpoch) }
}

/// Day-based x-axis ticks: month starts ("Sep") for long ranges, fortnightly dates for short ones.
public enum DayAxis {
    /// "Sep"; January carries the year: "Jan '27".
    public static func monthLabel(_ d: Day) -> String {
        let name = Format.monthsShort[d.month - 1]
        return d.month == 1 ? "\(name) '\(zeroPad(d.year % 100, 2))" : name
    }

    public static func ticks(from start: Day, to end: Day, weeks: Int) -> [ChartTick] {
        guard start < end else { return [] }
        var out: [ChartTick] = []
        if weeks <= 8 {
            var d = start.weekStart
            if d < start { d = d.adding(days: 7) }
            while d <= end {
                out.append(ChartTick(value: d.chartX, label: Format.dayMonth(d.string)))
                d = d.adding(days: 14)
            }
            return out
        }
        // first of each month (every other month for a year or more)
        let monthStep = weeks >= 40 ? 2 : 1
        var y = start.year, m = start.month
        var i = 0
        while let d = Day(year: y, month: m, day: 1), d <= end {
            if d >= start {
                if i % monthStep == 0 { out.append(ChartTick(value: d.chartX, label: monthLabel(d))) }
                i += 1
            }
            m += 1
            if m > 12 { m = 1; y += 1 }
        }
        return out
    }
}

// MARK: - Weekly volume

public struct VolumeBar: Hashable, Sendable, Identifiable {
    /// ISO week ("2026-W47") — also the chart's x category
    public var id: IsoWeek
    public var startDate: LocalDate
    /// "16 Nov" / "This week"
    public var label: String
    public var value: Double
    public var valueText: String
    public var isCurrent: Bool
}

/// One sport's share of a week's bar (stacked in `VolumeChartModel.sportOrder`).
public struct VolumeSegment: Hashable, Sendable, Identifiable {
    public var id: String { week + ":" + sport.rawValue }
    public var week: IsoWeek
    public var sport: Sport
    public var value: Double
    /// "Ride 2:00 h" (VoiceOver)
    public var accessibilityText: String
}

public struct VolumeChartModel: Hashable, Sendable {
    public var metric: VolumeMetric
    public var bars: [VolumeBar]
    /// per-sport stacks (DESIGN_V2 §8.1 order); a week without by-sport data gets one `.other` segment
    public var segments: [VolumeSegment]
    /// sports present, in stack order (for the legend)
    public var sports: [Sport]

    /// DESIGN_V2 §8.1 stack order
    public static let sportOrder: [Sport] = [.bike, .run, .swim, .walk, .strength, .hike, .row, .ski, .yoga, .other, .unknown]
    /// mean of the last 4 complete weeks
    public var average: Double?
    /// "7:36 h 4-wk avg"
    public var averageText: String?
    public var yDomain: ClosedRange<Double>
    public var yTicks: [ChartTick]
    /// the x categories that get an axis label (≤ 5)
    public var labelledWeeks: [IsoWeek]
    public var sentence: String

    public init(weeks all: [WeekSummary], range: TrendRange, metric: VolumeMetric, units: UnitSystem, today: LocalDate) {
        self.metric = metric
        let weeks = Array(all.suffix(range.weeks))
        let bars = weeks.map { w -> VolumeBar in
            let current = w.startDate <= today && today <= w.endDate
            let v = metric.value(w, units: units)
            return VolumeBar(id: w.isoWeek, startDate: w.startDate, label: current ? "This week" : Format.dayMonth(w.startDate),
                             value: v, valueText: metric.format(v, units: units), isCurrent: current)
        }
        self.bars = bars
        var segs: [VolumeSegment] = []
        var present = Set<Sport>()
        for w in weeks {
            var parts: [Sport: Double] = [:]
            for s in w.bySport {
                let v: Double
                switch metric {
                case .hours: v = s.doneSec / 3600
                case .load: v = s.doneLoad
                case .distance: v = s.doneDistanceM / (units == .imperial ? Format.metresPerMile : 1000)
                }
                if v > 0 { parts[s.sport, default: 0] += v }
            }
            let total = metric.value(w, units: units)
            let covered = parts.values.reduce(0, +)
            if total - covered > max(0.01, total * 0.01) { parts[.other, default: 0] += total - covered }
            for sport in VolumeChartModel.sportOrder {
                if let v = parts[sport] {
                    segs.append(VolumeSegment(week: w.isoWeek, sport: sport, value: v,
                                              accessibilityText: "\(sport.label) \(metric.format(v, units: units))"))
                    present.insert(sport)
                }
            }
        }
        segments = segs
        sports = VolumeChartModel.sportOrder.filter { present.contains($0) }
        let complete = bars.filter { !$0.isCurrent && $0.startDate <= today }
        let last4 = complete.suffix(4)
        let average: Double? = last4.isEmpty ? nil : last4.reduce(0) { $0 + $1.value } / Double(last4.count)
        self.average = average
        averageText = average.map { "\(metric.format($0, units: units)) 4-wk avg" }
        let hi = max(bars.map(\.value).max() ?? 0, average ?? 0, metric == .hours ? 1 : 10)
        yDomain = 0...(hi * 1.1)
        yTicks = ChartMath.niceTicks(lo: 0, hi: hi, maxCount: 3).map { ChartTick(value: $0, label: metric.axisLabel($0, units: units)) }
        let stride = max(1, Int((Double(bars.count) / 4).rounded(.up)))
        var labelled: [IsoWeek] = []
        var i = bars.count - 1
        while i >= 0 { labelled.append(bars[i].id); i -= stride }
        labelledWeeks = labelled.reversed()
        sentence = "Completed \(metric.label.lowercased()) per week, all sports. Tap a week to review it."
    }

    public func bar(_ week: IsoWeek?) -> VolumeBar? { bars.first { $0.id == week } }
}

// MARK: - Week-over-week progression

public struct WowBar: Hashable, Sendable, Identifiable {
    public var id: IsoWeek
    public var label: String
    /// fraction, e.g. 0.12 = +12 %
    public var delta: Double
    /// "+12%"
    public var deltaText: String
    /// above the +15 % caution line
    public var isCaution: Bool
    /// the most recent complete week (emphasised)
    public var isLatest: Bool
    /// `.warn` above the caution line, else neutral (shown with a symbol)
    public var tone: AnalysisTone { isCaution ? .warn : .neutral }
}

public struct ProgressionModel: Hashable, Sendable {
    public var metric: VolumeMetric
    /// "Hours rose 87% last week after a drop. That is above the +15 % caution line."
    public var sentence: String
    /// "Last week 10:51 h vs 5:48 h. The last 4 weeks averaged 7:36 h, −23% on the 4 before."
    public var detail: String?
    public var bars: [WowBar]
    public var yDomain: ClosedRange<Double>
    public var yTicks: [ChartTick]
    public var cautionLine: Double { ProgressionModel.caution }
    public var labelledWeeks: [IsoWeek]

    public static let caution = 0.15

    /// `weeks` oldest → newest; only complete weeks (ending before `today`) are compared.
    public init(weeks all: [WeekSummary], range: TrendRange, metric: VolumeMetric, units: UnitSystem, today: LocalDate) {
        self.metric = metric
        let complete = all.filter { $0.endDate < today }
        let inRange = Array(complete.suffix(range.weeks))
        let deltas: [(WeekSummary, Double)] = inRange.compactMap { w in metric.wow(w).map { (w, $0) } }
        let bars = deltas.enumerated().map { i, pair -> WowBar in
            WowBar(id: pair.0.isoWeek, label: Format.dayMonth(pair.0.startDate), delta: pair.1,
                   deltaText: Format.percent(pair.1, signed: true), isCaution: pair.1 > ProgressionModel.caution,
                   isLatest: i == deltas.count - 1 && pair.0.isoWeek == complete.last?.isoWeek)
        }
        self.bars = bars
        sentence = ProgressionModel.sentence(name: metric.label, deltas: inRange.map { metric.wow($0) })
        // detail: last week vs the one before; 4-week block vs the 4 before
        var detail: [String] = []
        if complete.count >= 2 {
            let a = complete[complete.count - 1], b = complete[complete.count - 2]
            detail.append("Last week \(metric.format(metric.value(a, units: units), units: units)) vs \(metric.format(metric.value(b, units: units), units: units)).")
        }
        if complete.count >= 8 {
            let recent = complete.suffix(4).map { metric.value($0, units: units) }
            let before = complete.dropLast(4).suffix(4).map { metric.value($0, units: units) }
            let r = recent.reduce(0, +) / 4, p = before.reduce(0, +) / 4
            var s = "The last 4 weeks averaged \(metric.format(r, units: units))"
            if p > 0 { s += ", \(Format.percent(r / p - 1, signed: true)) on the 4 before" }
            detail.append(s + ".")
        }
        self.detail = detail.isEmpty ? nil : detail.joined(separator: " ")
        let maxAbs = max(0.3, bars.map { abs($0.delta) }.max() ?? 0.3)
        let lim = min(maxAbs, 1.5) * 1.1
        yDomain = -lim...lim
        let step = ChartMath.niceStep(lim / 1.5)
        yTicks = [-step, 0, step].map { ChartTick(value: $0, label: $0 == 0 ? "0" : Format.percent($0, signed: true)) }
        let stride = max(1, Int((Double(bars.count) / 4).rounded(.up)))
        var labelled: [IsoWeek] = []
        var i = bars.count - 1
        while i >= 0 { labelled.append(bars[i].id); i -= stride }
        labelledWeeks = labelled.reversed()
    }

    /// Port of the web's `wowSentence`: "Load is up 3 weeks running: +6%, +9%, +4%." etc.
    /// `deltas` oldest → newest; nil entries (no previous week) are skipped.
    public static func sentence(name: String, deltas: [Double?]) -> String {
        let d = deltas.compactMap { $0 }
        guard let last = d.last else { return "Not enough history yet to compare \(name.lowercased()) week over week." }
        func sign(_ v: Double) -> Int { abs(v) < 0.02 ? 0 : (v > 0 ? 1 : -1) }
        let dir = sign(last)
        var run = 0
        for v in d.reversed() {
            if sign(v) == dir { run += 1 } else { break }
        }
        let recent = Array(d.suffix(run))
        let seq = recent.suffix(4).map { Format.percent($0, signed: true) }.joined(separator: ", ")
        let isCaution = dir > 0 && recent.contains { $0 > ProgressionModel.caution }
        if dir == 0 { return "\(name) held steady last week (\(Format.percent(last, signed: true)))." }
        if run >= 2 {
            return "\(name) is \(dir > 0 ? "up" : "down") \(run) weeks running: \(seq).\(isCaution ? " One jump is above the +15% caution line." : "")"
        }
        var after = ""
        if d.count > 1 {
            let prev = d[d.count - 2]
            after = prev > 0.02 ? " after a rise" : prev < -0.02 ? " after a drop" : " after a steady week"
        }
        return "\(name) \(dir > 0 ? "rose" : "fell") \(Format.percent(abs(last))) last week\(after).\(isCaution ? " That is above the +15% caution line." : "")"
    }
}

// MARK: - Intensity distribution

public struct IntensityShare: Hashable, Sendable {
    public var easy: Double
    public var moderate: Double
    public var hard: Double

    public init(easy: Double, moderate: Double, hard: Double) {
        self.easy = easy; self.moderate = moderate; self.hard = hard
    }

    /// Fractions of the total (all zero when empty).
    public static func of(easy: Double, moderate: Double, hard: Double) -> IntensityShare {
        let t = easy + moderate + hard
        guard t > 0 else { return IntensityShare(easy: 0, moderate: 0, hard: 0) }
        return IntensityShare(easy: easy / t, moderate: moderate / t, hard: hard / t)
    }

    /// "77 / 18 / 5%"
    public var text: String {
        "\(Format.number(easy * 100)) / \(Format.number(moderate * 100)) / \(Format.number(hard * 100))%"
    }

    public var isEmpty: Bool { easy + moderate + hard == 0 }
}

public enum IntensityBand: String, CaseIterable, Hashable, Sendable {
    case easy, moderate, hard

    public var label: String {
        switch self {
        case .easy: return "Easy"
        case .moderate: return "Moderate"
        case .hard: return "Hard"
        }
    }

    /// DESIGN_V2 §8.2 zone colour index for the band (z2 blue, z3 aqua, z5 red); pair with a label
    public var zone: Int {
        switch self {
        case .easy: return 2
        case .moderate: return 3
        case .hard: return 5
        }
    }

    /// representative intensity class (for `DataColor.intensity`)
    public var intensity: IntensityClass {
        switch self {
        case .easy: return .endurance
        case .moderate: return .tempo
        case .hard: return .high
        }
    }
}

public struct IntensitySegment: Hashable, Sendable, Identifiable {
    public var id: String { week + band.rawValue }
    public var week: IsoWeek
    public var band: IntensityBand
    /// share of that week 0…1
    public var share: Double
}

public struct IntensityChartModel: Hashable, Sendable {
    /// "Pyramidal"
    public var distributionLabel: String?
    public var total: IntensityShare
    /// stacked 100% bars, one per week
    public var segments: [IntensitySegment]
    public var weeks: [IsoWeek]
    public var labelledWeeks: [IsoWeek]
    public var weekLabels: [IsoWeek: String]
    public var sentence: String

    public init(trend: IntensityTrend) {
        let pct = trend.total.pct
        let total = pct.map { IntensityShare(easy: $0.easy / 100, moderate: $0.moderate / 100, hard: $0.hard / 100) }
            ?? IntensityShare.of(easy: trend.total.easy, moderate: trend.total.moderate, hard: trend.total.hard)
        self.total = total
        distributionLabel = trend.total.distribution.flatMap { IntensityChartModel.distributionLabel($0) }
        var segs: [IntensitySegment] = []
        var weeks: [IsoWeek] = []
        var labels: [IsoWeek: String] = [:]
        for w in trend.weeks {
            weeks.append(w.isoWeek)
            labels[w.isoWeek] = Format.dayMonth(w.startDate)
            let s = IntensityShare.of(easy: w.easy, moderate: w.moderate, hard: w.hard)
            if s.isEmpty { continue }
            segs.append(IntensitySegment(week: w.isoWeek, band: .easy, share: s.easy))
            segs.append(IntensitySegment(week: w.isoWeek, band: .moderate, share: s.moderate))
            segs.append(IntensitySegment(week: w.isoWeek, band: .hard, share: s.hard))
        }
        segments = segs
        self.weeks = weeks
        weekLabels = labels
        let stride = max(1, Int((Double(weeks.count) / 4).rounded(.up)))
        var labelled: [IsoWeek] = []
        var i = weeks.count - 1
        while i >= 0 { labelled.append(weeks[i]); i -= stride }
        labelledWeeks = labelled.reversed()
        if total.isEmpty {
            sentence = "No timed training in this range yet."
        } else {
            sentence = "\(Format.percent(total.easy)) of your time was easy, \(Format.percent(total.moderate)) moderate and \(Format.percent(total.hard)) hard."
        }
    }

    public static func distributionLabel(_ d: DistributionType) -> String? {
        switch d {
        case .polarized: return "Polarized"
        case .pyramidal: return "Pyramidal"
        case .threshold: return "Threshold"
        case .highIntensity: return "High intensity"
        case .mixed: return "Mixed"
        case .unknown: return nil
        }
    }
}

// MARK: - Consistency heatmap

public struct HeatCell: Hashable, Sendable, Identifiable {
    public var id: LocalDate { date }
    public var date: LocalDate
    /// 0 none … 4 most
    public var level: Int
    /// 1 = Monday … 7 = Sunday (row)
    public var weekday: Int
    public var isFuture: Bool
    public var accessibilityLabel: String
}

public struct HeatColumn: Hashable, Sendable, Identifiable {
    public var id: LocalDate { weekStart }
    public var weekStart: LocalDate
    /// month label above the column when a month starts in it ("Dec")
    public var monthLabel: String?
    /// 7 cells, Monday first
    public var cells: [HeatCell]
}

public struct ConsistencyModel: Hashable, Sendable {
    public var columns: [HeatColumn]
    /// "51 weeks in a row with 3+ sessions, your best · 323 of 365 days trained"
    public var sentence: String
    /// level thresholds in seconds (for the legend's accessibility)
    public var thresholds: [Double]

    public init(trend: ConsistencyTrend, weeks: Int? = nil) {
        let byDate = Dictionary(trend.days.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
        let nonZero = trend.days.filter { $0.durationSec > 0 }.map(\.durationSec)
        let q = [0.25, 0.5, 0.75].map { ChartMath.percentile(nonZero, $0) ?? 0 }
        thresholds = q
        guard let from = Day(trend.from), let to = Day(trend.to) else {
            columns = []; sentence = ""; return
        }
        var start = from.weekStart
        if let weeks { start = max(start, to.weekStart.adding(days: -7 * (weeks - 1))) }
        var cols: [HeatColumn] = []
        var ws = start
        while ws <= to {
            var cells: [HeatCell] = []
            var monthLabel: String?
            for i in 0..<7 {
                let d = ws.adding(days: i)
                if d.day == 1 && d <= to { monthLabel = Format.monthsShort[d.month - 1] }
                let day = byDate[d.string]
                let sec = day?.durationSec ?? 0
                let level = ConsistencyModel.level(sec, thresholds: q)
                var label = Format.dateMedium(d.string)
                if d > to { label += ", upcoming" }
                else if sec > 0 { label += ", \(Format.duration(sec, style: .short))\(day.map { $0.count > 1 ? ", \($0.count) sessions" : "" } ?? "")" }
                else { label += ", rest" }
                cells.append(HeatCell(date: d.string, level: level, weekday: i + 1, isFuture: d > to, accessibilityLabel: label))
            }
            cols.append(HeatColumn(weekStart: ws.string, monthLabel: monthLabel, cells: cells))
            ws = ws.adding(days: 7)
        }
        columns = cols
        let trained = trend.days.filter { $0.count > 0 || $0.durationSec > 0 }.count
        let total = max(1, from.days(until: to) + 1)
        var parts: [String] = []
        let s = trend.streaks
        if s.currentWeeks3 > 1 {
            parts.append("\(s.currentWeeks3) weeks in a row with 3+ sessions\(s.currentWeeks3 >= s.longestWeeks3 ? ", your best" : "")")
        }
        parts.append("\(trained) of \(total) days trained")
        sentence = parts.joined(separator: Format.dot)
    }

    /// 0 for no training, else 1…4 by quartile of the training days.
    public static func level(_ sec: Double, thresholds q: [Double]) -> Int {
        guard sec > 0 else { return 0 }
        if q.count < 3 { return 2 }
        if sec <= q[0] { return 1 }
        if sec <= q[1] { return 2 }
        if sec <= q[2] { return 3 }
        return 4
    }
}
