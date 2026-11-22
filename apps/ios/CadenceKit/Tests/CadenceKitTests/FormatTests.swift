import XCTest
@testable import CadenceKit

private let u = "\u{202F}" // unit space
private let m = "\u{2212}" // minus

final class FormatTests: XCTestCase {
    func testNumbers() {
        XCTAssertEqual(Format.number(12500), "12,500")
        XCTAssertEqual(Format.number(4.25, decimals: 1), "4.3")
        XCTAssertEqual(Format.number(1_234_567.891, decimals: 2), "1,234,567.89")
        XCTAssertEqual(Format.number(4.0, decimals: 1, trim: true), "4")
        XCTAssertEqual(Format.number(4.0, decimals: 1), "4.0")
        XCTAssertEqual(Format.number(-3), "\(m)3")
        XCTAssertEqual(Format.number(-0.4), "0")
        XCTAssertEqual(Format.number(999.5), "1,000")
        XCTAssertEqual(Format.number(nil), "\u{2014}")
        XCTAssertEqual(Format.number(.nan), "\u{2014}")
    }

    func testSignedAndPercent() {
        XCTAssertEqual(Format.signed(3), "+3")
        XCTAssertEqual(Format.signed(-13), "\(m)13")
        XCTAssertEqual(Format.signed(0), "0")
        XCTAssertEqual(Format.signed(0.04, decimals: 1), "0.0")
        XCTAssertEqual(Format.signed(2.5, decimals: 1), "+2.5")
        XCTAssertEqual(Format.percent(0.92), "92%")
        XCTAssertEqual(Format.percent(0.12, signed: true), "+12%")
        XCTAssertEqual(Format.percent(-0.08, signed: true), "\(m)8%")
        XCTAssertEqual(Format.percent(0.001, signed: true), "\u{00B1}0%")
    }

    func testDurations() {
        XCTAssertEqual(Format.duration(4500), "1:15")
        XCTAssertEqual(Format.duration(5100), "1:25")
        XCTAssertEqual(Format.duration(2700), "0:45")
        XCTAssertEqual(Format.duration(4530, style: .hms), "1:15:30")
        XCTAssertEqual(Format.duration(2730, style: .hms), "45:30")
        XCTAssertEqual(Format.duration(42, style: .hms), "0:42")
        XCTAssertEqual(Format.duration(4500, style: .short), "1h\(u)15m")
        XCTAssertEqual(Format.duration(2700, style: .short), "45m")
        XCTAssertEqual(Format.duration(7200, style: .short), "2h")
        XCTAssertEqual(Format.duration(40, style: .short), "40s")
        XCTAssertEqual(Format.duration(2700, style: .compact), "45m")
        XCTAssertEqual(Format.duration(5100, style: .compact), "1:25")
        XCTAssertEqual(Format.duration(-600), "\(m)0:10")
        XCTAssertEqual(Format.duration(nil), "\u{2014}")
        XCTAssertEqual(Format.hours(35100), "9.8")
    }

    func testDistances() {
        XCTAssertEqual(Format.distance(42195, sport: .run), "42.2\(u)km")
        XCTAssertEqual(Format.distance(10000, sport: .run), "10\(u)km")
        XCTAssertEqual(Format.distance(150_000, sport: .bike), "150\(u)km")
        XCTAssertEqual(Format.distance(42195, sport: .run, units: .imperial), "26.2\(u)mi")
        XCTAssertEqual(Format.distance(2500, sport: .swim), "2,500\(u)m")
        XCTAssertEqual(Format.distance(2500, sport: .swim, swimYards: true), "2,734\(u)yd")
        XCTAssertEqual(Format.distance(5000, sport: .row), "5,000\(u)m")
        XCTAssertEqual(Format.distance(12500, sport: .row), "12.5\(u)km")
        XCTAssertEqual(Format.distance(nil, sport: .run), "\u{2014}\(u)km")
    }

    func testPaceAndSpeed() {
        XCTAssertEqual(Format.pace(4.08, sport: .run), "4:05\(u)/km")
        XCTAssertEqual(Format.pace(4.0, sport: .run, units: .imperial), "6:42\(u)/mi")
        XCTAssertEqual(Format.pace(100.0 / 105.0, sport: .swim), "1:45\(u)/100m")
        XCTAssertEqual(Format.pace(500.0 / 112.4, sport: .row), "1:52.4\(u)/500m")
        XCTAssertEqual(Format.pace(0, sport: .run), "\u{2014}\(u)/km")
        XCTAssertEqual(Format.speedParts(9).joined, "32.4\(u)km/h")
        XCTAssertEqual(Format.speedOrPace(4.08, sport: .run), "4:05\(u)/km")
        XCTAssertEqual(Format.speedOrPace(9, sport: .bike), "32.4\(u)km/h")
    }

    func testBodyNumbers() {
        XCTAssertEqual(Format.load(102.6), "103")
        XCTAssertEqual(Format.power(245), "245\(u)W")
        XCTAssertEqual(Format.heartRate(62), "62\(u)bpm")
        XCTAssertEqual(Format.form(-6), "\(m)6")
        XCTAssertEqual(Format.fitness(65.6), "66")
        XCTAssertEqual(Format.weight(72.4), "72.4\(u)kg")
        XCTAssertEqual(Format.elevation(420), "420\(u)m")
    }

    func testDates() {
        XCTAssertEqual(Format.weekdayShort("2026-11-21"), "Sat")
        XCTAssertEqual(Format.weekdayInitial("2026-11-16"), "M")
        XCTAssertEqual(Format.dayShort("2026-11-21"), "Sat 21")
        XCTAssertEqual(Format.dayMonth("2026-11-21"), "21 Nov")
        XCTAssertEqual(Format.dateMedium("2026-11-21"), "Sat 21 Nov")
        XCTAssertEqual(Format.dateLong("2026-11-21", withYear: true), "Saturday 21 November 2026")
        XCTAssertEqual(Format.monthYear("2026-11"), "November 2026")
        XCTAssertEqual(Format.weekLabel("2026-W47"), "W47")
        XCTAssertEqual(Format.weekLabel("2026-W05"), "W5")
        XCTAssertEqual(Format.weekRange("2026-W47"), "16\u{2013}22 Nov")
        XCTAssertEqual(Format.weekRange("2026-W49"), "30 Nov \u{2013} 6 Dec")
        XCTAssertEqual(Format.clock("07:30"), "07:30")
        XCTAssertEqual(Format.clock("19:05", hour12: true), "7:05\(u)pm")
        XCTAssertEqual(Format.clock("00:15", hour12: true), "12:15\(u)am")
    }

    func testRelativeDays() {
        let today = "2026-11-21"
        XCTAssertEqual(Format.relativeDay("2026-11-21", today: today), "Today")
        XCTAssertEqual(Format.relativeDay("2026-11-22", today: today), "Tomorrow")
        XCTAssertEqual(Format.relativeDay("2026-11-20", today: today), "Yesterday")
        XCTAssertEqual(Format.relativeDay("2026-12-27", today: today), "in 36 days")
        XCTAssertEqual(Format.relativeDay("2026-11-18", today: today), "3 days ago")
        XCTAssertEqual(Format.relativeDay("2027-04-01", today: today), "in 4 months")
        XCTAssertEqual(Format.countdown(daysTo: 36), "36 days")
        XCTAssertEqual(Format.countdown(daysTo: 1), "Tomorrow")
        XCTAssertEqual(Format.countdown(daysTo: 0), "Today")
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-30), now: now), "just now")
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-300), now: now), "5 min ago")
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-3 * 3600), now: now), "3 h ago")
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-86_400), now: now), "1 day ago")
    }

    func testStyles() {
        XCTAssertEqual(Sport.bike.label, "Ride")
        XCTAssertEqual(Sport.swim.symbolName, "figure.pool.swim")
        XCTAssertEqual(Sport.unknown.label, "Session")
        XCTAssertTrue(Sport.allCases.allSatisfy { !$0.symbolName.isEmpty })
        XCTAssertFalse(IntensityClass.tempo.style.showsDot)
        XCTAssertTrue(IntensityClass.threshold.style.showsDot)
        XCTAssertTrue(IntensityClass.race.style.showsDot)
        XCTAssertEqual(IntensityClass.endurance.style.bucket, .easy)
        XCTAssertEqual(FormZone.neutral.label, "Neutral")
        XCTAssertEqual(FormZone.of(formPct: 22), .transition)
        XCTAssertEqual(FormZone.of(formPct: 5), .fresh)
        XCTAssertEqual(FormZone.of(formPct: -10), .neutral)
        XCTAssertEqual(FormZone.of(formPct: -10.5), .productive)
        XCTAssertEqual(FormZone.of(formPct: -31), .overreaching)
        XCTAssertNil(ComplianceState.onTarget.deviationLabel)
        XCTAssertEqual(ComplianceState.missed.deviationLabel, "Missed")
        XCTAssertEqual(EventPriority.a.label, "A race")
    }
}

final class DayTests: XCTestCase {
    func testParsingAndFormatting() {
        XCTAssertEqual(Day("2026-11-21")?.string, "2026-11-21")
        XCTAssertNil(Day("2026-02-30"))
        XCTAssertNil(Day("2026-13-01"))
        XCTAssertNil(Day("21/11/2026"))
        XCTAssertEqual(Day("2026-11-21T10:00:00Z")?.string, "2026-11-21")
    }

    func testArithmetic() {
        let d = Day("2026-11-21")!
        XCTAssertEqual(d.daysSinceEpoch, 20778)
        XCTAssertEqual(d.adding(days: 11).string, "2026-12-02")
        XCTAssertEqual(d.adding(days: -21).string, "2026-10-31")
        XCTAssertEqual(Day("2028-02-28")!.adding(days: 1).string, "2028-02-29")
        XCTAssertEqual(d.days(until: Day("2026-12-27")!), 36)
        XCTAssertEqual(Day("1969-12-31")!.daysSinceEpoch, -1)
        XCTAssertEqual(Day.range(Day("2026-11-16")!, Day("2026-11-22")!).count, 7)
    }

    func testIsoWeeks() {
        XCTAssertEqual(Day("2026-11-21")!.isoWeekday, 6)
        XCTAssertEqual(Day("1969-12-31")!.isoWeekday, 3)
        XCTAssertEqual(Day("2026-11-21")!.isoWeek, "2026-W47")
        XCTAssertEqual(Day("2027-01-01")!.isoWeek, "2026-W53")
        XCTAssertEqual(Day("2024-12-30")!.isoWeek, "2025-W01")
        XCTAssertEqual(Day("2021-01-03")!.isoWeek, "2020-W53")
        XCTAssertEqual(Day("2026-11-21")!.weekStart.string, "2026-11-16")
        XCTAssertEqual(Day("2026-11-21")!.weekEnd.string, "2026-11-22")
        XCTAssertEqual(Day.isoWeekStart("2026-W47")?.string, "2026-11-16")
        XCTAssertEqual(Day.isoWeekStart("2026-W53")?.string, "2026-12-28")
        XCTAssertEqual(Day.isoWeekStart("2025-W01")?.string, "2024-12-30")
    }

    func testFromDateInTimeZone() {
        // 23:30 UTC on the 21st is already the 22nd in Madrid (UTC+1).
        let date = Date(timeIntervalSince1970: TimeInterval(Day("2026-11-21")!.daysSinceEpoch * 86_400 + 23 * 3600 + 1800))
        XCTAssertEqual(Day(date, timeZone: TimeZone(identifier: "UTC")!).string, "2026-11-21")
        XCTAssertEqual(Day(date, timeZone: madrid).string, "2026-11-22")
    }

    func testInstantParsing() {
        XCTAssertNotNil(Instant.parse("2026-11-21T18:02:06.824Z"))
        XCTAssertNotNil(Instant.parse("2026-11-21T18:02:06Z"))
        XCTAssertNil(Instant.parse("yesterday"))
        XCTAssertEqual(SessionLine.localTime(startedAt: "2026-11-21T08:26:00.000Z", utcOffsetMin: 60), "09:26")
    }
}
