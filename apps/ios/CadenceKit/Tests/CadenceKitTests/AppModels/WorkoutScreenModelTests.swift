import XCTest
@testable import CadenceKit

final class WorkoutScreenModelTests: XCTestCase {
    func testStructuredRide() throws {
        let w = try Fixtures.decode(PlannedWorkout.self, "workout_structured")
        let m = WorkoutScreenModel.build(w, units: .metric, today: "2026-11-21", now: Date())
        XCTAssertEqual(m.title, "Sweet spot 2\u{00D7}20\u{2032}")
        XCTAssertEqual(m.sportText, "Ride \u{00B7} Indoor")
        XCTAssertEqual(m.dateLine, "Tue 10 Nov \u{00B7} 18:30")
        XCTAssertEqual(m.relativeText, "11 days ago")
        XCTAssertEqual(m.stats.map(\.label), ["Duration", "Distance", "Load"])
        XCTAssertEqual(m.stats.map(\.value), ["1:12", "34.8", "67"])
        XCTAssertEqual(m.stats[1].unit, "km")
        XCTAssertEqual(m.intensityText, "Tempo")
        XCTAssertTrue(m.isKey)
        XCTAssertEqual(m.pairedActivityId, "act_2f9p1pcbj0")
        XCTAssertFalse(m.canSendToWatch, "paired workouts are done")
        XCTAssertNil(m.garminText)
        XCTAssertEqual(m.tagsText, "intervals \u{00B7} sweet-spot")

        XCTAssertEqual(m.steps.map(\.title), ["Warm up", "2 \u{00D7}", "Sweet spot", "Recovery", "Cool down"])
        XCTAssertEqual(m.steps.map(\.depth), [0, 0, 1, 1, 0])
        XCTAssertEqual(m.steps.map(\.amountText), ["12m", "50m", "20m", "5m", "10m"])
        XCTAssertEqual(m.steps.map { $0.targetText ?? "" }, ["50\u{2192}75%", "", "85\u{2013}89% FTP", "50\u{2013}55% FTP", "45\u{2013}55% FTP"])
        XCTAssertEqual(m.steps[0].roleText, "Warm-up")
        XCTAssertEqual(m.steps[1].kind, .repeatHeader)
        XCTAssertNil(m.steps[1].rampIndex)
        XCTAssertEqual(m.steps[2].rampIndex, 3)
        XCTAssertEqual(m.steps[1].accessibilityLabel, "Repeat 2 times, 50m in total")

        let p = m.profile
        XCTAssertEqual(p.totalSec, 4320, accuracy: 0.5, "matches plannedDurationSec")
        XCTAssertEqual(p.bars.count, 6 + 4 + 1, "ramp as six steps, 2 × (work + rest), cool-down")
        XCTAssertEqual(p.bars.reduce(0) { $0 + $1.width }, 1, accuracy: 0.0001)
        XCTAssertEqual(p.bars.last.map { $0.start + $0.width } ?? 0, 1, accuracy: 0.0001)
        XCTAssertLessThan(p.bars[0].height, p.bars[5].height, "the warm-up ramp climbs")
        XCTAssertEqual(p.bars[6].height, 0.87 / 1.3, accuracy: 0.001)
        XCTAssertGreaterThan(p.bars[6].height, p.bars[7].height, "work above rest")
    }

    func testSwimSteps() throws {
        let w = try Fixtures.decode(PlannedWorkout.self, "workout_swim")
        let m = WorkoutScreenModel.build(w, units: .metric, today: "2026-11-21")
        XCTAssertEqual(m.steps[0].title, "400 choice")
        XCTAssertEqual(m.steps[0].amountText, "400\u{202F}m")
        XCTAssertEqual(m.steps[0].targetText, "80\u{2013}88% CSS")
        XCTAssertEqual(m.steps[0].note, "20s rest")
        XCTAssertEqual(m.steps[1].title, "4 \u{00D7}")
        XCTAssertEqual(m.steps[2].note, "Drill \u{00B7} 15s rest")
        let aerobic = try XCTUnwrap(m.steps.first { $0.title == "200 aerobic" })
        XCTAssertEqual(aerobic.note, "Freestyle \u{00B7} on 3:55")
        XCTAssertFalse(m.profile.isEmpty)
        var open = w
        open.pairedActivityId = nil
        open.compliance = nil
        XCTAssertEqual(m.canSendToWatch, w.pairedActivityId == nil)
        XCTAssertTrue(WorkoutScreenModel.build(open, units: .metric, today: "2026-11-01").canSendToWatch)
    }

    func testStrengthSteps() throws {
        let w = try Fixtures.decode(PlannedWorkout.self, "workout_strength")
        let m = WorkoutScreenModel.build(w, units: .metric, today: "2026-11-21")
        XCTAssertEqual(m.steps.map(\.title), ["Back squat", "Plank"])
        XCTAssertEqual(m.steps.map(\.amountText), ["4 \u{00D7} 6", "3 \u{00D7} 45s"])
        XCTAssertEqual(m.steps[0].note, "80.0\u{202F}kg \u{00B7} rest 2:30")
        XCTAssertNil(m.steps[0].rampIndex)
        XCTAssertTrue(m.profile.isEmpty, "no intensity profile for strength")
        XCTAssertEqual(m.stats.first?.label, "Duration")
        XCTAssertFalse(m.stats.contains { $0.label == "Distance" }, "strength has no distance")
    }

    func testSkippedWorkout() throws {
        let w = try Fixtures.decode(PlannedWorkout.self, "workout_skip")
        let m = WorkoutScreenModel.build(w, units: .metric, today: "2026-11-21")
        XCTAssertTrue(m.isSkipped)
        XCTAssertEqual(m.statusText, "Skipped \u{00B7} travel")
        XCTAssertFalse(m.canSendToWatch)
        XCTAssertTrue(m.steps.isEmpty)
        XCTAssertTrue(m.profile.isEmpty)
    }

    func testTargetText() {
        XCTAssertEqual(WorkoutScreenModel.targetText(Target(type: .pace, lowMps: 4.0, highMps: 4.1), sport: .run, units: .metric),
                       "4:04\u{2013}4:10\u{202F}/km")
        XCTAssertEqual(WorkoutScreenModel.targetText(Target(type: .hrZone, zone: 2), sport: .run, units: .metric), "HR Z2")
        XCTAssertEqual(WorkoutScreenModel.targetText(Target(type: .rpe, low: 6, high: 6), sport: .run, units: .metric), "RPE 6")
        XCTAssertEqual(WorkoutScreenModel.targetText(Target(type: .powerW, low: 250, high: 260), sport: .bike, units: .metric), "250\u{2013}260\u{202F}W")
        XCTAssertEqual(WorkoutScreenModel.targetText(Target(type: .pacePct, low: 100, high: 100), sport: .swim, units: .metric), "CSS")
        XCTAssertEqual(WorkoutScreenModel.targetText(Target(type: .ramp, basis: "pace_pct", from: 75, to: 88), sport: .run, units: .metric), "75\u{2192}88% pace")
        XCTAssertEqual(WorkoutScreenModel.targetText(Target(type: .open), sport: .run, units: .metric), "Open")
    }

    func testZoneIndex() {
        XCTAssertEqual(WorkoutScreenModel.zoneIndex(0.5), 1)
        XCTAssertEqual(WorkoutScreenModel.zoneIndex(0.7), 2)
        XCTAssertEqual(WorkoutScreenModel.zoneIndex(0.88), 3)
        XCTAssertEqual(WorkoutScreenModel.zoneIndex(1.0), 4)
        XCTAssertEqual(WorkoutScreenModel.zoneIndex(1.1), 5)
        XCTAssertEqual(WorkoutScreenModel.zoneIndex(1.3), 6)
        XCTAssertEqual(WorkoutScreenModel.zoneIndex(2), 7)
    }

    func testGarminStatusText() throws {
        var w = try Fixtures.decode(PlannedWorkout.self, "workout_swim")
        let now = Instant.parse("2026-11-21T12:00:00Z")!
        w.garmin.syncState = .synced
        w.garmin.lastPushedAt = "2026-11-21T09:00:00.000Z"
        XCTAssertEqual(w.garmin.statusText(now: now), "On your watch \u{00B7} sent 3 h ago")
        XCTAssertEqual(w.garmin.sendButtonTitle, "Send again")
        w.garmin.syncState = .error
        w.garmin.error = "Not connected"
        XCTAssertEqual(w.garmin.statusText(now: now), "Couldn\u{2019}t send: Not connected")
        w.garmin.syncState = .none
        XCTAssertNil(w.garmin.statusText(now: now))
        XCTAssertEqual(w.garmin.sendButtonTitle, "Send to watch")
    }
}
