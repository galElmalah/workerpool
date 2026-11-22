import XCTest
@testable import CadenceKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Live contract tests against a running Worker. Skipped unless both are set:
///
///     CADENCE_BASE_URL=http://localhost:5240 CADENCE_PASSPHRASE=cadence-demo swift test --filter IntegrationTests
///
/// Creates a device token (the suite's own "CadenceKit tests" device), exercises every read
/// endpoint the app uses plus a few reversible writes (day note set + clear, workout create →
/// patch → skip → unskip → delete → restore → delete, activity RPE set + restore, check-in), then
/// revokes the token. Use a demo/dev server: the writes are undone but do touch data.
final class IntegrationTests: XCTestCase {
    private var client: APIClient!
    private var store: InMemoryTokenStore!

    override func setUp() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let base = env["CADENCE_BASE_URL"], let pass = env["CADENCE_PASSPHRASE"], !base.isEmpty else {
            throw XCTSkip("set CADENCE_BASE_URL and CADENCE_PASSPHRASE to run the live suite")
        }
        store = InMemoryTokenStore()
        client = APIClient(baseURL: try ServerAddress.normalize(base), tokenStore: store,
                           transport: URLSessionTransport(session: URLSessionTransport.defaultSession(timeout: 60)),
                           appVersion: "tests")
        let device = try await client.connect(passphrase: pass, deviceName: "CadenceKit tests")
        XCTAssertTrue(device.id.hasPrefix("dev_"))
        XCTAssertTrue(store.token?.hasPrefix("cad_") ?? false)
    }

    override func tearDown() async throws {
        if let client { await client.signOut() }
    }

    func testReadEndpoints() async throws {
        let status = try await client.authStatus()
        XCTAssertTrue(status.authenticated, "bearer token must authenticate /api/auth/status")
        let devices = try await client.devices()
        XCTAssertTrue(devices.contains { $0.name == "CadenceKit tests" })

        let snap = try await client.snapshot()
        XCTAssertEqual(snap.week.days.count, 7)
        let today = try await client.today()
        XCTAssertEqual(today.date, snap.today)
        let day = Day(snap.today)!

        let cal = try await client.calendar(from: day.weekStart.adding(days: -7).string, to: day.weekEnd.string)
        XCTAssertEqual(cal.weeks.count, 2)
        _ = try await client.workouts(from: day.weekStart.string, to: day.weekEnd.string)
        if let w = cal.workouts.first { _ = try await client.workout(id: w.id) }

        let page = try await client.activities(ActivityQuery(limit: 5))
        if let a = page.items.first {
            let detail = try await client.activity(id: a.id)
            XCTAssertEqual(detail.id, a.id)
            if a.hasStreams {
                let s = try await client.streams(activityId: a.id, maxPoints: 100)
                XCTAssertLessThanOrEqual(s.t.count, 100)
            }
        }

        _ = try await client.fitness(from: day.adding(days: -30).string, to: day.adding(days: 14).string)
        _ = try await client.weekly(weeks: 4)
        _ = try await client.intensity(weeks: 4)
        _ = try await client.peaks(sport: .bike, ranges: ["42d", "season"])
        _ = try await client.peaks(sport: .run, ranges: ["42d"])
        _ = try await client.wellnessTrend(from: day.adding(days: -6).string, to: day.string)
        _ = try await client.consistency(days: 30)
        _ = try await client.week(day.adding(days: -7).isoWeek)
        _ = try await client.journal(limit: 10)
        _ = try await client.dayNote(date: day.string)
        _ = try await client.weekNote(day.isoWeek)
        _ = try await client.wellness(date: day.string)
        _ = try await client.events()
        _ = try await client.phases()
        _ = try await client.settings()
        _ = try await client.garminStatus()
        _ = try await client.syncLog(limit: 5)
        _ = try await client.search("ride")
        _ = try await client.search("tomorrow")
    }

    func testReversibleWrites() async throws {
        let snap = try await client.snapshot()
        let day = Day(snap.today)!
        let future = day.adding(days: 60).string

        // day note: set, then clear (empty body deletes → nil)
        let before = try await client.dayNote(date: future)
        let note = try await client.setDayNote(date: future, body: "CadenceKit integration test")
        XCTAssertEqual(note?.body, "CadenceKit integration test")
        let cleared = try await client.setDayNote(date: future, body: before?.body ?? "")
        XCTAssertEqual(cleared?.body, before?.body)

        // workout lifecycle
        let created = try await client.createWorkout(WorkoutInput(date: future, sport: .run, title: "CadenceKit test run", plannedDurationSec: 2700))
        XCTAssertEqual(created.date, future)
        let moved = try await client.moveWorkout(id: created.id, to: day.adding(days: 61).string)
        XCTAssertEqual(moved.date, day.adding(days: 61).string)
        let keyed = try await client.setWorkoutKey(id: created.id, true)
        XCTAssertTrue(keyed.isKey)
        let skipped = try await client.skipWorkout(id: created.id, reason: .travel)
        XCTAssertEqual(skipped.status, .skipped)
        let unskipped = try await client.unskipWorkout(id: created.id)
        XCTAssertEqual(unskipped.status, .planned)
        let deleted = try await client.deleteWorkout(id: created.id)
        XCTAssertEqual(deleted.map(\.id), [created.id])
        let restored = try await client.restoreWorkouts(deleted)
        XCTAssertEqual(restored.first?.id, created.id)
        _ = try await client.deleteWorkout(id: created.id)

        let quick = try await client.quickAdd(date: future, text: "bike 60m endurance")
        XCTAssertEqual(quick.workout.sport, .bike)
        _ = try await client.deleteWorkout(id: quick.workout.id)

        // activity RPE: set and restore
        if let a = try await client.activities(ActivityQuery(limit: 1)).items.first {
            let updated = try await client.setRPE(activityId: a.id, 7)
            XCTAssertEqual(updated.rpe, 7)
            _ = try await client.setRPE(activityId: a.id, a.rpe)
        }

        // wellness check-in: write the values back unchanged
        let w = try await client.wellness(date: day.string)
        let checked = try await client.checkIn(date: day.string, WellnessCheckIn(feel: Nullable(w.feel), soreness: Nullable(w.soreness)))
        XCTAssertEqual(checked.feel, w.feel)
    }

    func testRevokedTokenIsUnauthorized() async throws {
        let token = try XCTUnwrap(store.token)
        try await client.send(Endpoints.revokeCurrentDevice())
        try store.save(DeviceCredentials(serverURL: client.baseURL, token: token))
        do {
            _ = try await client.snapshot()
            XCTFail("a revoked token must be rejected")
        } catch let e as APIError {
            XCTAssertEqual(e, .unauthorized)
        }
        XCTAssertNil(store.load())
    }
}
