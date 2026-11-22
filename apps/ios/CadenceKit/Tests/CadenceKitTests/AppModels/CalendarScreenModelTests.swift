import XCTest
@testable import CadenceKit

/// calendar.json covers W46–W48 (2026-11-09 … 2026-11-29), today = 2026-11-21, phase "Run base".
/// It is trimmed: a few workouts and four activities (one paired to a workout not in the list).
final class CalendarScreenModelTests: XCTestCase {
    private var cal: CalendarResponse!

    override func setUpWithError() throws {
        cal = try Fixtures.decode(CalendarResponse.self, "calendar")
        XCTAssertEqual(cal.today, "2026-11-21", "fixture changed: update the expectations below")
    }

    func testMonthArithmetic() throws {
        let nov = try XCTUnwrap(MonthID("2026-11"))
        XCTAssertEqual(nov.title, "November 2026")
        XCTAssertEqual(nov.gridStart.string, "2026-10-26")
        XCTAssertEqual(nov.gridEnd.string, "2026-12-06")
        XCTAssertEqual(nov.adding(months: 2).string, "2027-01")
        XCTAssertEqual(nov.adding(months: -11).string, "2025-12")
        XCTAssertEqual(nov.adding(months: -23).string, "2024-12")
        XCTAssertEqual(MonthID("2026-11-21"), nov)
        XCTAssertNil(MonthID("2026-13"))
        XCTAssertLessThan(nov, nov.adding(months: 1))
        XCTAssertEqual(MonthID(Day("2024-02-29")!).lastDay.string, "2024-02-29")
    }

    func testMonthGrid() throws {
        let nov = try XCTUnwrap(MonthID("2026-11"))
        let grid = CalendarModels.month(nov, calendar: cal, today: cal.today)
        XCTAssertEqual(grid.weeks.count, 6)
        XCTAssertTrue(grid.weeks.allSatisfy { $0.cells.count == 7 })
        XCTAssertEqual(grid.weeks[0].isoWeek, "2026-W44")
        XCTAssertEqual(grid.from, "2026-10-26")
        XCTAssertEqual(grid.to, "2026-12-06")
        XCTAssertEqual(grid.weekdayInitials, ["M", "T", "W", "T", "F", "S", "S"])

        let cells = grid.weeks.flatMap(\.cells)
        let first = try XCTUnwrap(cells.first)
        XCTAssertFalse(first.isInMonth)
        XCTAssertEqual(first.dayNumber, "26")
        let today = try XCTUnwrap(cells.first { $0.isToday })
        XCTAssertEqual(today.date, "2026-11-21")
        XCTAssertTrue(today.accessibilityLabel.hasPrefix("Today, Saturday 21 November"))

        let ninth = try XCTUnwrap(cells.first { $0.date == "2026-11-09" })
        XCTAssertEqual(ninth.marks.count, 2, "one paired workout + one activity whose plan is outside the response")
        XCTAssertTrue(ninth.marks.allSatisfy { $0.state == .done })
        XCTAssertTrue(ninth.isPast)
        let tempo = try XCTUnwrap(cells.first { $0.date == "2026-11-24" })
        XCTAssertEqual(tempo.marks.first?.state, .planned)
        XCTAssertEqual(tempo.marks.first?.isKey, true)
        let css = try XCTUnwrap(cells.first { $0.date == "2026-11-25" })
        XCTAssertEqual(css.marks.first?.showsIntensityDot, true, "threshold is hard")
        XCTAssertEqual(css.marks.first?.intensityRamp, 5)

        let loading = CalendarModels.month(nov, calendar: nil, today: cal.today)
        XCTAssertTrue(loading.weeks.flatMap(\.cells).allSatisfy { $0.marks.isEmpty })
    }

    func testWeekStripMode() throws {
        let row = try XCTUnwrap(CalendarModels.week(containing: "2026-11-21", calendar: cal, today: cal.today))
        XCTAssertEqual(row.isoWeek, "2026-W47")
        XCTAssertEqual(row.cells.map(\.date).first, "2026-11-16")
        XCTAssertEqual(row.cells.map(\.date).last, "2026-11-22")
        let edge = try XCTUnwrap(CalendarModels.week(containing: "2026-12-01", calendar: nil, today: cal.today))
        XCTAssertTrue(edge.cells.allSatisfy(\.isInMonth), "a strip never dims days of the next month")
    }

    func testWeekSummaryLines() throws {
        let w47 = try XCTUnwrap(CalendarModels.weekSummary(containing: "2026-11-21", calendar: cal, today: cal.today))
        XCTAssertEqual(w47.title, "W47 \u{00B7} Run base")
        XCTAssertEqual(w47.hoursText, "7:48")
        XCTAssertEqual(w47.ofText, "of 9:45")
        XCTAssertEqual(w47.detailText, "Load 464 \u{00B7} Form \u{2212}6")
        XCTAssertFalse(w47.isFuture)
        XCTAssertEqual(w47.fraction, 28100.0 / 35087.0, accuracy: 0.0001)

        let w46 = try XCTUnwrap(CalendarModels.weekSummary(containing: "2026-11-09", calendar: cal, today: cal.today))
        XCTAssertEqual(w46.fraction, 1, "over plan clamps to a full bar")

        let future = CalendarModels.weekSummary(cal.weeks[1], phase: nil, today: "2026-11-01")
        XCTAssertTrue(future.isFuture)
        XCTAssertEqual(future.title, "W47")
        XCTAssertEqual(future.hoursText, "9:45")
        XCTAssertEqual(future.ofText, "planned")
        XCTAssertEqual(future.fraction, 0)
        XCTAssertEqual(future.detailText, "Load 539 \u{00B7} Form \u{2212}6")
    }

    func testDayScreen() {
        let d = CalendarModels.day("2026-11-10", calendar: cal, today: cal.today, units: .metric)
        XCTAssertEqual(d.title, "Tuesday 10 November")
        XCTAssertEqual(d.subtitle, "11 days ago \u{00B7} W46")
        XCTAssertTrue(d.isPast)
        XCTAssertEqual(d.phaseText, "Run base")
        XCTAssertEqual(d.sessions.count, 2, "one pair + one activity whose plan is not in the response")
        XCTAssertEqual(d.sessions.first?.timeText, "07:11", "ordered by actual start")
        XCTAssertEqual(d.week?.title, "W46 \u{00B7} Run base")

        let empty = CalendarModels.day("2026-11-27", calendar: cal, today: cal.today, units: .metric)
        XCTAssertTrue(empty.sessions.isEmpty)
        XCTAssertEqual(empty.subtitle, "in 6 days \u{00B7} W48")
        XCTAssertEqual(empty.note, "")
    }

    func testQuickMoveTargets() {
        let t = CalendarModels.quickMoveTargets(from: "2026-11-24")
        XCTAssertEqual(t.map(\.date), ["2026-11-25", "2026-11-26", "2026-12-01"])
        XCTAssertEqual(t.first?.label, "Wed 25 Nov")
    }

    func testOptimisticEdits() throws {
        let moved = cal.movingWorkout(id: "wk_d20261124_2", to: "2026-11-26")
        XCTAssertTrue(moved.workouts(on: "2026-11-24").isEmpty)
        XCTAssertEqual(moved.workouts(on: "2026-11-26").map(\.id), ["wk_d20261124_2"])

        let removed = cal.removingWorkouts(ids: ["wk_d20261124_2"])
        XCTAssertEqual(removed.workouts.count, cal.workouts.count - 1)
        let restored = removed.upserting(cal.workouts.filter { $0.id == "wk_d20261124_2" })
        XCTAssertEqual(restored.workouts.count, cal.workouts.count)

        let skipped = cal.updatingWorkout(id: "wk_d20261124_2") { $0.applySkip(.travel) }
        let card = try XCTUnwrap(DayCards.build(skipped, date: "2026-11-24", units: .metric).first)
        XCTAssertEqual(card.statusText, "Skipped \u{00B7} travel")
        XCTAssertTrue(card.isDimmed)
        XCTAssertFalse(card.canSendToWatch)
        let unskipped = skipped.updatingWorkout(id: "wk_d20261124_2") { $0.applySkip(nil) }
        XCTAssertEqual(DayCards.build(unskipped, date: "2026-11-24", units: .metric).first?.statusText, "Planned")

        let noted = cal.settingDayNote(date: "2026-11-24", body: "Legs heavy")
        XCTAssertEqual(noted.dayNote(on: "2026-11-24")?.body, "Legs heavy")
        XCTAssertNil(noted.settingDayNote(date: "2026-11-24", body: "").dayNote(on: "2026-11-24"))
    }
}
