import XCTest
@testable import CadenceKit

/// WidgetSupport: refresh policy, relevance, per-family display models, check-in, quick-add phrase
/// and Siri wording. Fixture: the demo athlete on Saturday 2026-11-21 (Europe/Madrid) — today one
/// done long ride; tomorrow a planned 1:30 trail run at 09:00; W47 7:48 of 9:45; race on 27 Dec.
final class WidgetSupportTests: XCTestCase {
    private var snapshot: MobileSnapshot!

    override func setUpWithError() throws {
        snapshot = try Fixtures.decode(MobileSnapshot.self, "snapshot")
        XCTAssertEqual(snapshot.today, "2026-11-21", "fixture changed: update the expectations below")
    }

    // MARK: Refresh policy

    func testShouldFetch() {
        let now = localDate("2026-11-21", 12)
        XCTAssertTrue(WidgetRefresh.shouldFetch(fetchedAt: nil, now: now))
        XCTAssertFalse(WidgetRefresh.shouldFetch(fetchedAt: now.addingTimeInterval(-14 * 60), now: now))
        XCTAssertTrue(WidgetRefresh.shouldFetch(fetchedAt: now.addingTimeInterval(-15 * 60), now: now))
        XCTAssertTrue(WidgetRefresh.shouldFetch(fetchedAt: now.addingTimeInterval(3600), now: now), "clock moved back")
    }

    func testPlanWithoutSnapshotRetries() {
        let now = localDate("2026-11-21", 12)
        let p = WidgetRefresh.plan(for: nil, fetchedAt: nil, now: now, timeZone: madrid)
        XCTAssertEqual(p.entryDates, [now])
        XCTAssertEqual(p.reloadAfter, now.addingTimeInterval(15 * 60))
    }

    func testPlanIdleDayHasMidnightAndStaleEntries() {
        // everything done today: hourly reloads; entries now, when "Updated … ago" appears, midnight
        let now = localDate("2026-11-21", 20)
        let fetched = localDate("2026-11-21", 19, 30)
        let p = WidgetRefresh.plan(for: snapshot, fetchedAt: fetched, now: now, timeZone: madrid)
        XCTAssertEqual(p.entryDates, [now, fetched.addingTimeInterval(2 * 3600 + 60), localDate("2026-11-22", 0)])
        XCTAssertEqual(p.reloadAfter, now.addingTimeInterval(3600))
    }

    func testPlanReloadsJustAfterMidnight() {
        let now = localDate("2026-11-21", 23, 30)
        let p = WidgetRefresh.plan(for: snapshot, fetchedAt: now, now: now, timeZone: madrid)
        XCTAssertEqual(p.entryDates.last, localDate("2026-11-22", 0), "offline roll-over entry")
        XCTAssertEqual(p.reloadAfter, localDate("2026-11-22", 0, 5))
    }

    func testPlanAroundAPlannedSession() {
        // rolled over to Sunday: the 09:00 run (1:30) is planned
        let fetched = localDate("2026-11-21", 22)
        let early = localDate("2026-11-22", 6)
        XCTAssertEqual(WidgetRefresh.plan(for: snapshot, fetchedAt: fetched, now: early, timeZone: madrid).reloadAfter,
                       localDate("2026-11-22", 7), "wakes up when the window (start − 1 h) opens… capped by the hourly reload")
        let before = localDate("2026-11-22", 7, 30)
        XCTAssertEqual(WidgetRefresh.plan(for: snapshot, fetchedAt: fetched, now: before, timeZone: madrid).reloadAfter,
                       localDate("2026-11-22", 8), "window opens at 08:00")
        let during = localDate("2026-11-22", 9, 15)
        XCTAssertEqual(WidgetRefresh.plan(for: snapshot, fetchedAt: during, now: during, timeZone: madrid).reloadAfter,
                       during.addingTimeInterval(20 * 60), "every 20 min around the session")
        let after = localDate("2026-11-22", 12, 5)
        XCTAssertEqual(WidgetRefresh.plan(for: snapshot, fetchedAt: after, now: after, timeZone: madrid).reloadAfter,
                       after.addingTimeInterval(3600), "window closed 90 min after the planned end (10:30 + 1:30)")
    }

    func testPlanStaleSnapshotRetries() {
        let now = localDate("2026-11-25", 9)
        let p = WidgetRefresh.plan(for: snapshot, fetchedAt: localDate("2026-11-21", 9), now: now, timeZone: madrid)
        XCTAssertEqual(p.reloadAfter, now.addingTimeInterval(15 * 60))
    }

    // MARK: Relevance

    func testRelevance() {
        let beforeRun = WidgetModels.relevance(.today, snapshot: snapshot, now: localDate("2026-11-22", 8, 15), timeZone: madrid)
        XCTAssertEqual(beforeRun.score, 1)
        XCTAssertEqual(beforeRun.duration, 75 * 60, accuracy: 1)
        XCTAssertEqual(WidgetModels.relevance(.today, snapshot: snapshot, now: localDate("2026-11-22", 7), timeZone: madrid).score, 0.6)
        XCTAssertEqual(WidgetModels.relevance(.today, snapshot: snapshot, now: localDate("2026-11-21", 20), timeZone: madrid).score, 0.1)
        XCTAssertEqual(WidgetModels.relevance(.checkIn, snapshot: snapshot, now: localDate("2026-11-22", 7), timeZone: madrid).score, 0.9)
        XCTAssertEqual(WidgetModels.relevance(.checkIn, snapshot: snapshot, checkInLogged: true, now: localDate("2026-11-22", 7), timeZone: madrid).score, 0)
        XCTAssertEqual(WidgetModels.relevance(.race, snapshot: snapshot, now: localDate("2026-11-21", 12), timeZone: madrid).score, 0.1)
        XCTAssertEqual(WidgetModels.relevance(.race, snapshot: snapshot, now: localDate("2026-12-22", 12), timeZone: madrid).score, 0.7)
        XCTAssertEqual(WidgetModels.relevance(.race, snapshot: snapshot, now: localDate("2026-12-26", 12), timeZone: madrid).score, 1)
        XCTAssertEqual(WidgetModels.relevance(.week, snapshot: snapshot, now: localDate("2026-11-22", 18), timeZone: madrid).score, 0.5)
        XCTAssertEqual(WidgetModels.relevance(.today, snapshot: nil, now: localDate("2026-11-22", 8), timeZone: madrid).score, 0)
    }

    // MARK: Today

    func testTodayDisplayWhenDone() {
        let d = WidgetModels.todayDisplay(snapshot, fetchedAt: localDate("2026-11-21", 19), now: localDate("2026-11-21", 20), timeZone: madrid)
        XCTAssertEqual(d.rows.count, 2, "the done ride, then tomorrow's run")
        XCTAssertNil(d.rows[0].label)
        XCTAssertEqual(d.rows[1].label, "Tomorrow")
        XCTAssertEqual(d.rows[1].line.sport, .run)
        XCTAssertEqual(d.rows.map(\.intensity), [.tempo, .endurance])
        XCTAssertEqual(WidgetModels.tone(d.rows[0].line.state), .good)
        XCTAssertEqual(WidgetModels.stateSymbol(d.rows[1].line.state), "circle")
        XCTAssertNil(d.moreText)
        XCTAssertEqual(d.formLine, "Form \u{2212}2 \u{00B7} Neutral")
        XCTAssertEqual(d.upNextText, "Tomorrow \u{00B7} Run 1:30")
        XCTAssertEqual(d.rectangularTitle, "Long ride 2h05 \u{2014} Gavarres loop")
        XCTAssertEqual(d.rectangularDetail, "Done \u{00B7} 2:06 \u{00B7} 57.8\u{202F}km")
        XCTAssertEqual(d.rectangularSymbol, Sport.bike.symbolName)
        XCTAssertEqual(d.inlineText, "Done \u{00B7} Ride 2:06 \u{00B7} Form \u{2212}2")
        XCTAssertTrue(d.accessibilityLabel.hasPrefix("Today, Sat 21 Nov. Ride, Long ride"))
    }

    func testTodayDisplayPlannedAfterRollOver() {
        let d = WidgetModels.todayDisplay(snapshot, fetchedAt: localDate("2026-11-21", 22), now: localDate("2026-11-22", 7), timeZone: madrid)
        XCTAssertEqual(d.rows.map(\.line.sport), [.run])
        XCTAssertEqual(d.rectangularTitle, "Trail run 1h30 \u{2014} Gavarres")
        XCTAssertEqual(d.rectangularDetail, "09:00 \u{00B7} 1:30 \u{00B7} Load 69")
        XCTAssertEqual(d.inlineText, "Run 1:30 easy \u{00B7} Form \u{2212}2")
        XCTAssertNil(d.upNextText, "tomorrow is unknown after a roll-over")
    }

    func testTodayDisplayRestDayAndMoreRows() {
        var s = snapshot!
        s.todaySessions = []
        let rest = WidgetModels.todayDisplay(s, fetchedAt: localDate("2026-11-21", 9), now: localDate("2026-11-21", 10), timeZone: madrid)
        XCTAssertEqual(rest.rectangularTitle, "Rest day")
        XCTAssertEqual(rest.rectangularDetail, "Tomorrow \u{00B7} Run 1:30")
        XCTAssertNil(rest.rectangularSymbol)
        XCTAssertEqual(rest.inlineText, "Rest day \u{00B7} Form \u{2212}2")
        XCTAssertEqual(rest.rows.first?.label, "Tomorrow")

        let one = s.tomorrowSessions[0]
        s.todaySessions = [one, one, one].enumerated().map { i, x in
            var c = x
            c.id = "w\(i)"
            c.intensity = .threshold
            return c
        }
        let busy = WidgetModels.todayDisplay(s, now: localDate("2026-11-21", 6), timeZone: madrid)
        XCTAssertEqual(busy.rows.count, 2)
        XCTAssertEqual(busy.moreText, "+1 more")
        XCTAssertEqual(busy.inlineText, "Run 1:30 hard \u{00B7} Form \u{2212}2")
    }

    func testTodayDisplayStale() {
        let d = WidgetModels.todayDisplay(snapshot, now: localDate("2026-11-25", 9), timeZone: madrid)
        XCTAssertEqual(d.inlineText, "Open Cadence to refresh")
        XCTAssertNil(d.formLine)
        XCTAssertTrue(d.rows.isEmpty)
    }

    // MARK: Week

    func testWeekProgressHoursAndLoad() {
        let h = WidgetModels.weekProgress(snapshot, metric: .hours, now: localDate("2026-11-21", 12), timeZone: madrid)
        XCTAssertEqual(h.title, "W47 \u{00B7} Run base")
        XCTAssertNil(h.heroPrefix)
        XCTAssertEqual(h.heroText, "7:48")
        XCTAssertEqual(h.ofText, "of 9:45")
        XCTAssertEqual(h.secondaryText, "Load 464 of 539")
        XCTAssertEqual(h.gaugeValueText, "7.8")
        XCTAssertEqual(h.gaugeLabel, "W47")
        XCTAssertEqual(h.fraction, 28100.0 / 35087.0, accuracy: 0.0001)
        XCTAssertEqual(h.accessibilityLabel, "Week 47: 7 hours 48 minutes of 9 hours 45 minutes done")
        XCTAssertEqual(h.strip.map(\.symbol), ["checkmark.circle.fill", "checkmark.circle.fill", "checkmark.circle.fill",
                                               "checkmark.circle.fill", "circle.slash", "checkmark.circle.fill", "circle"])
        XCTAssertEqual(h.strip.filter(\.isToday).map(\.date), ["2026-11-21"])
        XCTAssertEqual(h.strip[4].isDimmed, true)
        XCTAssertEqual(h.strip.map(\.tone), [.good, .good, .good, .good, .critical, .good, .neutral])
        XCTAssertEqual(h.strip[4].accessibilityLabel, "Friday, missed")
        XCTAssertEqual(h.strip[5].accessibilityLabel, "Saturday, done, today")

        let l = WidgetModels.weekProgress(snapshot, metric: .load, now: localDate("2026-11-21", 12), timeZone: madrid)
        XCTAssertEqual(l.heroPrefix, "Load")
        XCTAssertEqual(l.heroText, "464")
        XCTAssertEqual(l.ofText, "of 539")
        XCTAssertEqual(l.secondaryText, "7:48 of 9:45")
        XCTAssertEqual(l.gaugeValueText, "464")
        XCTAssertEqual(l.fraction, 464 / 539.1, accuracy: 0.0001)
    }

    func testWeekSessionsFromSnapshotOnly() {
        let m = WidgetModels.weekSessions(calendar: nil, snapshot: snapshot, now: localDate("2026-11-21", 12), timeZone: madrid)
        XCTAssertFalse(m.isComplete)
        XCTAssertEqual(m.rows.map(\.dayText), ["Sat", "Sun"])
        XCTAssertEqual(m.rows.map(\.isToday), [true, false])
        XCTAssertNil(m.moreText)
    }

    func testWeekSessionsFromCalendarKeepsTodayInView() throws {
        // the calendar fixture covers 9–29 Nov; point the snapshot's week at W46 (9–15 Nov)
        let cal = try Fixtures.decode(CalendarResponse.self, "calendar")
        var s = snapshot!
        let monday = Day("2026-11-09")!
        s.week.days = (0..<7).map { SnapshotDay(date: monday.adding(days: $0).string, plannedSec: 0, doneSec: 0, state: .rest) }
        let all = WidgetModels.weekSessions(calendar: cal, snapshot: s, now: localDate("2026-11-11", 8), timeZone: madrid)
        XCTAssertTrue(all.isComplete)
        let expected = s.week.days.flatMap { d in cal.workouts(on: d.date).map(\.id) + cal.unplannedActivities(on: d.date).map(\.id) }
        XCTAssertEqual(all.rows.map(\.id), Array(expected.prefix(6)))
        XCTAssertGreaterThanOrEqual(expected.count, 3, "fixture changed")

        let two = WidgetModels.weekSessions(calendar: cal, snapshot: s, now: localDate("2026-11-11", 8), timeZone: madrid, limit: 2)
        XCTAssertEqual(two.rows.count, 2)
        XCTAssertEqual(two.moreText, "+\(expected.count - 2) more")
        XCTAssertTrue(two.rows.allSatisfy { $0.date >= "2026-11-10" }, "the window slides towards today")
        XCTAssertEqual(two.rows.last?.date, s.week.days.last { !cal.workouts(on: $0.date).isEmpty || !cal.unplannedActivities(on: $0.date).isEmpty }?.date)

        let empty = WidgetModels.weekSessions(calendar: nil, snapshot: s, now: localDate("2026-11-30", 8), timeZone: madrid)
        XCTAssertEqual(empty.emptyText, "Open Cadence to load the week")
    }

    // MARK: Form and race

    func testFitnessSparkline() {
        let sp = WidgetModels.fitnessSparkline(snapshot)
        XCTAssertEqual(sp.values.count, 42)
        XCTAssertTrue(sp.values.allSatisfy { $0 > 0 && $0 < 1 }, "padded inside the frame")
        XCTAssertEqual(sp.point(0).x, 0)
        XCTAssertEqual(sp.point(41).x, 1)
        XCTAssertLessThan(sp.point(0).y, sp.point(41).y, "82 → 66: the line ends lower (larger y)")
        XCTAssertEqual(sp.accessibilityLabel, "Fitness 66, down 17 in 6 weeks")
        var empty = snapshot!
        empty.fitnessSeries = []
        XCTAssertFalse(WidgetModels.fitnessSparkline(empty).isDrawable)
    }

    func testRaceDisplay() {
        let r = WidgetModels.raceDisplay(snapshot, now: localDate("2026-11-21", 12), timeZone: madrid)
        XCTAssertEqual(r.heroText, "36")
        XCTAssertEqual(r.heroUnit, "days to go")
        XCTAssertEqual(r.weekLine, "W47 \u{00B7} 7:48 of 9:45 \u{00B7} Load 464")
        XCTAssertEqual(r.deepLink, .event(id: "evt_demo_3"))
        XCTAssertEqual(r.accessibilityLabel, "Riu Ter Half Marathon, B race, in 36 days, Sun 27 Dec")
        let eve = WidgetModels.raceDisplay(snapshot, now: localDate("2026-12-26", 12), timeZone: madrid)
        XCTAssertEqual(eve.heroText, "Tomorrow")
        XCTAssertNil(eve.heroUnit)
        let none = WidgetModels.raceDisplay(snapshot, now: localDate("2026-12-28", 12), timeZone: madrid)
        XCTAssertNil(none.race)
        XCTAssertEqual(none.heroText, WidgetCopy.noRaceTitle)
        XCTAssertEqual(none.deepLink, .calendar(date: nil))
    }

    // MARK: Check-in

    func testCheckInModelAndStore() {
        let now = localDate("2026-11-22", 7)
        let before = WidgetModels.checkIn(record: nil, now: now, timeZone: madrid)
        XCTAssertEqual(before.title, "How do you feel this morning?")
        XCTAssertEqual(before.options.map(\.label), ["Very tired", "Tired", "Normal", "Fresh", "Very fresh"])
        XCTAssertFalse(before.isLogged)
        XCTAssertNil(before.statusText)
        XCTAssertEqual(before.deepLink, .checkIn(date: "2026-11-22"))

        let defaults = UserDefaults(suiteName: "cadencekit-checkin-\(UUID().uuidString)")!
        let store = CheckInStore(defaults: defaults)
        XCTAssertNil(store.load())
        store.save(CheckInRecord(date: "2026-11-22", feel: 4, savedAt: now, synced: false))
        XCTAssertEqual(store.pending(now: now, timeZone: madrid)?.feel, 4)
        let pending = WidgetModels.checkIn(record: store.load(), now: now, timeZone: madrid)
        XCTAssertTrue(pending.isLogged)
        XCTAssertEqual(pending.statusText, "Fresh \u{00B7} not synced yet")
        XCTAssertEqual(pending.options.filter(\.isSelected).map(\.value), [4])
        XCTAssertEqual(pending.options[3].accessibilityLabel, "Fresh, 4 of 5, selected")

        store.save(CheckInRecord(date: "2026-11-22", feel: 4, savedAt: now, synced: true))
        XCTAssertNil(store.pending(now: now, timeZone: madrid))
        XCTAssertEqual(WidgetModels.checkIn(record: store.load(), now: now, timeZone: madrid).statusText, "Logged \u{00B7} Fresh")
        XCTAssertFalse(WidgetModels.checkIn(record: store.load(), now: localDate("2026-11-23", 7), timeZone: madrid).isLogged,
                       "yesterday's answer does not count today")
        XCTAssertNil(store.record(for: "2026-11-23"))
        store.save(CheckInRecord(date: "2026-11-18", feel: 2, savedAt: now, synced: false))
        XCTAssertNil(store.pending(now: now, timeZone: madrid), "too old to send")
    }

    // MARK: Quick add phrase

    func testQuickAddPhrase() {
        let sat = "2026-11-21" // a Saturday
        func p(_ s: String) -> QuickAddPhrase { QuickAddPhrase.parse(s, today: sat) }
        XCTAssertEqual(p("run 45m easy tomorrow"), QuickAddPhrase(date: "2026-11-22", text: "run 45m easy", hasExplicitDate: true))
        XCTAssertEqual(p("tomorrow run 45m easy"), QuickAddPhrase(date: "2026-11-22", text: "run 45m easy", hasExplicitDate: true))
        XCTAssertEqual(p("bike 2h @key on tuesday").date, "2026-11-24")
        XCTAssertEqual(p("bike 2h @key on tuesday").text, "bike 2h @key")
        XCTAssertEqual(p("swim 3km sat").date, "2026-11-28", "same weekday → next week")
        XCTAssertEqual(p("swim 3km this sat").date, "2026-11-21")
        XCTAssertEqual(p("run 6x800m next mon").date, "2026-11-23")
        XCTAssertEqual(p("run 10k dec 24").date, "2026-12-24")
        XCTAssertEqual(p("run 10k 3 jan").date, "2027-01-03", "nearest occurrence")
        XCTAssertEqual(p("strength 40m 2026-12-01").date, "2026-12-01")
        XCTAssertEqual(p("row 30m +2d").date, "2026-11-23")
        XCTAssertEqual(p("run 30m in 3 days").date, "2026-11-24")
        XCTAssertEqual(p("run 45m easy"), QuickAddPhrase(date: sat, text: "run 45m easy", hasExplicitDate: false))
        XCTAssertEqual(p("bike 2 hours").date, sat, "numbers are not dates")
        XCTAssertEqual(p("tomorrow").text, "tomorrow", "a date alone is not a workout")
    }

    // MARK: Siri wording

    func testSpokenText() {
        XCTAssertEqual(SpokenText.duration(5400), "1 hour 30 minutes")
        XCTAssertEqual(SpokenText.duration(2700), "45 minutes")
        XCTAssertEqual(SpokenText.duration(7200), "2 hours")
        XCTAssertEqual(SpokenText.duration(60), "1 minute")
        XCTAssertEqual(SpokenText.duration(nil), "")
        XCTAssertEqual(SpokenText.signed(-2), "minus 2")
        XCTAssertEqual(SpokenText.signed(4.4), "plus 4")
        XCTAssertEqual(SpokenText.signed(0.2), "0")
    }

    func testTodaySummary() {
        let done = IntentCopy.todaySummary(snapshot, now: localDate("2026-11-21", 20), timeZone: madrid)
        XCTAssertEqual(done.dialog, "You're done for today: a ride, Long ride 2h05 \u{2014} Gavarres loop, 2 hours 6 minutes. "
                       + "Tomorrow: a run, Trail run 1h30 \u{2014} Gavarres, 1 hour 30 minutes at 09:00. Form is minus 2, neutral.")
        XCTAssertEqual(done.title, "Today \u{00B7} Sat 21 Nov")
        XCTAssertEqual(done.rows.count, 2)

        let sunday = IntentCopy.todaySummary(snapshot, now: localDate("2026-11-22", 7), timeZone: madrid)
        XCTAssertEqual(sunday.dialog, "Today you have a run, Trail run 1h30 \u{2014} Gavarres, 1 hour 30 minutes at 09:00.",
                       "no Form after a roll-over: it is yesterday's")

        var rest = snapshot!
        rest.todaySessions = []
        rest.tomorrowSessions = []
        XCTAssertEqual(IntentCopy.todaySummary(rest, now: localDate("2026-11-21", 9), timeZone: madrid).dialog,
                       "Today is a rest day. Form is minus 2, neutral.")
        XCTAssertEqual(IntentCopy.todaySummary(snapshot, now: localDate("2026-11-25", 9), timeZone: madrid).dialog,
                       "I don't have today's plan yet. Open Cadence to refresh.")
        XCTAssertEqual(IntentCopy.list(["a", "b", "c"]), "a, b and c")
        XCTAssertEqual(IntentCopy.list(["a, x", "b"]), "a, x; and b")
    }

    func testIntentMessages() throws {
        XCTAssertEqual(IntentCopy.message(for: .notConnected), IntentCopy.notConnected)
        XCTAssertEqual(IntentCopy.message(for: .unauthorized), IntentCopy.notConnected)
        XCTAssertEqual(IntentCopy.message(for: .transport(message: "x", offline: true)), IntentCopy.offline)
        XCTAssertEqual(IntentCopy.message(for: .server(code: "garmin_not_connected", message: "x", status: 409)),
                       "Garmin isn't connected. Connect it in Cadence settings.")
        XCTAssertEqual(IntentCopy.message(for: .server(code: "validation", message: "Bad text", status: 400)), "Bad text")
        XCTAssertEqual(IntentCopy.checkInLogged(feel: 4, synced: true), "Logged: fresh today.")

        let quick = try Fixtures.decode(QuickAddResponse.self, "workout_quick")
        let text = IntentCopy.quickAdded(quick, today: quick.workout.date)
        XCTAssertTrue(text.hasPrefix("Added "), text)
        XCTAssertTrue(text.contains("for today."), text)
        XCTAssertTrue(IntentCopy.quickAdded(quick, today: Day(quick.workout.date)!.adding(days: -1).string).contains("for tomorrow."))
        XCTAssertTrue(IntentCopy.quickAdded(quick, today: Day(quick.workout.date)!.adding(days: -9).string).contains("on "))
    }
}
