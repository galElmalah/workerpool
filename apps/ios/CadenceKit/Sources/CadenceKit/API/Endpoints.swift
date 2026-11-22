import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Every Worker route the app uses, as typed `Endpoint`s. Shapes: apps/web/worker/routes/*.ts.
/// `APIClient` wraps each one in a method; use these directly for `client.cached(_:)`.
public enum Endpoints {
    // MARK: Auth & devices (docs/MOBILE_API.md §1)

    struct DeviceRequest: Encodable { let passphrase: String; let name: String; let platform: String }

    public static func createDevice(passphrase: String, name: String) -> Endpoint<DeviceTokenResponse> {
        var ep = Endpoint<DeviceTokenResponse>.send(.post, "/api/auth/devices",
                                                    json: DeviceRequest(passphrase: passphrase, name: String(name.prefix(64)), platform: "ios"))
        ep.requiresAuth = false
        return ep
    }

    public static func devices() -> Endpoint<DeviceList> { .get("/api/auth/devices", cache: false) }
    public static func revokeDevice(id: String) -> Endpoint<EmptyResponse> { Endpoint(.delete, "/api/auth/devices/\(Path.segment(id))") }
    public static func revokeCurrentDevice() -> Endpoint<EmptyResponse> { Endpoint(.delete, "/api/auth/devices/current") }

    public static func authStatus() -> Endpoint<AuthStatus> {
        var ep = Endpoint<AuthStatus>.get("/api/auth/status", cache: false)
        ep.requiresAuth = false
        return ep
    }

    // MARK: Snapshot, today, calendar

    public static func snapshot() -> Endpoint<MobileSnapshot> { .get("/api/mobile/snapshot") }
    public static func today() -> Endpoint<TodayResponse> { .get("/api/today") }

    /// Expanded server-side to whole ISO weeks; max 400 days.
    public static func calendar(from: LocalDate, to: LocalDate) -> Endpoint<CalendarResponse> {
        .get("/api/calendar", query: [.item("from", from), .item("to", to)])
    }

    // MARK: Workouts

    public static func workouts(from: LocalDate? = nil, to: LocalDate? = nil) -> Endpoint<[PlannedWorkout]> {
        .get("/api/workouts", query: [.item("from", from), .item("to", to)])
    }

    public static func workout(id: String) -> Endpoint<PlannedWorkout> { .get("/api/workouts/\(Path.segment(id))") }

    public static func createWorkout(_ input: WorkoutInput) -> Endpoint<PlannedWorkout> {
        .send(.post, "/api/workouts", json: input)
    }

    public static func patchWorkout(id: String, _ patch: WorkoutPatch, scope: SeriesScope? = nil) -> Endpoint<PlannedWorkout> {
        .send(.patch, "/api/workouts/\(Path.segment(id))", json: patch, query: scope.map { [URLQueryItem(name: "scope", value: $0.rawValue)] } ?? [])
    }

    public static func deleteWorkout(id: String, scope: SeriesScope? = nil) -> Endpoint<DeletedWorkouts> {
        Endpoint(.delete, "/api/workouts/\(Path.segment(id))", query: scope.map { [URLQueryItem(name: "scope", value: $0.rawValue)] } ?? [])
    }

    struct DateBody: Encodable { let date: LocalDate }
    public static func duplicateWorkout(id: String, to date: LocalDate) -> Endpoint<PlannedWorkout> {
        .send(.post, "/api/workouts/\(Path.segment(id))/duplicate", json: DateBody(date: date))
    }

    struct SkipBody: Encodable { let reason: String }
    public static func skipWorkout(id: String, reason: SkipReason) -> Endpoint<PlannedWorkout> {
        .send(.post, "/api/workouts/\(Path.segment(id))/skip", json: SkipBody(reason: reason == .unknown ? "other" : reason.rawValue))
    }

    public static func unskipWorkout(id: String) -> Endpoint<PlannedWorkout> {
        Endpoint(.delete, "/api/workouts/\(Path.segment(id))/skip")
    }

    struct QuickBody: Encodable { let date: LocalDate; let text: String; let startTime: String? }
    /// Quick-add grammar: "run 45m easy", "bike 4x8m 95-100% @key", "swim 3km".
    public static func quickAdd(date: LocalDate, text: String, startTime: String? = nil) -> Endpoint<QuickAddResponse> {
        .send(.post, "/api/workouts/quick", json: QuickBody(date: date, text: text, startTime: startTime))
    }

    struct RestoreBody: Encodable { let workouts: [PlannedWorkout] }
    /// Undo for deletes: re-inserts the rows returned by `deleteWorkout`.
    public static func restoreWorkouts(_ workouts: [PlannedWorkout]) -> Endpoint<RestoredWorkouts> {
        .send(.post, "/api/calendar/restore", json: RestoreBody(workouts: workouts))
    }

    // MARK: Activities

    public static func activities(_ q: ActivityQuery = ActivityQuery()) -> Endpoint<ActivityPage> {
        .get("/api/activities", query: [
            .item("from", q.from), .item("to", q.to), .item("sport", q.sport?.rawValue), .item("q", q.text),
            .item("key", q.keyOnly.map { $0 ? "1" : "0" }), .item("intensity", q.intensity?.rawValue),
            .item("limit", q.limit), .item("cursor", q.cursor),
        ], cache: q.cursor == nil)
    }

    public static func activity(id: String) -> Endpoint<ActivityDetail> { .get("/api/activities/\(Path.segment(id))") }

    /// Always thinned server-side (LTTB) to `maxPoints` so the payload stays small.
    public static func streams(activityId: String, maxPoints: Int = 1200) -> Endpoint<ActivityStreams> {
        .get("/api/activities/\(Path.segment(activityId))/streams", query: [.item("maxPoints", max(10, maxPoints))])
    }

    public static func patchActivity(id: String, _ patch: ActivityPatch) -> Endpoint<Activity> {
        .send(.patch, "/api/activities/\(Path.segment(id))", json: patch)
    }

    public static func createManualActivity(_ input: ManualActivityInput) -> Endpoint<Activity> {
        .send(.post, "/api/activities/manual", json: input)
    }

    // MARK: Trends

    public static func fitness(from: LocalDate? = nil, to: LocalDate? = nil, sport: Sport? = nil) -> Endpoint<FitnessTrend> {
        .get("/api/trends/fitness", query: [.item("from", from), .item("to", to), .item("sport", sport?.rawValue)])
    }

    public static func weekly(weeks: Int = 12, end: LocalDate? = nil) -> Endpoint<[WeekSummary]> {
        .get("/api/trends/weekly", query: [.item("weeks", weeks), .item("end", end)])
    }

    public static func intensity(weeks: Int = 12) -> Endpoint<IntensityTrend> {
        .get("/api/trends/intensity", query: [.item("weeks", weeks)])
    }

    /// ranges: "42d", "90d", "season", "last_season", "all", "2025" (max 6)
    public static func peaks(sport: Sport, ranges: [String] = ["42d", "90d", "season", "all"]) -> Endpoint<PeaksTrend> {
        .get("/api/trends/peaks", query: [.item("sport", sport.rawValue), .item("ranges", ranges.joined(separator: ","))])
    }

    public static func wellnessTrend(from: LocalDate? = nil, to: LocalDate? = nil) -> Endpoint<WellnessTrend> {
        .get("/api/trends/wellness", query: [.item("from", from), .item("to", to)])
    }

    public static func consistency(days: Int = 365) -> Endpoint<ConsistencyTrend> {
        .get("/api/trends/consistency", query: [.item("days", days)])
    }

    // MARK: Week review, journal, notes, wellness

    public static func week(_ isoWeek: IsoWeek) -> Endpoint<WeekReview> { .get("/api/weeks/\(Path.segment(isoWeek))") }

    /// `types` filters (comma-joined); `query` is a text search.
    public static func journal(cursor: String? = nil, types: [JournalType] = [], query: String? = nil, limit: Int = 30) -> Endpoint<JournalPage> {
        let t = types.filter { $0 != .unknown }.map(\.rawValue).joined(separator: ",")
        return .get("/api/journal", query: [.item("cursor", cursor), .item("type", t.isEmpty ? nil : t), .item("q", query), .item("limit", limit)],
                    cache: cursor == nil && query == nil)
    }

    public static func dayNote(date: LocalDate) -> Endpoint<DayNote?> { .get("/api/day-notes/\(Path.segment(date))") }

    struct BodyText: Encodable { let body: String }
    /// An empty body deletes the note (response `nil`).
    public static func putDayNote(date: LocalDate, body: String) -> Endpoint<DayNote?> {
        .send(.put, "/api/day-notes/\(Path.segment(date))", json: BodyText(body: body))
    }

    public static func weekNote(_ isoWeek: IsoWeek) -> Endpoint<WeekNote?> { .get("/api/week-notes/\(Path.segment(isoWeek))") }

    public static func putWeekNote(_ isoWeek: IsoWeek, _ input: WeekNoteInput) -> Endpoint<WeekNote> {
        .send(.put, "/api/week-notes/\(Path.segment(isoWeek))", json: input)
    }

    public static func wellness(date: LocalDate) -> Endpoint<WellnessDay> { .get("/api/wellness/\(Path.segment(date))") }

    public static func checkIn(date: LocalDate, _ input: WellnessCheckIn) -> Endpoint<WellnessDay> {
        .send(.put, "/api/wellness/\(Path.segment(date))", json: input)
    }

    // MARK: Events

    public static func events(from: LocalDate? = nil, to: LocalDate? = nil) -> Endpoint<[Event]> {
        .get("/api/events", query: [.item("from", from), .item("to", to)])
    }

    public static func createEvent(_ input: EventInput) -> Endpoint<Event> { .send(.post, "/api/events", json: input) }
    public static func patchEvent(id: String, _ patch: EventPatch) -> Endpoint<Event> { .send(.patch, "/api/events/\(Path.segment(id))", json: patch) }
    public static func deleteEvent(id: String) -> Endpoint<Event> { Endpoint(.delete, "/api/events/\(Path.segment(id))") }
    public static func phases() -> Endpoint<[Phase]> { .get("/api/phases") }

    // MARK: Settings & Garmin

    public static func settings() -> Endpoint<AthleteSettings> { .get("/api/settings") }
    public static func patchSettings(_ patch: SettingsPatch) -> Endpoint<AthleteSettings> { .send(.patch, "/api/settings", json: patch) }

    public static func garminStatus() -> Endpoint<GarminStatus> { .get("/api/garmin/status") }
    public static func garminSync() -> Endpoint<SyncReport> { Endpoint(.post, "/api/garmin/sync") }
    public static func pushWorkout(id: String) -> Endpoint<GarminLink> { Endpoint(.post, "/api/garmin/push/\(Path.segment(id))") }
    public static func syncLog(limit: Int = 20) -> Endpoint<SyncLogPage> { .get("/api/sync/log", query: [.item("limit", limit)], cache: false) }

    // MARK: Search

    public static func search(_ text: String) -> Endpoint<SearchResponse> {
        .get("/api/search", query: [.item("q", text)], cache: false)
    }
}
