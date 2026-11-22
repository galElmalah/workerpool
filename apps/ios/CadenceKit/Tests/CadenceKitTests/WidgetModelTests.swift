import XCTest
@testable import CadenceKit

/// The snapshot fixture is the seeded demo athlete on Saturday 2026-11-21 (Europe/Madrid):
/// today = one done, paired long ride (2:06, 57.8 km); tomorrow = a planned 1:30 trail run at 09:00;
/// week W47 "Run base" 28100 s done of 35087 s planned, 3 of 3 key; next event 2026-12-27 (B).
final class WidgetModelTests: XCTestCase {
    private var snapshot: MobileSnapshot!

    override func setUpWithError() throws {
        snapshot = try Fixtures.decode(MobileSnapshot.self, "snapshot")
        XCTAssertEqual(snapshot.today, "2026-11-21", "fixture changed: update the expectations below")
    }

    func testTodayWhenEverythingIsDone() {
        let m = WidgetModels.today(snapshot, fetchedAt: localDate("2026-11-21", 19), now: localDate("2026-11-21", 20), timeZone: madrid)
        XCTAssertEqual(m.dateText, "Sat 21 Nov")
        XCTAssertEqual(m.lines.count, 1)
        XCTAssertTrue(m.allDone)
        XCTAssertEqual(m.primary?.sport, .bike)
        XCTAssertEqual(m.primary?.detail, "2:06 \u{00B7} 57.8\u{202F}km")
        XCTAssertEqual(m.primary?.state, .done)
        XCTAssertEqual(m.primary?.deepLink, .activity(id: "act_uxe16yozne"))
        XCTAssertTrue(m.primary?.isKey ?? false)
        XCTAssertFalse(m.primary?.showsIntensityDot ?? true, "tempo is moderate: no dot")
        XCTAssertEqual(m.upNext.count, 1)
        XCTAssertEqual(m.upNextLabel, "Tomorrow")
        XCTAssertEqual(m.upNext.first?.time, "09:00")
        XCTAssertEqual(m.headline, snapshot.status.headline)
        XCTAssertEqual(m.inlineText, "Done \u{00B7} Ride 2:06")
        XCTAssertNil(m.staleText)
        XCTAssertEqual(m.deepLink, .activity(id: "act_uxe16yozne"))
    }

    func testTodayRollsOverAfterMidnight() {
        let m = WidgetModels.today(snapshot, fetchedAt: localDate("2026-11-21", 22), now: localDate("2026-11-22", 7), timeZone: madrid)
        XCTAssertEqual(m.dateText, "Sun 22 Nov")
        XCTAssertEqual(m.lines.count, 1)
        XCTAssertEqual(m.primary?.sport, .run)
        XCTAssertEqual(m.primary?.state, .planned)
        XCTAssertEqual(m.primary?.deepLink, .workout(id: "wk_d20261122_1"))
        XCTAssertFalse(m.allDone)
        XCTAssertTrue(m.upNext.isEmpty)
        XCTAssertNil(m.headline, "yesterday's headline must not be shown")
        XCTAssertEqual(m.inlineText, "Run 1:30 \u{00B7} 09:00")
        XCTAssertEqual(m.staleText, "Updated 9 h ago")
    }

    func testTodayStaleSnapshot() {
        let m = WidgetModels.today(snapshot, now: localDate("2026-11-25", 9), timeZone: madrid)
        XCTAssertTrue(m.lines.isEmpty)
        XCTAssertEqual(m.emptyText, "Open Cadence to refresh")
        XCTAssertEqual(m.deepLink, .today)
        XCTAssertNotNil(m.staleText)
    }

    func testRestDay() {
        var s = snapshot!
        s.todaySessions = []
        s.tomorrowSessions = []
        let m = WidgetModels.today(s, fetchedAt: localDate("2026-11-21", 9), now: localDate("2026-11-21", 10), timeZone: madrid)
        XCTAssertEqual(m.emptyText, "Rest day")
        XCTAssertEqual(m.inlineText, "Rest day")
        XCTAssertNil(m.primary)
        XCTAssertTrue(m.upNext.isEmpty)
    }

    func testHardSessionGetsTheDot() {
        let s = SnapshotSession(id: "w", kind: .planned, sport: .bike, title: "VO2 5×4", durationSec: 3600, load: 85,
                                isKey: true, intensity: .high, state: .planned, workoutId: "w")
        let line = SessionLine(session: s, units: .metric)
        XCTAssertTrue(line.showsIntensityDot)
        XCTAssertEqual(line.intensityRamp, 6)
        XCTAssertEqual(line.detail, "1:00 \u{00B7} Load 85", "no distance → load")
        XCTAssertEqual(line.accessibilityLabel, "Ride, VO2 5×4, planned, 1:00 \u{00B7} Load 85, key session")
    }

    func testWeek() {
        let m = WidgetModels.week(snapshot, now: localDate("2026-11-21", 12), timeZone: madrid)
        XCTAssertEqual(m.title, "W47 \u{00B7} Run base")
        XCTAssertEqual(m.doneText, "7:48")
        XCTAssertEqual(m.plannedText, "of 9:45")
        XCTAssertEqual(m.fraction, 28100.0 / 35087.0, accuracy: 0.0001)
        XCTAssertEqual(m.loadText, "Load 464 of 539")
        XCTAssertEqual(m.keyText, "3 of 3 key")
        XCTAssertEqual(m.days.map(\.initial), ["M", "T", "W", "T", "F", "S", "S"])
        XCTAssertEqual(m.days.filter(\.isToday).map(\.date), ["2026-11-21"])
        XCTAssertEqual(m.days[4].state, .missed)
        XCTAssertEqual(m.days[4].fraction, 0)
        XCTAssertEqual(m.days[0].fraction, 1, "over-done days clamp to 1")
        XCTAssertTrue(m.isCurrentWeek)
        XCTAssertEqual(m.recentWeeks.count, snapshot.recentWeeks.count)
        XCTAssertEqual(m.recentWeeks.map(\.fraction).max(), 1)
        XCTAssertEqual(m.recentWeeks.last?.isCurrent, true)
        XCTAssertEqual(m.deepLink, .week("2026-W47"))
        XCTAssertFalse(WidgetModels.week(snapshot, now: localDate("2026-11-24", 12), timeZone: madrid).isCurrentWeek)
    }

    func testForm() {
        let m = WidgetModels.form(snapshot)
        XCTAssertEqual(m.formText, "\u{2212}2")
        XCTAssertEqual(m.zoneText, "Neutral")
        XCTAssertEqual(m.line, "Form \u{2212}2 \u{00B7} Neutral")
        XCTAssertEqual(m.fitnessText, "66")
        XCTAssertEqual(m.fatigueText, "72")
        XCTAssertEqual(m.rampText, "+2.5 a week")
        XCTAssertEqual(m.series.count, 42)
        XCTAssertLessThan(m.range.lowerBound, m.range.upperBound)
    }

    func testRace() throws {
        let m = try XCTUnwrap(WidgetModels.race(snapshot, now: localDate("2026-11-21", 12), timeZone: madrid))
        XCTAssertEqual(m.countdownText, "36 days")
        XCTAssertEqual(m.daysTo, 36)
        XCTAssertEqual(m.dateText, "Sun 27 Dec")
        XCTAssertEqual(m.priorityText, "B race")
        // recomputed from the device clock, not the snapshot's daysTo
        XCTAssertEqual(WidgetModels.race(snapshot, now: localDate("2026-12-26", 12), timeZone: madrid)?.countdownText, "Tomorrow")
        XCTAssertNil(WidgetModels.race(snapshot, now: localDate("2026-12-28", 12), timeZone: madrid))
    }

    func testSchedule() {
        let now = localDate("2026-11-21", 20)
        let done = WidgetModels.schedule(for: snapshot, now: now, timeZone: madrid)
        XCTAssertEqual(done.reloadAfter, now.addingTimeInterval(2 * 3600))
        XCTAssertEqual(done.entryDates, [now])

        let late = localDate("2026-11-21", 23, 0)
        let s2 = WidgetModels.schedule(for: snapshot, now: late, timeZone: madrid)
        let midnight = localDate("2026-11-22", 0)
        XCTAssertEqual(s2.entryDates, [late, midnight], "roll-over entry at local midnight")
        XCTAssertEqual(s2.reloadAfter, midnight.addingTimeInterval(5 * 60))

        let morning = localDate("2026-11-22", 7)
        XCTAssertEqual(WidgetModels.schedule(for: snapshot, now: morning, timeZone: madrid).reloadAfter,
                       morning.addingTimeInterval(30 * 60), "open session today → refresh every 30 min")
        XCTAssertEqual(WidgetModels.schedule(for: nil, now: morning, timeZone: madrid).reloadAfter, morning.addingTimeInterval(15 * 60))
    }

    func testSessionLineFromWorkoutAndActivity() throws {
        let cal = try Fixtures.decode(CalendarResponse.self, "calendar")
        let paired = try XCTUnwrap(cal.workouts.first { $0.pairedActivityId != nil })
        let act = cal.activities.first { $0.id == paired.pairedActivityId }
        let line = SessionLine(workout: paired, activity: act, units: .metric)
        XCTAssertEqual(line.state, act == nil ? .planned : .done)
        let missed = cal.workouts.first { $0.compliance?.state == .missed }
        if let missed { XCTAssertEqual(SessionLine(workout: missed, units: .metric).state, .missed) }
        if let a = cal.activities.first {
            let l = SessionLine(activity: a, units: .metric)
            XCTAssertEqual(l.deepLink, .activity(id: a.id))
            XCTAssertNotNil(l.time)
        }
    }
}

final class StorageTests: XCTestCase {
    func testSnapshotCacheRoundTrip() throws {
        let dir = tempDirectory()
        let cache = SnapshotCache(directory: dir)
        XCTAssertNil(cache.load())
        let s = try Fixtures.decode(MobileSnapshot.self, "snapshot")
        let at = Date(timeIntervalSince1970: 1_790_000_000)
        try cache.save(s, fetchedAt: at)
        let e = try XCTUnwrap(cache.load())
        XCTAssertEqual(e.snapshot, s)
        XCTAssertEqual(e.fetchedAt, at)
        try Data("garbage".utf8).write(to: cache.fileURL)
        XCTAssertNil(cache.load(), "a corrupt file reads as nil")
        cache.clear()
        XCTAssertNil(cache.load())
    }

    func testResponseCacheEvictsOldest() throws {
        let cache = ResponseCache(directory: tempDirectory(), maxEntries: 3)
        for i in 0..<5 { cache.store(Data("\(i)".utf8), for: "k\(i)") }
        let remaining = (0..<5).filter { cache.data(for: "k\($0)") != nil }
        XCTAssertEqual(remaining.count, 3)
        XCTAssertEqual(ResponseCache.fileName(for: "/api/today"), ResponseCache.fileName(for: "/api/today"))
        XCTAssertNotEqual(ResponseCache.fileName(for: "/api/today"), ResponseCache.fileName(for: "/api/today?x=1"))
    }

    func testInMemoryTokenStore() throws {
        let store = InMemoryTokenStore()
        XCTAssertFalse(store.isConnected)
        try store.save(DeviceCredentials(serverURL: URL(string: "https://c.example.com")!, token: "cad_x"))
        XCTAssertEqual(store.token, "cad_x")
        store.clear()
        XCTAssertNil(store.token)
    }

    func testSharedPreferences() {
        let defaults = UserDefaults(suiteName: "cadencekit-tests-\(UUID().uuidString)")!
        let prefs = SharedPreferences(defaults: defaults)
        XCTAssertEqual(prefs.accent, .blue)
        prefs.accent = .rose
        prefs.units = .imperial
        XCTAssertEqual(SharedPreferences(defaults: defaults).accent, .rose)
        XCTAssertEqual(SharedPreferences(defaults: defaults).units, .imperial)
    }
}
