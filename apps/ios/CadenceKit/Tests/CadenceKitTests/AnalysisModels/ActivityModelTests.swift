import XCTest
@testable import CadenceKit

final class ActivityModelTests: XCTestCase {
    func testDetailFromBikeFixture() throws {
        let d = try Fixtures.decode(ActivityDetail.self, "activity_bike")
        let m = ActivityDetailModel(detail: d, units: .metric)
        XCTAssertEqual(m.title, "Long ride 2h05 — Gavarres loop")
        XCTAssertEqual(m.whenText, "Saturday 21 November 2026 · 09:26")
        XCTAssertEqual(m.kindText, "Ride · road · Garmin")
        XCTAssertEqual(m.figures.map(\.id), ["duration", "distance", "load", "if"])
        XCTAssertEqual(m.figures[0].value, "2:06:01")
        XCTAssertEqual(m.figures[0].context, "+8% vs last time")
        XCTAssertEqual(m.figures[1].value, "57.8")
        XCTAssertEqual(m.figures[1].unit, "km")
        XCTAssertEqual(m.figures[2].value, "103")
        XCTAssertEqual(m.figures[2].context, "from power")
        XCTAssertEqual(m.figures[3].value, "0.70")
        XCTAssertEqual(m.figures[3].context, "+2% vs last time")
        XCTAssertFalse(m.moreFigures.contains { $0.id == "duration" })
        XCTAssertEqual(m.plan?.stateLabel, "On plan")
        XCTAssertEqual(m.plan?.detail, "107% of planned load")
        XCTAssertEqual(m.plan?.fraction, 1)
        XCTAssertEqual(m.plan?.isOver, true)
        XCTAssertEqual(m.zones.map(\.id), ["power", "hr"])
        let power = m.zones[0]
        XCTAssertEqual(power.bars.first?.rangeText, "< 152\u{202F}W")
        XCTAssertEqual(power.bars.map(\.fraction).max(), 1)
        XCTAssertEqual(power.bars.reduce(0) { $0 + $1.share }, 1, accuracy: 1e-9)
        // the fixture's curve is trimmed to 1 s and 2 s, which are not key durations
        XCTAssertTrue(m.peaks.isEmpty)
        let peaks = ActivityPeaks(power: [PeakPoint(durationSec: 1, value: 900), PeakPoint(durationSec: 5, value: 704), PeakPoint(durationSec: 1200, value: 251)])
        XCTAssertEqual(ActivityDetailModel.peakRows(peaks, sport: .bike, units: .metric).map(\.label), ["5 s", "20 min"])
        XCTAssertEqual(ActivityDetailModel.peakRows(peaks, sport: .bike, units: .metric).first?.value, "704\u{202F}W")
        XCTAssertTrue(m.intensityIsAuto)
    }

    func testRunFiguresUsePaceAndEfforts() throws {
        let d = try Fixtures.decode(ActivityDetail.self, "activity_run")
        let m = ActivityDetailModel(detail: d, units: .metric)
        XCTAssertEqual(m.figures.map(\.id), ["duration", "distance", "load", "pace"])
        XCTAssertEqual(m.figures[3].unit, "/km")
        // 3.242 m/s = 5:08 /km vs 3.043 m/s = 5:29 /km → 20 s faster (rounded difference of raw seconds)
        XCTAssertEqual(m.figures[3].context, "20\u{202F}s faster than last time")
        XCTAssertEqual(m.efforts.map(\.label), ["400\u{202F}m", "1\u{202F}km"])
        XCTAssertEqual(m.efforts.last?.value, "4:23")
    }

    func testPaceVersus() {
        XCTAssertEqual(ActivityDetailModel.paceVersus(4, 4, sport: .run, units: .metric), "same pace as last time")
        XCTAssertEqual(ActivityDetailModel.paceVersus(4, 3.9, sport: .run, units: .metric), "6\u{202F}s faster than last time")
        XCTAssertNil(ActivityDetailModel.paceVersus(4, nil, sport: .run, units: .metric))
    }

    func testLabels() {
        XCTAssertEqual(ActivityDetailModel.durationLabel(5), "5 s")
        XCTAssertEqual(ActivityDetailModel.durationLabel(300), "5 min")
        XCTAssertEqual(ActivityDetailModel.durationLabel(3600), "1 h")
        XCTAssertEqual(ActivityDetailModel.effortLabel(21_097.5, sport: .run, units: .metric), "Half marathon")
        XCTAssertEqual(ActivityDetailModel.effortLabel(5000, sport: .run, units: .metric), "5\u{202F}km")
        XCTAssertEqual(ActivityDetailModel.effortLabel(1500, sport: .swim, units: .metric), "1,500\u{202F}m")
        XCTAssertEqual(EffortScale.rpeLabel(7), "Hard")
        XCTAssertEqual(EffortScale.feelLabel(5), "Great")
        XCTAssertEqual(ActivityDetailModel.subSportLabel(.openWater), "open water")
    }

    func testListRowsAndSections() throws {
        let page = try Fixtures.decode(ActivityPage.self, "activities_list")
        let sections = ActivityListModel.sections(page.items, units: .metric, today: "2026-11-21")
        XCTAssertEqual(sections.flatMap(\.rows).count, page.items.count)
        XCTAssertEqual(Set(sections.map(\.id)).count, sections.count, "one section per month")
        if let first = page.items.first {
            let row = ActivityRowModel(activity: first, units: .metric, today: first.localDate)
            XCTAssertEqual(row.dateText, "Today")
            XCTAssertTrue(row.detail.hasPrefix(Format.duration(first.displayDurationSec, style: .clock)))
            XCTAssertTrue(row.accessibilityLabel.contains(first.sport.label))
        }
    }

    func testRowDateText() {
        XCTAssertEqual(ActivityRowModel.dateText("2026-11-20", today: "2026-11-21"), "Yesterday")
        XCTAssertEqual(ActivityRowModel.dateText("2026-11-02", today: "2026-11-21"), "Mon 2 Nov")
        XCTAssertEqual(ActivityRowModel.dateText("2025-11-02", today: "2026-11-21"), "Sun 2 Nov 2025")
    }

    func testTotalsLine() {
        let t = ActivityTotals(count: 128, durationSec: 763_800, movingSec: 760_000, distanceM: 3_412_000, load: 12_340, elevationGainM: nil)
        XCTAssertEqual(ActivityListModel.totalsLine(t, sport: nil, units: .metric),
                       "128 activities · 211h\u{202F}7m · 3,412\u{202F}km · Load 12,340")
        XCTAssertEqual(ActivityListModel.totalsLine(t, sport: .strength, units: .metric),
                       "128 activities · 211h\u{202F}7m · Load 12,340")
        XCTAssertNil(ActivityListModel.totalsLine(nil, sport: nil, units: .metric))
        XCTAssertEqual(ActivityListModel.filterTitle(nil), "All sports")
        XCTAssertFalse(ActivityListModel.filterSports.contains(.unknown))
    }

    func testStrengthRows() {
        let sets = [
            StrengthSet(index: 0, exercise: "Squat", reps: 8, weightKg: 60),
            StrengthSet(index: 1, exercise: "Squat", reps: 6, weightKg: 65),
            StrengthSet(index: 2, exercise: "Rest", isRest: true),
            StrengthSet(index: 3, exercise: "Plank", durationSec: 60),
        ]
        let rows = ActivityDetailModel.strengthRows(sets, units: .metric)
        XCTAssertEqual(rows.map(\.exercise), ["Squat", "Plank"])
        XCTAssertEqual(rows[0].detail, "2 sets · 8, 6 reps · 65.0\u{202F}kg")
        XCTAssertEqual(rows[1].detail, "1 set")
    }
}
