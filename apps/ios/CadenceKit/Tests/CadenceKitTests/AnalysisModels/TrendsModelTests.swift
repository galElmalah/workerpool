import XCTest
@testable import CadenceKit

/// A week summary with only the fields the trends models read.
func makeWeek(_ start: String, doneSec: Double = 0, plannedSec: Double = 0, doneLoad: Double = 0, plannedLoad: Double = 0,
              doneDistanceM: Double = 0, wowSec: Double? = nil, wowLoad: Double? = nil, keyPlanned: Int = 0, keyDone: Int = 0,
              compliancePct: Double? = nil, fitness: Double = 60, form: Double = 0, intensity: IntensitySeconds = IntensitySeconds(easy: 0, moderate: 0, hard: 0),
              bySport: [SportTotals] = []) -> WeekSummary {
    let d = Day(start)!
    return WeekSummary(isoWeek: d.isoWeek, startDate: d.string, endDate: d.adding(days: 6).string, plannedSec: plannedSec, doneSec: doneSec,
                       plannedLoad: plannedLoad, doneLoad: doneLoad, plannedDistanceM: 0, doneDistanceM: doneDistanceM, elevationGainM: 0,
                       projectedSec: doneSec, projectedLoad: doneLoad, targetHours: nil, targetLoad: nil, bySport: bySport,
                       keyPlanned: keyPlanned, keyDone: keyDone, intensitySec: intensity, compliancePct: compliancePct,
                       fitness: fitness, fatigue: 60, form: form, formPct: nil, formZone: .neutral, fitnessDelta: 1,
                       wowSec: wowSec, wowLoad: wowLoad, wowDistanceM: nil, isProjected: false, hasNote: false, phaseId: nil,
                       dailyLoad: [0, 0, 0, 0, 0, 0, 0])
}

final class TrendsModelTests: XCTestCase {
    func testRange() {
        let today = Day("2026-11-22")! // a Sunday
        XCTAssertEqual(TrendRange.twelveWeeks.startDay(today: today).string, "2026-08-31")
        XCTAssertEqual(TrendRange.sixWeeks.startDay(today: today).string, "2026-10-12")
        XCTAssertEqual(TrendRange.twelveWeeks.subtitle(today: today), "Last 12 weeks · 31 Aug – 22 Nov")
    }

    func testWowSentenceMatchesWeb() {
        XCTAssertEqual(ProgressionModel.sentence(name: "Hours", deltas: [nil]), "Not enough history yet to compare hours week over week.")
        XCTAssertEqual(ProgressionModel.sentence(name: "Hours", deltas: [-0.3, 0.87]),
                       "Hours rose 87% last week after a drop. That is above the +15% caution line.")
        XCTAssertEqual(ProgressionModel.sentence(name: "Load", deltas: [-0.1, 0.06, 0.09, 0.04]),
                       "Load is up 3 weeks running: +6%, +9%, +4%.")
        XCTAssertEqual(ProgressionModel.sentence(name: "Load", deltas: [0.2, 0.01]), "Load held steady last week (+1%).")
        XCTAssertEqual(ProgressionModel.sentence(name: "Hours", deltas: [0.0, -0.12]), "Hours fell 12% last week after a steady week.")
        XCTAssertEqual(ProgressionModel.sentence(name: "Hours", deltas: [0.05, 0.2]),
                       "Hours is up 2 weeks running: +5%, +20%. One jump is above the +15% caution line.")
    }

    func testProgressionUsesCompleteWeeksOnly() {
        let weeks = [
            makeWeek("2026-10-26", doneSec: 36000, wowSec: nil),
            makeWeek("2026-11-02", doneSec: 18000, wowSec: -0.5),
            makeWeek("2026-11-09", doneSec: 36000, wowSec: 1.0),
            makeWeek("2026-11-16", doneSec: 3600, wowSec: -0.9), // current week (today inside)
        ]
        let p = ProgressionModel(weeks: weeks, range: .twelveWeeks, metric: .hours, units: .metric, today: "2026-11-21")
        XCTAssertEqual(p.bars.map(\.id), ["2026-W45", "2026-W46"])
        XCTAssertEqual(p.bars.last?.isLatest, true)
        XCTAssertEqual(p.bars.last?.isCaution, true)
        XCTAssertEqual(p.bars.last?.deltaText, "+100%")
        XCTAssertEqual(p.sentence, "Hours rose 100% last week after a drop. That is above the +15% caution line.")
        XCTAssertEqual(p.detail, "Last week 10:00\u{202F}h vs 5:00\u{202F}h.")
        XCTAssertEqual(p.yTicks.count, 3)
        XCTAssertTrue(p.yDomain.contains(1.0))
    }

    func testVolume() {
        let weeks = (0..<6).map { i in makeWeek(Day("2026-10-12")!.adding(days: 7 * i).string, doneSec: Double(i + 1) * 3600, doneLoad: 100) }
        let v = VolumeChartModel(weeks: weeks, range: .sixWeeks, metric: .hours, units: .metric, today: "2026-11-18")
        XCTAssertEqual(v.bars.count, 6)
        XCTAssertEqual(v.bars.last?.label, "This week")
        XCTAssertEqual(v.bars.last?.isCurrent, true)
        // last 4 complete weeks: 2, 3, 4, 5 h
        XCTAssertEqual(v.average ?? 0, 3.5, accuracy: 1e-9)
        XCTAssertEqual(v.averageText, "3:30\u{202F}h 4-wk avg")
        XCTAssertEqual(v.labelledWeeks.last, v.bars.last?.id)
        XCTAssertLessThanOrEqual(v.labelledWeeks.count, 5)
        XCTAssertLessThanOrEqual(v.yTicks.count, 3)
        XCTAssertEqual(VolumeMetric.distance.format(42_195 / 1000, units: .metric), "42\u{202F}km")
    }

    func testHeadline() {
        let weeks = [makeWeek("2026-11-09", doneSec: 39060, doneLoad: 648), makeWeek("2026-11-16", doneSec: 28080, doneLoad: 464)]
        let days = [
            FitnessDay(date: "2026-11-14", load: 0, plannedLoad: 0, fitness: 63, fatigue: 70, form: 3, formPct: nil, formZone: .neutral, ramp: nil, projected: false),
            FitnessDay(date: "2026-11-21", load: 0, plannedLoad: 0, fitness: 66, fatigue: 72, form: -2, formPct: nil, formZone: .neutral, ramp: 3, projected: false),
            FitnessDay(date: "2026-11-22", load: 0, plannedLoad: 60, fitness: 66.2, fatigue: 70, form: -6, formPct: nil, formZone: .neutral, ramp: nil, projected: true),
        ]
        let f = TrendsHeadline.figures(weeks: weeks, fitness: days, today: "2026-11-21")
        XCTAssertEqual(f.map(\.id), ["hours", "load", "fitness", "form"])
        XCTAssertEqual(f[0].value, "7:48")
        XCTAssertEqual(f[0].context, "last week 10:51")
        XCTAssertEqual(f[1].context, "last week 648")
        XCTAssertEqual(f[2].value, "66")
        XCTAssertEqual(f[2].context, "+3 in 7 days")
        XCTAssertEqual(f[3].value, "\u{2212}2")
        XCTAssertEqual(f[3].context, "\u{2212}5 in 7 days · Neutral")
    }

    func testFitnessChartJoinsProjection() {
        var days: [FitnessDay] = []
        let start = Day("2026-09-01")!
        for i in 0..<100 {
            let d = start.adding(days: i)
            days.append(FitnessDay(date: d.string, load: 50, plannedLoad: 0, fitness: 50 + Double(i) / 10, fatigue: 55, form: -5,
                                   formPct: nil, formZone: nil, ramp: nil, projected: d.string > "2026-11-21"))
        }
        let ev = Event(id: "e1", date: "2026-12-05", name: "Riu Ter Half", priority: .a)
        let trend = FitnessTrend(from: days.first!.date, to: days.last!.date, today: "2026-11-21", days: days, events: [ev], phases: [], thresholdChanges: [])
        let m = FitnessChartModel(trend: trend, range: .twelveWeeks)
        let fit = m.series.first { $0.id == "fitness" }!
        let proj = m.series.first { $0.id == "fitness-projected" }!
        XCTAssertEqual(fit.points.last?.x, Day("2026-11-21")!.chartX)
        XCTAssertEqual(proj.points.first?.x, Day("2026-11-21")!.chartX, "projection starts at today")
        XCTAssertEqual(m.todayX, Day("2026-11-21")!.chartX)
        XCTAssertEqual(m.markers.map(\.label), ["Riu Ter Half"])
        XCTAssertEqual(m.xDomain.lowerBound, Day("2026-08-31")!.chartX)
        XCTAssertLessThanOrEqual(m.yTicks.count, 3)
        XCTAssertTrue(m.sentence.hasSuffix("Dashed lines follow the plan to Riu Ter Half on 5 Dec."), m.sentence)
        XCTAssertEqual(m.xTicks.first?.label, "Sep")
        XCTAssertEqual(m.readout(at: Day("2026-11-21")!.chartX), "Sat 21 Nov · Fitness 58 · Fatigue 55 · Form \u{2212}5")
    }

    func testDayAxis() {
        let ticks = DayAxis.ticks(from: Day("2026-08-31")!, to: Day("2027-01-20")!, weeks: 12)
        XCTAssertEqual(ticks.map(\.label), ["Sep", "Oct", "Nov", "Dec", "Jan '27"])
        let short = DayAxis.ticks(from: Day("2026-10-12")!, to: Day("2026-11-22")!, weeks: 6)
        XCTAssertEqual(short.map(\.label), ["12 Oct", "26 Oct", "9 Nov"])
        XCTAssertEqual(Day.fromChartX(Day("2026-11-21")!.chartX).string, "2026-11-21")
    }

    func testIntensity() {
        let t = IntensityTrend(weeks: [
            IntensityWeek(isoWeek: "2026-W46", startDate: "2026-11-09", easy: 7700, moderate: 1800, hard: 500, pct: nil, distribution: .pyramidal),
            IntensityWeek(isoWeek: "2026-W47", startDate: "2026-11-16", easy: 0, moderate: 0, hard: 0, pct: nil, distribution: nil),
        ], total: IntensityTotal(easy: 7700, moderate: 1800, hard: 500, pct: IntensityPercent(easy: 77, moderate: 18, hard: 5), distribution: .pyramidal), bySport: [])
        let m = IntensityChartModel(trend: t)
        XCTAssertEqual(m.distributionLabel, "Pyramidal")
        XCTAssertEqual(m.total.text, "77 / 18 / 5%")
        XCTAssertEqual(m.segments.count, 3, "empty weeks draw nothing")
        XCTAssertEqual(m.segments.first?.share ?? 0, 0.77, accuracy: 1e-9)
        XCTAssertEqual(m.sentence, "77% of your time was easy, 18% moderate and 5% hard.")
    }

    func testConsistency() {
        let days = Day.range(Day("2026-11-01")!, Day("2026-11-21")!).enumerated().map { i, d in
            ConsistencyDay(date: d.string, load: 0, durationSec: i % 3 == 0 ? 0 : Double(i) * 600, count: i % 3 == 0 ? 0 : 1, key: false)
        }
        let s = Streaks(currentDays: 1, longestDays: 5, currentWeeks: 3, longestWeeks: 3, currentWeeks3: 3, longestWeeks3: 3, daysSinceRest: 1)
        let m = ConsistencyModel(trend: ConsistencyTrend(from: "2026-11-01", to: "2026-11-21", days: days, streaks: s))
        XCTAssertEqual(m.columns.first?.weekStart, "2026-10-26")
        XCTAssertEqual(m.columns.count, 4)
        XCTAssertTrue(m.columns.allSatisfy { $0.cells.count == 7 })
        XCTAssertEqual(m.columns.last?.cells.last?.isFuture, true) // Sun 22 Nov
        XCTAssertEqual(m.columns[0].monthLabel, "Nov") // Sun 1 Nov sits in the week of 26 Oct
        XCTAssertNil(m.columns[1].monthLabel)
        XCTAssertEqual(m.sentence, "3 weeks in a row with 3+ sessions, your best · 14 of 21 days trained")
        XCTAssertEqual(ConsistencyModel.level(0, thresholds: [1, 2, 3]), 0)
        XCTAssertEqual(ConsistencyModel.level(2.5, thresholds: [1, 2, 3]), 3)
        XCTAssertEqual(ConsistencyModel.level(9, thresholds: [1, 2, 3]), 4)
    }

    func testFixturesBuild() throws {
        let fitness = try Fixtures.decode(FitnessTrend.self, "trends_fitness")
        XCTAssertFalse(FitnessChartModel(trend: fitness, range: .sixWeeks).sentence.isEmpty)
        let weekly = try Fixtures.decode([WeekSummary].self, "trends_weekly")
        _ = ProgressionModel(weeks: weekly, range: .twelveWeeks, metric: .load, units: .metric, today: fitness.today)
        _ = VolumeChartModel(weeks: weekly, range: .twelveWeeks, metric: .distance, units: .imperial, today: fitness.today)
        let consistency = try Fixtures.decode(ConsistencyTrend.self, "trends_consistency")
        XCTAssertFalse(ConsistencyModel(trend: consistency).columns.isEmpty)
        let intensity = try Fixtures.decode(IntensityTrend.self, "trends_intensity")
        _ = IntensityChartModel(trend: intensity)
    }
}
