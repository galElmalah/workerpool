import XCTest
@testable import CadenceKit

/// Decodes every captured server response (Fixtures/index.json) as its Swift root type.
/// scripts/check_fixtures.py checks the same pairs field by field without a compiler and verifies
/// this table has an entry for every root type in index.json.
final class FixtureDecodingTests: XCTestCase {
    private static func d<T: Decodable>(_: T.Type) -> (Data) throws -> Any {
        { data in try APIClient.decode(T.self, from: data) as Any }
    }

    static let decoders: [String: (Data) throws -> Any] = [
        "ActivityPage": d(ActivityPage.self),
        "ActivityDetail": d(ActivityDetail.self),
        "Activity": d(Activity.self),
        "ActivityStreams": d(ActivityStreams.self),
        "AuthStatus": d(AuthStatus.self),
        "CalendarResponse": d(CalendarResponse.self),
        "DayNote?": d(Optional<DayNote>.self),
        "DeviceTokenResponse": d(DeviceTokenResponse.self),
        "DeviceList": d(DeviceList.self),
        "APIErrorEnvelope": d(APIErrorEnvelope.self),
        "[Event]": d([Event].self),
        "GarminLink": d(GarminLink.self),
        "GarminStatus": d(GarminStatus.self),
        "SyncReport": d(SyncReport.self),
        "JournalPage": d(JournalPage.self),
        "[Phase]": d([Phase].self),
        "SearchResponse": d(SearchResponse.self),
        "AthleteSettings": d(AthleteSettings.self),
        "MobileSnapshot": d(MobileSnapshot.self),
        "SyncLogPage": d(SyncLogPage.self),
        "TodayResponse": d(TodayResponse.self),
        "ConsistencyTrend": d(ConsistencyTrend.self),
        "FitnessTrend": d(FitnessTrend.self),
        "IntensityTrend": d(IntensityTrend.self),
        "PeaksTrend": d(PeaksTrend.self),
        "[WeekSummary]": d([WeekSummary].self),
        "WellnessTrend": d(WellnessTrend.self),
        "WeekNote?": d(Optional<WeekNote>.self),
        "WeekReview": d(WeekReview.self),
        "WellnessDay": d(WellnessDay.self),
        "PlannedWorkout": d(PlannedWorkout.self),
        "DeletedWorkouts": d(DeletedWorkouts.self),
        "QuickAddResponse": d(QuickAddResponse.self),
        "[PlannedWorkout]": d([PlannedWorkout].self),
    ]

    func testEveryFixtureDecodes() throws {
        let index = try Fixtures.index()
        XCTAssertGreaterThan(index.count, 40)
        var decoded = 0
        for (file, type) in index.sorted(by: { $0.key < $1.key }) {
            guard let url = Fixtures.url(file) else { continue } // not captured yet (e.g. device routes)
            guard let decode = Self.decoders[type] else {
                XCTFail("no decoder for \(type) (\(file))")
                continue
            }
            do {
                _ = try decode(try Data(contentsOf: url))
                decoded += 1
            } catch {
                XCTFail("\(file) as \(type): \(error)")
            }
        }
        XCTAssertGreaterThan(decoded, 40)
    }

    func testSnapshotFixtureContent() throws {
        let s = try Fixtures.decode(MobileSnapshot.self, "snapshot")
        XCTAssertEqual(s.week.days.count, 7)
        XCTAssertEqual(s.units, .metric)
        XCTAssertFalse(s.status.headline.isEmpty)
        XCTAssertEqual(s.fitnessSeries.count, 42)
        XCTAssertEqual(s.fitnessSeries.last?.date, s.today)
        XCTAssertFalse(s.recentWeeks.isEmpty)
        XCTAssertNotEqual(s.todaySessions.first?.sport, .unknown)
    }

    func testStructuredWorkoutDecodesNestedRepeats() throws {
        let w = try Fixtures.decode(PlannedWorkout.self, "workout_swim")
        let steps = try XCTUnwrap(w.structure?.steps)
        XCTAssertTrue(steps.contains { $0.kind == .repeat && ($0.steps?.isEmpty == false) })
        XCTAssertEqual(w.structure?.poolLengthM, 25)
        let strength = try Fixtures.decode(PlannedWorkout.self, "workout_strength")
        XCTAssertNotNil(strength.structure?.steps.first?.strength?.exercise)
    }

    func testActivityDetailFlattensActivityFields() throws {
        let a = try Fixtures.decode(ActivityDetail.self, "activity_bike")
        XCTAssertEqual(a.sport, .bike)
        XCTAssertEqual(a.id, a.activity.id)
        XCTAssertFalse(a.laps.isEmpty)
        XCTAssertNotNil(a.zones.power)
        XCTAssertNotNil(a.thresholdsUsed.ftp)
        // re-encoding keeps a flat object that decodes again
        let again = try JSONDecoder().decode(ActivityDetail.self, from: JSONEncoder().encode(a))
        XCTAssertEqual(again, a)
    }

    func testActivityLocationFactsLapsAndSwimLengths() throws {
        let run = try Fixtures.decode(ActivityDetail.self, "activity_run")
        XCTAssertEqual(run.locationName, "Girona")
        XCTAssertNotNil(run.facts?.deviceName)
        XCTAssertNotNil(run.facts?.avgGroundContactMs)
        XCTAssertTrue(run.laps.contains { $0.avgGroundContactMs != nil && $0.maxSpeedMps != nil })
        let swim = try Fixtures.decode(ActivityDetail.self, "activity_swim")
        XCTAssertFalse(swim.swimLengths?.isEmpty ?? true)
        XCTAssertTrue(swim.swimLengths?.allSatisfy { $0.durationSec > 0 } ?? false)
        let list = try Fixtures.decode(ActivityPage.self, "activities_list")
        XCTAssertTrue(list.items.contains { $0.locationName != nil })
    }

    func testNullBodiesDecodeAsNil() throws {
        XCTAssertNil(try Fixtures.decode(Optional<DayNote>.self, "day_note_empty"))
        XCTAssertNil(try APIClient.decode(Optional<WeekNote>.self, from: Data("null".utf8)))
        XCTAssertNil(try APIClient.decode(Optional<WeekNote>.self, from: Data()))
    }

    func testUnknownEnumValuesDecodeAsUnknown() throws {
        let json = #"{"id":"x","kind":"planned","sport":"kayak","title":"T","startTime":null,"durationSec":null,"distanceM":null,"load":null,"isKey":false,"intensity":"brutal","state":"postponed","workoutId":null,"activityId":null}"#
        let s = try JSONDecoder().decode(SnapshotSession.self, from: Data(json.utf8))
        XCTAssertEqual(s.sport, .unknown)
        XCTAssertEqual(s.intensity, .unknown)
        XCTAssertEqual(s.state, .unknown)
        XCTAssertEqual(Sport.knownCases.count, 10)
    }

    func testMissingOptionalFieldsAreFine() throws {
        let json = #"{"id":"evt_1","date":"2027-03-01","name":"Race","priority":"A"}"#
        let e = try JSONDecoder().decode(Event.self, from: Data(json.utf8))
        XCTAssertEqual(e.priority, .a)
        XCTAssertNil(e.sport)
    }

    func testSampleDataDecodes() {
        XCTAssertEqual(MobileSnapshot.preview.week.days.count, 7)
    }
}
