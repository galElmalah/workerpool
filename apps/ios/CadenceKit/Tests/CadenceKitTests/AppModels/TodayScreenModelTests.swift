import XCTest
@testable import CadenceKit

/// today.json is the demo athlete on Saturday 2026-11-21: one key long ride, paired and logged
/// (RPE 4, feel 3), two unlogged sessions earlier in the week, Form −2 neutral.
final class TodayScreenModelTests: XCTestCase {
    private var today: TodayResponse!
    private var snapshot: MobileSnapshot!

    override func setUpWithError() throws {
        today = try Fixtures.decode(TodayResponse.self, "today")
        snapshot = try Fixtures.decode(MobileSnapshot.self, "snapshot")
        XCTAssertEqual(today.date, "2026-11-21", "fixture changed: update the expectations below")
    }

    func testHeaderAndStatusSentence() {
        let m = TodayScreenModel.build(today, units: .metric)
        XCTAssertEqual(m.eyebrow, "Saturday 21 November \u{00B7} W47")
        XCTAssertEqual(m.statusSentence, "Long ride 2h05 \u{2014} Gavarres loop done. You\u{2019}re ready to train.")
        XCTAssertFalse(m.isRestDay)
        XCTAssertNil(m.markersText)
        XCTAssertEqual(m.dayNote, "")
    }

    func testHeroSessionIsThePairedRide() throws {
        let m = TodayScreenModel.build(today, units: .metric)
        let s = try XCTUnwrap(m.sessions.first)
        XCTAssertEqual(m.sessions.count, 1)
        XCTAssertEqual(s.target, .activity(id: "act_uxe16yozne"))
        XCTAssertEqual(s.workoutId, "wk_d20261121_1")
        XCTAssertEqual(s.statusText, "On plan")
        XCTAssertEqual(s.durationText, "2:06")
        XCTAssertEqual(s.amountText, "57.8\u{202F}km")
        XCTAssertEqual(s.summaryLine, "On plan \u{00B7} 2:06 \u{00B7} 57.8\u{202F}km", "no start time once done")
        XCTAssertEqual(s.timeText, "09:26")
        XCTAssertTrue(s.isKey)
        XCTAssertFalse(s.needsLog)
        XCTAssertEqual(s.logSummary, "RPE 4 \u{00B7} Felt okay \u{00B7} \u{201C}57.8 km, 722 m. Coffee in Banyoles, headwind home.\u{201D}")
        XCTAssertFalse(s.canSendToWatch, "done sessions are not sent to the watch")
        XCTAssertFalse(s.profileIsPlan)
        XCTAssertFalse(s.profile.isEmpty)
    }

    func testFreshnessShowsEachNumberOnce() {
        let f = TodayScreenModel.build(today, units: .metric).freshness
        XCTAssertEqual(f.formText, "\u{2212}2")
        XCTAssertEqual(f.zoneWord, "neutral")
        XCTAssertEqual(f.fitnessText, "66")
        XCTAssertEqual(f.fatigueText, "72")
        XCTAssertEqual(f.rampText, "+2.5 a week")
        XCTAssertEqual(f.accessibilityLabel, "Form \u{2212}2, neutral. Fitness 66. Fatigue 72.")
        XCTAssertTrue(f.zoneSummary?.hasSuffix("Form is \u{2212}3% of fitness.") ?? false)
    }

    func testWellnessRowAndCheckIn() {
        let w = TodayScreenModel.build(today, units: .metric).wellness
        XCTAssertEqual(w.metrics.map(\.label), ["HRV", "Resting HR", "Sleep"])
        XCTAssertEqual(w.metrics.map(\.valueText), ["61", "49", "7:51"])
        XCTAssertEqual(w.metrics[0].context, "7-day average \u{00B7} in your normal range")
        XCTAssertNil(w.reasonsText)
        XCTAssertNil(w.feel)
        XCTAssertFalse(w.showsSoreness)

        let checked = TodayScreenModel.build(today.checkingIn(feel: 4), units: .metric).wellness
        XCTAssertEqual(checked.feel, 4)
        XCTAssertTrue(checked.showsSoreness)
        XCTAssertEqual(LogScales.label(checked.feelLabels, checked.feel), "Fresh")
    }

    func testWeekStrip() {
        let w = TodayScreenModel.build(today, units: .metric).week
        XCTAssertEqual(w.weekLabel, "W47")
        XCTAssertEqual(w.hoursText, "7:48")
        XCTAssertEqual(w.plannedText, "of 9:45 planned")
        XCTAssertEqual(w.fraction, 28100.0 / 35087.0, accuracy: 0.0001)
        XCTAssertEqual(w.detailText, "Load 464 of 539 \u{00B7} 3 of 3 key")
        XCTAssertEqual(w.days.map(\.label), ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"])
        XCTAssertEqual(w.days.firstIndex { $0.isToday }, 5)
        XCTAssertEqual(w.days[0].marks.map(\.symbol), ["checkmark.circle.fill", "circle.lefthalf.filled"])
        XCTAssertEqual(w.days[4].marks.map(\.symbol), ["xmark.circle"])
        XCTAssertTrue(w.days[4].marks[0].isDim)
        XCTAssertTrue(w.days[1].hasKey)
        XCTAssertEqual(w.days[0].accessibilityLabel, "Monday: 2 done of 2 planned")
    }

    func testUpNextUsesTomorrowFromTheSnapshotThenEvents() {
        let m = TodayScreenModel.build(today, units: .metric, tomorrow: snapshot.tomorrowSessions)
        XCTAssertEqual(m.upNext.count, 2)
        XCTAssertEqual(m.upNext[0].title, "Trail run 1h30 \u{2014} Gavarres")
        XCTAssertEqual(m.upNext[0].detail, "Tomorrow \u{00B7} 1:30")
        XCTAssertEqual(m.upNext[0].link, .workout(id: "wk_d20261122_1"))
        XCTAssertEqual(m.upNext[1].title, "Riu Ter Half Marathon")
        XCTAssertEqual(m.upNext[1].detail, "In 36 days \u{00B7} B race \u{00B7} Sun 27 Dec")
        XCTAssertEqual(m.upNext[1].daysUntil, 36)
        XCTAssertEqual(m.upNext[1].link, .event(id: "evt_demo_3"))

        let unknown = TodayScreenModel.build(today, units: .metric, tomorrow: nil)
        XCTAssertEqual(unknown.upNext.count, 1, "tomorrow unknown: only the event")
        let empty = TodayScreenModel.build(today, units: .metric, tomorrow: [])
        XCTAssertEqual(empty.upNext.first?.kind, .nothingPlanned)
    }

    func testPendingLogsFromEarlierDays() {
        let m = TodayScreenModel.build(today, units: .metric)
        XCTAssertEqual(m.pendingLogs.map(\.activityId), ["act_u36nc7u0bn", "act_xsctv4f4uc"])
        XCTAssertEqual(m.pendingLogs.map(\.dayText), ["Wednesday", "Tuesday"])
    }

    func testSessionSentences() throws {
        let ride = try XCTUnwrap(today.workouts.first)
        var open = ride
        open.pairedActivityId = nil
        open.compliance = nil
        var second = open
        second.id = "wk_2"
        second.title = "Swim"

        let planned = DayCards.build(workouts: [open], activities: [], date: today.date, units: .metric)
        XCTAssertEqual(TodayScreenModel.sessionSentence(planned, restDay: false), "Long ride 2h05 \u{2014} Gavarres loop today.")
        let two = DayCards.build(workouts: [open, second], activities: [], date: today.date, units: .metric)
        XCTAssertEqual(TodayScreenModel.sessionSentence(two, restDay: false), "2 sessions today.")
        let mixed = DayCards.build(workouts: [ride, second], activities: today.activities, date: today.date, units: .metric)
        XCTAssertEqual(TodayScreenModel.sessionSentence(mixed, restDay: false), "1 done, Swim still to go.")
        XCTAssertEqual(TodayScreenModel.sessionSentence([], restDay: true), "A planned rest day.")
        XCTAssertEqual(TodayScreenModel.sessionSentence([], restDay: false), "Nothing planned today.")
    }

    func testEventDetail() throws {
        var e = try XCTUnwrap(today.nextEvent)
        e.daysUntil = 0
        XCTAssertEqual(TodayScreenModel.eventDetail(e), "Race day")
        e.daysUntil = 1
        XCTAssertEqual(TodayScreenModel.eventDetail(e), "Tomorrow \u{00B7} B race \u{00B7} Sun 27 Dec")
    }

    func testLogScales() {
        XCTAssertEqual(LogScales.rpeWord(7), "Hard")
        XCTAssertNil(LogScales.rpeWord(11))
        XCTAssertEqual(LogScales.rpeRamp(10), 7)
        XCTAssertEqual(LogScales.rpeRamp(1), 1)
        XCTAssertNil(LogScales.activitySummary(rpe: nil, feel: nil, note: "  "))
        XCTAssertEqual(LogScales.activitySummary(rpe: 6, feel: 5, note: nil), "RPE 6 \u{00B7} Felt great")
    }
}
