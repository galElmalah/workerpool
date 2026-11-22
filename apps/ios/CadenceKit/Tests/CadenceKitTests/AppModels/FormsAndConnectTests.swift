import XCTest
@testable import CadenceKit

final class FormsAndConnectTests: XCTestCase {
    // MARK: New workout

    func testNewWorkoutDraftDefaults() {
        var d = NewWorkoutDraft(date: "2026-11-24")
        XCTAssertTrue(d.isValid)
        XCTAssertEqual(d.suggestedTitle, "Endurance run")
        XCTAssertEqual(d.durationText, "45m")
        let input = d.input()
        XCTAssertEqual(input.title, "Endurance run")
        XCTAssertEqual(input.plannedDurationSec, 2700)
        XCTAssertEqual(input.sport, .run)
        XCTAssertEqual(input.intensity, .endurance)
        XCTAssertEqual(input.isKey, false)
        XCTAssertNil(input.startTime)

        d.title = "  Hill reps  "
        d.sport = .bike
        d.durationMin = 90
        d.intensity = .threshold
        d.isKey = true
        d.startTime = "18:30"
        XCTAssertEqual(d.suggestedTitle, "Threshold ride")
        XCTAssertEqual(d.durationText, "1h\u{202F}30m")
        let i2 = d.input()
        XCTAssertEqual(i2.title, "Hill reps")
        XCTAssertEqual(i2.plannedDurationSec, 5400)
        XCTAssertEqual(i2.startTime, "18:30")
        XCTAssertEqual(i2.isKey, true)

        XCTAssertFalse(NewWorkoutDraft(date: "not a date").isValid)
    }

    // MARK: Edit basics

    func testEditDraftPatchesOnlyChanges() throws {
        let w = try Fixtures.decode(PlannedWorkout.self, "workout_structured")
        var d = WorkoutEditDraft(w)
        XCTAssertEqual(d.durationMin, 72)
        XCTAssertEqual(d.startTime, "18:30")
        XCTAssertNil(d.patch(from: w), "untouched draft sends nothing")

        d.date = "2026-11-12"
        d.startTime = nil
        let p = try XCTUnwrap(d.patch(from: w))
        XCTAssertEqual(p.date, "2026-11-12")
        XCTAssertEqual(p.startTime, .null)
        XCTAssertNil(p.title)
        XCTAssertNil(p.plannedDurationSec)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONCoding.encode(p)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["date", "startTime"])

        d = WorkoutEditDraft(w)
        d.title = "Sweet spot 3×15′"
        d.durationMin = 80
        let p2 = try XCTUnwrap(d.patch(from: w))
        XCTAssertEqual(p2.title, "Sweet spot 3×15′")
        XCTAssertEqual(p2.plannedDurationSec, .value(4800))

        d.title = "   "
        XCTAssertFalse(d.isValid)
    }

    func testClockAndPickerDates() throws {
        XCTAssertEqual(ClockTime.string(hour: 7, minute: 5), "07:05")
        XCTAssertEqual(ClockTime.parse("18:30")?.hour, 18)
        XCTAssertNil(ClockTime.parse("25:00"))
        let date = ClockTime.date("06:45", on: "2026-11-22", timeZone: madrid)
        XCTAssertEqual(ClockTime.string(from: date, timeZone: madrid), "06:45")
        XCTAssertEqual(PickerDate.local(date, timeZone: madrid), "2026-11-22")
        XCTAssertEqual(PickerDate.local(PickerDate.date("2026-03-29", timeZone: madrid), timeZone: madrid), "2026-03-29", "DST day")
        XCTAssertEqual(DurationField.minutes(4320), 72)
        XCTAssertNil(DurationField.minutes(nil))
        XCTAssertEqual(DurationField.step(below: 8), 1)
        XCTAssertEqual(DurationField.step(below: 45), 5)
    }

    // MARK: Connect

    func testConnectFailures() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let wrong = ConnectFailure(.server(code: "invalid_passphrase", message: "Wrong passphrase", status: 401), now: now)
        XCTAssertEqual(wrong, .wrongPassphrase)
        XCTAssertEqual(wrong.field, .passphrase)

        let throttled = ConnectFailure(.throttled(retryAfter: 75, code: "too_many_attempts", message: "Too many attempts."), now: now)
        XCTAssertEqual(throttled.secondsRemaining(now: now), 75)
        XCTAssertTrue(throttled.blocksRetry(now: now))
        XCTAssertEqual(throttled.message(now: now), "Too many attempts. Try again in 1:15.")
        XCTAssertEqual(throttled.message(now: now.addingTimeInterval(66)), "Too many attempts. Try again in 9\u{202F}s.")
        XCTAssertFalse(throttled.blocksRetry(now: now.addingTimeInterval(80)))
        XCTAssertEqual(throttled.message(now: now.addingTimeInterval(80)), "Too many attempts. You can try again now.")

        let offline = ConnectFailure(.transport(message: "x", offline: true), now: now)
        XCTAssertEqual(offline, .unreachable(offline: true))
        XCTAssertEqual(offline.field, .server)
        XCTAssertTrue(offline.message(now: now).contains("offline"))

        XCTAssertEqual(ConnectFailure(.invalidBaseURL(reason: "Use https://"), now: now), .invalidAddress("Use https://"))
        XCTAssertEqual(ConnectFailure(.server(code: "not_configured", message: "", status: 400), now: now), .notConfigured)
        XCTAssertEqual(ConnectFailure(.server(code: "not_found", message: "Not found", status: 404), now: now).field, nil)
    }

    func testConnectForm() {
        XCTAssertEqual(ConnectForm.deviceName("  "), "iPhone")
        XCTAssertEqual(ConnectForm.deviceName(String(repeating: "a", count: 80)).count, 64)
        XCTAssertFalse(ConnectForm.canSubmit(server: " ", passphrase: "x"))
        XCTAssertTrue(ConnectForm.canSubmit(server: "cadence.example.com", passphrase: "x"))
    }
}
