import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum CadenceKitInfo {
    /// Sent as `X-Cadence-Client: ios/<version>` unless the app passes its own version.
    public static let version = "0.1.0"
}

/// Async client for the Cadence Worker API (docs/MOBILE_API.md, docs/ARCHITECTURE.md → API surface).
///
/// - Every request sends `Accept: application/json`, `X-Cadence-Client: ios/<version>` and, when a
///   token is stored, `Authorization: Bearer <token>`.
/// - A 401 on an authenticated call clears the `TokenStore`, calls `onUnauthorized`, and throws
///   `APIError.unauthorized` (go back to the connect screen).
/// - 429 → `APIError.throttled(retryAfter:…)`; other non-2xx → `APIError.server(code:message:status:)`;
///   no response → `APIError.transport(…)`; body/contract mismatch → `APIError.decoding`.
/// - Successful GETs are written to the optional `ResponseCache`; read them with `cached(_:)`.
/// Thread-safe; share one instance.
public final class APIClient: @unchecked Sendable {
    public let baseURL: URL
    public let tokenStore: TokenStore
    public let responseCache: ResponseCache?
    private let transport: HTTPTransport
    private let clientHeader: String
    private let onUnauthorized: (@Sendable () -> Void)?

    /// - Parameters:
    ///   - baseURL: the server origin (`ServerAddress.normalize` output), e.g. https://cadence.example.com
    ///   - appVersion: goes into `X-Cadence-Client: ios/<appVersion>`
    ///   - onUnauthorized: called (on an arbitrary thread) after a 401 cleared the token
    public init(baseURL: URL, tokenStore: TokenStore, transport: HTTPTransport = URLSessionTransport(),
                responseCache: ResponseCache? = nil, appVersion: String = CadenceKitInfo.version,
                onUnauthorized: (@Sendable () -> Void)? = nil) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        self.transport = transport
        self.responseCache = responseCache
        self.clientHeader = "ios/\(appVersion)"
        self.onUnauthorized = onUnauthorized
    }

    /// A client for the stored credentials, or nil when this device is not connected.
    public static func restore(tokenStore: TokenStore, transport: HTTPTransport = URLSessionTransport(),
                               responseCache: ResponseCache? = nil, appVersion: String = CadenceKitInfo.version,
                               onUnauthorized: (@Sendable () -> Void)? = nil) -> APIClient? {
        guard let creds = tokenStore.load() else { return nil }
        return APIClient(baseURL: creds.serverURL, tokenStore: tokenStore, transport: transport,
                         responseCache: responseCache, appVersion: appVersion, onUnauthorized: onUnauthorized)
    }

    // MARK: Core

    /// Builds the URLRequest for an endpoint (exposed for tests).
    public func makeRequest<T: Decodable>(_ endpoint: Endpoint<T>, token: String?) -> URLRequest {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        comps.percentEncodedPath = endpoint.path
        let items = endpoint.query.filter { $0.value != nil }
        if !items.isEmpty {
            comps.queryItems = items
            // URLComponents leaves "+" alone; servers read it as a space.
            comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        var req = URLRequest(url: comps.url ?? baseURL)
        req.httpMethod = endpoint.method.rawValue
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(clientHeader, forHTTPHeaderField: "X-Cadence-Client")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body = endpoint.body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    /// Sends any endpoint and decodes its response.
    @discardableResult
    public func send<T: Decodable>(_ endpoint: Endpoint<T>) async throws -> T {
        let token = tokenStore.token
        if endpoint.requiresAuth && token == nil { throw APIError.notConnected }
        let request = makeRequest(endpoint, token: token)

        let result: (Data, HTTPURLResponse)
        do {
            result = try await transport.send(request)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIClient.transportError(error)
        }
        let (data, response) = result

        let status = response.statusCode
        guard (200..<300).contains(status) else {
            throw handleFailure(status: status, data: data, response: response, endpoint: endpoint)
        }
        let value: T = try APIClient.decode(T.self, from: data)
        if endpoint.method == .get, let key = endpoint.cacheKey, let cache = responseCache, !data.isEmpty {
            cache.store(data, for: cacheNamespace + key)
        }
        return value
    }

    /// The last successful response for a GET endpoint, if cached and still decodable.
    public func cached<T: Decodable>(_ endpoint: Endpoint<T>) -> Cached<T>? {
        guard let key = endpoint.cacheKey, let cache = responseCache,
              let hit = cache.data(for: cacheNamespace + key),
              let value = try? APIClient.decode(T.self, from: hit.data) else { return nil }
        return Cached(value: value, storedAt: hit.storedAt)
    }

    /// Keeps caches of two servers apart.
    private var cacheNamespace: String { baseURL.absoluteString + "|" }

    private func handleFailure<T: Decodable>(status: Int, data: Data, response: HTTPURLResponse, endpoint: Endpoint<T>) -> APIError {
        let body = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
        let code = body?.error.code ?? APIClient.defaultCode(status)
        let message = body?.error.message ?? HTTPURLResponse.localizedString(forStatusCode: status).capitalizedFirst
        if status == 401 && endpoint.requiresAuth && code != "invalid_passphrase" {
            tokenStore.clear()
            responseCache?.removeAll()
            onUnauthorized?()
            return .unauthorized
        }
        if status == 429 {
            let retry = (response.value(forHTTPHeaderField: "Retry-After")).flatMap { TimeInterval($0.trimmingCharacters(in: .whitespaces)) }
            return .throttled(retryAfter: retry, code: code, message: message)
        }
        return .server(code: code, message: message, status: status)
    }

    static func defaultCode(_ status: Int) -> String {
        switch status {
        case 400: return "bad_request"
        case 401: return "unauthorized"
        case 403: return "forbidden"
        case 404: return "not_found"
        case 409: return "conflict"
        case 429: return "too_many_requests"
        default: return status >= 500 ? "internal" : "http_\(status)"
        }
    }

    static func transportError(_ error: Error) -> Error {
        if error is CancellationError { return error }
        if let u = error as? URLError {
            if u.code == .cancelled { return CancellationError() }
            let offlineCodes: [URLError.Code] = [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost,
                                                 .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff]
            return APIError.transport(message: u.localizedDescription, offline: offlineCodes.contains(u.code))
        }
        return APIError.transport(message: String(describing: error), offline: false)
    }

    /// Decodes a response body; handles 204/empty bodies and top-level `null` for optional types.
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        if T.self == EmptyResponse.self, let empty = EmptyResponse() as? T { return empty }
        let trimmed = String(decoding: data.prefix(16), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if let optional = T.self as? OptionalDecodable.Type, data.isEmpty || trimmed == "null" {
            if let none = optional.nilValue as? T { return none }
        }
        do {
            return try JSONCoding.makeDecoder().decode(T.self, from: data)
        } catch let error as DecodingError {
            throw APIError.decoding(detail: APIClient.describe(error, type: "\(T.self)"))
        } catch {
            throw APIError.decoding(detail: "\(T.self): \(error)")
        }
    }

    static func describe(_ error: DecodingError, type: String) -> String {
        func path(_ ctx: DecodingError.Context) -> String {
            ctx.codingPath.map { $0.intValue.map { "[\($0)]" } ?? ".\($0.stringValue)" }.joined()
        }
        switch error {
        case .keyNotFound(let key, let ctx): return "\(type)\(path(ctx)).\(key.stringValue): missing"
        case .typeMismatch(let t, let ctx): return "\(type)\(path(ctx)): expected \(t)"
        case .valueNotFound(let t, let ctx): return "\(type)\(path(ctx)): null for \(t)"
        case .dataCorrupted(let ctx): return "\(type)\(path(ctx)): \(ctx.debugDescription)"
        @unknown default: return "\(type): \(error)"
        }
    }
}

/// Lets `decode` return nil for `T?` when the body is `null`.
protocol OptionalDecodable { static var nilValue: Any { get } }
extension Optional: OptionalDecodable {
    static var nilValue: Any { Optional<Wrapped>.none as Any }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

// MARK: - Typed endpoint methods

extension APIClient {
    // Auth & devices

    /// Exchanges the passphrase for a device token and stores it (with this client's server URL).
    /// Throws `.server(code: "invalid_passphrase")`, `.throttled`, `.server(code: "not_configured")`.
    @discardableResult
    public func connect(passphrase: String, deviceName: String) async throws -> Device {
        let res = try await send(Endpoints.createDevice(passphrase: passphrase, name: deviceName))
        try tokenStore.save(DeviceCredentials(serverURL: baseURL, token: res.token, deviceId: res.device.id,
                                              deviceName: res.device.name, connectedAt: res.device.createdAt))
        return res.device
    }

    /// Revokes this device's token on the server (best effort) and always clears local state.
    public func signOut() async {
        if tokenStore.token != nil {
            _ = try? await send(Endpoints.revokeCurrentDevice())
        }
        tokenStore.clear()
        responseCache?.removeAll()
    }

    public func authStatus() async throws -> AuthStatus { try await send(Endpoints.authStatus()) }
    public func devices() async throws -> [Device] { try await send(Endpoints.devices()).devices }
    public func revokeDevice(id: String) async throws { try await send(Endpoints.revokeDevice(id: id)) }

    // Snapshot, today, calendar

    public func snapshot() async throws -> MobileSnapshot { try await send(Endpoints.snapshot()) }

    /// Fetches the snapshot and writes it to the widget cache (call `WidgetCenter.reloadAllTimelines()` after).
    @discardableResult
    public func refreshSnapshot(into cache: SnapshotCache, now: Date = Date()) async throws -> MobileSnapshot {
        let s = try await snapshot()
        try? cache.save(s, fetchedAt: now)
        return s
    }

    public func today() async throws -> TodayResponse { try await send(Endpoints.today()) }

    public func calendar(from: LocalDate, to: LocalDate) async throws -> CalendarResponse {
        try await send(Endpoints.calendar(from: from, to: to))
    }

    // Workouts

    public func workouts(from: LocalDate? = nil, to: LocalDate? = nil) async throws -> [PlannedWorkout] {
        try await send(Endpoints.workouts(from: from, to: to))
    }

    public func workout(id: String) async throws -> PlannedWorkout { try await send(Endpoints.workout(id: id)) }
    public func createWorkout(_ input: WorkoutInput) async throws -> PlannedWorkout { try await send(Endpoints.createWorkout(input)) }

    public func patchWorkout(id: String, _ patch: WorkoutPatch, scope: SeriesScope? = nil) async throws -> PlannedWorkout {
        try await send(Endpoints.patchWorkout(id: id, patch, scope: scope))
    }

    /// Returns the deleted rows; pass them to `restoreWorkouts` for undo.
    public func deleteWorkout(id: String, scope: SeriesScope? = nil) async throws -> [PlannedWorkout] {
        try await send(Endpoints.deleteWorkout(id: id, scope: scope)).deleted
    }

    public func restoreWorkouts(_ workouts: [PlannedWorkout]) async throws -> [PlannedWorkout] {
        try await send(Endpoints.restoreWorkouts(workouts)).restored
    }

    /// Moves a workout to another day (re-pairs both days server-side).
    public func moveWorkout(id: String, to date: LocalDate) async throws -> PlannedWorkout {
        var p = WorkoutPatch()
        p.date = date
        return try await patchWorkout(id: id, p)
    }

    public func duplicateWorkout(id: String, to date: LocalDate) async throws -> PlannedWorkout {
        try await send(Endpoints.duplicateWorkout(id: id, to: date))
    }

    public func skipWorkout(id: String, reason: SkipReason) async throws -> PlannedWorkout {
        try await send(Endpoints.skipWorkout(id: id, reason: reason))
    }

    public func unskipWorkout(id: String) async throws -> PlannedWorkout { try await send(Endpoints.unskipWorkout(id: id)) }

    public func quickAdd(date: LocalDate, text: String, startTime: String? = nil) async throws -> QuickAddResponse {
        try await send(Endpoints.quickAdd(date: date, text: text, startTime: startTime))
    }

    public func setWorkoutKey(id: String, _ isKey: Bool) async throws -> PlannedWorkout {
        var p = WorkoutPatch()
        p.isKey = isKey
        return try await patchWorkout(id: id, p)
    }

    public func setWorkoutIntensity(id: String, _ intensity: IntensityClass) async throws -> PlannedWorkout {
        var p = WorkoutPatch()
        p.intensity = intensity
        return try await patchWorkout(id: id, p)
    }

    /// Pre-workout note; nil or "" clears it.
    public func setWorkoutNote(id: String, _ note: String?) async throws -> PlannedWorkout {
        var p = WorkoutPatch()
        p.preNote = (note?.isEmpty ?? true) ? Nullable<String>.null : Nullable<String>.value(note!)
        return try await patchWorkout(id: id, p)
    }

    // Activities

    public func activities(_ query: ActivityQuery = ActivityQuery()) async throws -> ActivityPage {
        try await send(Endpoints.activities(query))
    }

    public func activity(id: String) async throws -> ActivityDetail { try await send(Endpoints.activity(id: id)) }

    public func streams(activityId: String, maxPoints: Int = 1200) async throws -> ActivityStreams {
        try await send(Endpoints.streams(activityId: activityId, maxPoints: maxPoints))
    }

    public func patchActivity(id: String, _ patch: ActivityPatch) async throws -> Activity {
        try await send(Endpoints.patchActivity(id: id, patch))
    }

    /// RPE 1…10, nil clears.
    public func setRPE(activityId: String, _ rpe: Int?) async throws -> Activity {
        try await patchActivity(id: activityId, ActivityPatch(rpe: Nullable(rpe)))
    }

    /// Feel 1 (awful) … 5 (great), nil clears.
    public func setFeel(activityId: String, _ feel: Int?) async throws -> Activity {
        try await patchActivity(id: activityId, ActivityPatch(feel: Nullable(feel)))
    }

    /// Post-activity note; nil or "" clears it.
    public func setActivityNote(activityId: String, _ note: String?) async throws -> Activity {
        try await patchActivity(id: activityId, ActivityPatch(postNote: (note?.isEmpty ?? true) ? Nullable<String>.null : Nullable<String>.value(note!)))
    }

    public func setActivityKey(activityId: String, _ isKey: Bool) async throws -> Activity {
        try await patchActivity(id: activityId, ActivityPatch(isKey: isKey))
    }

    /// Override the auto-classified intensity; nil returns to auto.
    public func setActivityIntensity(activityId: String, _ intensity: IntensityClass?) async throws -> Activity {
        try await patchActivity(id: activityId, ActivityPatch(intensityOverride: Nullable(intensity)))
    }

    public func createManualActivity(_ input: ManualActivityInput) async throws -> Activity {
        try await send(Endpoints.createManualActivity(input))
    }

    // Trends

    public func fitness(from: LocalDate? = nil, to: LocalDate? = nil, sport: Sport? = nil) async throws -> FitnessTrend {
        try await send(Endpoints.fitness(from: from, to: to, sport: sport))
    }

    public func weekly(weeks: Int = 12, end: LocalDate? = nil) async throws -> [WeekSummary] {
        try await send(Endpoints.weekly(weeks: weeks, end: end))
    }

    public func intensity(weeks: Int = 12) async throws -> IntensityTrend { try await send(Endpoints.intensity(weeks: weeks)) }

    public func peaks(sport: Sport, ranges: [String] = ["42d", "90d", "season", "all"]) async throws -> PeaksTrend {
        try await send(Endpoints.peaks(sport: sport, ranges: ranges))
    }

    public func wellnessTrend(from: LocalDate? = nil, to: LocalDate? = nil) async throws -> WellnessTrend {
        try await send(Endpoints.wellnessTrend(from: from, to: to))
    }

    public func consistency(days: Int = 365) async throws -> ConsistencyTrend { try await send(Endpoints.consistency(days: days)) }

    // Week review, journal, notes, wellness

    public func week(_ isoWeek: IsoWeek) async throws -> WeekReview { try await send(Endpoints.week(isoWeek)) }

    public func journal(cursor: String? = nil, types: [JournalType] = [], query: String? = nil, limit: Int = 30) async throws -> JournalPage {
        try await send(Endpoints.journal(cursor: cursor, types: types, query: query, limit: limit))
    }

    public func dayNote(date: LocalDate) async throws -> DayNote? { try await send(Endpoints.dayNote(date: date)) }

    /// Saves the day note; an empty body deletes it (returns nil).
    public func setDayNote(date: LocalDate, body: String) async throws -> DayNote? {
        try await send(Endpoints.putDayNote(date: date, body: body))
    }

    public func weekNote(_ isoWeek: IsoWeek) async throws -> WeekNote? { try await send(Endpoints.weekNote(isoWeek)) }

    public func setWeekNote(_ isoWeek: IsoWeek, _ input: WeekNoteInput) async throws -> WeekNote {
        try await send(Endpoints.putWeekNote(isoWeek, input))
    }

    public func wellness(date: LocalDate) async throws -> WellnessDay { try await send(Endpoints.wellness(date: date)) }

    /// Morning check-in (feel / soreness / note / weight) — also used by the interactive widget.
    public func checkIn(date: LocalDate, _ input: WellnessCheckIn) async throws -> WellnessDay {
        try await send(Endpoints.checkIn(date: date, input))
    }

    // Events

    public func events(from: LocalDate? = nil, to: LocalDate? = nil) async throws -> [Event] {
        try await send(Endpoints.events(from: from, to: to))
    }

    public func createEvent(_ input: EventInput) async throws -> Event { try await send(Endpoints.createEvent(input)) }
    public func patchEvent(id: String, _ patch: EventPatch) async throws -> Event { try await send(Endpoints.patchEvent(id: id, patch)) }
    public func deleteEvent(id: String) async throws -> Event { try await send(Endpoints.deleteEvent(id: id)) }
    public func phases() async throws -> [Phase] { try await send(Endpoints.phases()) }

    // Settings & Garmin

    public func settings() async throws -> AthleteSettings { try await send(Endpoints.settings()) }
    public func patchSettings(_ patch: SettingsPatch) async throws -> AthleteSettings { try await send(Endpoints.patchSettings(patch)) }
    public func garminStatus() async throws -> GarminStatus { try await send(Endpoints.garminStatus()) }

    /// Runs a Garmin sync now. Throws `.server(code: "sync_in_progress" | "garmin_not_connected", …)`
    /// or `.throttled(code: "garmin_rate_limited")`.
    public func syncNow() async throws -> SyncReport { try await send(Endpoints.garminSync()) }

    /// Pushes (or re-pushes) one planned workout to Garmin Connect.
    public func pushWorkout(id: String) async throws -> GarminLink { try await send(Endpoints.pushWorkout(id: id)) }

    public func syncLog(limit: Int = 20) async throws -> SyncLogPage { try await send(Endpoints.syncLog(limit: limit)) }

    // Search

    public func search(_ text: String) async throws -> SearchResponse { try await send(Endpoints.search(text)) }
}
