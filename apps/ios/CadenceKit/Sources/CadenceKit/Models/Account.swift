import Foundation

// Auth/devices, settings, thresholds, Garmin, journal, search.

// MARK: - Auth & devices (docs/MOBILE_API.md §1)

public enum DevicePlatform: String, TolerantEnum {
    case ios, other
    case unknown
}

public struct Device: Codable, Hashable, Sendable, Identifiable {
    /// "dev_…"
    public var id: String
    public var name: String
    public var platform: DevicePlatform
    public var createdAt: IsoInstant
    /// updated at most once per hour
    public var lastUsedAt: IsoInstant?
}

/// `POST /api/auth/devices` response. The token is shown once; the server keeps only its hash.
public struct DeviceTokenResponse: Codable, Hashable, Sendable {
    /// "cad_" + 43 url-safe base64 chars
    public var token: String
    public var device: Device
}

public struct DeviceList: Codable, Hashable, Sendable {
    public var devices: [Device]
}

public struct AuthStatus: Codable, Hashable, Sendable {
    public var configured: Bool
    public var authenticated: Bool
    public var demo: Bool?
}

// MARK: - Settings

public enum WeekStart: String, TolerantEnum {
    case monday, sunday
    case unknown
}

public enum ThemePreference: String, TolerantEnum {
    case dark, light, system
    case unknown
}

public enum Density: String, TolerantEnum {
    case comfortable, compact
    case unknown
}

public enum HomeRoute: String, TolerantEnum {
    case today, calendar
    case unknown
}

public enum Sex: String, TolerantEnum {
    case male, female, unspecified
    case unknown
}

/// `GET /api/settings` (domain.ts `Settings`; renamed here because SwiftUI declares a `Settings` scene type).
public struct AthleteSettings: Codable, Hashable, Sendable {
    public var name: String
    public var sex: Sex
    public var birthYear: Int?
    public var units: UnitSystem
    public var weekStart: WeekStart
    /// IANA zone, e.g. "Europe/Madrid"
    public var timezone: String
    public var theme: ThemePreference
    public var accent: Accent
    public var density: Density
    public var reducedMotion: Bool
    public var homeRoute: HomeRoute
    /// push planned workouts this many days ahead
    public var garminAutoPushDays: Int
    public var onboarded: Bool
}

/// `PATCH /api/settings` body: only the fields that change.
public struct SettingsPatch: Codable, Hashable, Sendable {
    public var name: String?
    public var units: UnitSystem?
    public var weekStart: WeekStart?
    public var timezone: String?
    public var theme: ThemePreference?
    public var accent: Accent?
    public var reducedMotion: Bool?
    public var garminAutoPushDays: Int?

    public init(name: String? = nil, units: UnitSystem? = nil, weekStart: WeekStart? = nil, timezone: String? = nil,
                theme: ThemePreference? = nil, accent: Accent? = nil, reducedMotion: Bool? = nil, garminAutoPushDays: Int? = nil) {
        self.name = name; self.units = units; self.weekStart = weekStart; self.timezone = timezone; self.theme = theme
        self.accent = accent; self.reducedMotion = reducedMotion; self.garminAutoPushDays = garminAutoPushDays
    }
}

/// Effective-dated threshold: a metric on date D uses the latest entry with effectiveFrom ≤ D.
public struct Threshold: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var kind: ThresholdKind
    /// a Sport raw value or "all"
    public var sport: String
    public var value: Double
    public var effectiveFrom: LocalDate
    public var source: ThresholdSource
    public var note: String?
}

// MARK: - Garmin

public enum GarminState: String, TolerantEnum {
    case disconnected
    case needsMfa = "needs_mfa"
    case connected, error
    case unknown
}

/// `GET /api/garmin/status`. fixture-ignore: credentials, backfillProgress
public struct GarminStatus: Codable, Hashable, Sendable {
    public var connected: Bool
    public var state: GarminState
    public var displayName: String?
    public var lastSyncAt: IsoInstant?
    public var lastError: String?
    public var capabilities: GarminCapabilities?
    public var counts: GarminCounts?
    public var demo: Bool?
    public var backfill: BackfillSummary?
}

public struct GarminCapabilities: Codable, Hashable, Sendable {
    public var read: Bool
    /// push workouts needs write
    public var write: Bool
}

public struct GarminCounts: Codable, Hashable, Sendable {
    public var activities: Int
    public var garminActivities: Int?
    public var workoutsSynced: Int?
    public var workoutsPending: Int?
    public var workoutsError: Int?
    public var oldestGarminDate: LocalDate?
}

public struct BackfillSummary: Codable, Hashable, Sendable {
    public var running: Bool
    public var done: Int
    public var total: Int?
    public var oldestDate: LocalDate?
}

/// `POST /api/garmin/sync` response. Errors come back as HTTP errors (429 garmin_rate_limited,
/// 409 sync_in_progress / garmin_not_connected, 502 …). fixture-ignore: backfill
public struct SyncReport: Codable, Hashable, Sendable {
    /// "ok" | "error" | "skipped"
    public var status: String
    public var reason: String
    public var skippedBecause: String?
    public var activities: SyncActivityCounts
    public var wellnessDays: Int
    public var thresholds: Int
    public var push: SyncPushCounts
    public var requests: Int
    public var durationMs: Double
    /// One sentence, e.g. "2 new activities, wellness 1 day"
    public var summary: String
    public var error: APIErrorBody?
}

public struct SyncActivityCounts: Codable, Hashable, Sendable {
    public var created: Int
    public var updated: Int
    public var unchanged: Int
    public var deleted: Int
    public var failed: Int
    public var queued: Int
    public var complete: Bool
}

public struct SyncPushCounts: Codable, Hashable, Sendable {
    public var pushed: Int
    public var removed: Int
    public var failed: Int
    public var remaining: Int
}

public enum SyncLogKind: String, TolerantEnum {
    case pullActivities = "pull_activities"
    case pullWellness = "pull_wellness"
    case pushWorkout = "push_workout"
    case backfill, auth, recompute
    case unknown
}

public enum SyncLogStatus: String, TolerantEnum {
    case ok, error, running
    case unknown
}

public struct SyncLogEntry: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var at: IsoInstant
    public var kind: SyncLogKind
    public var status: SyncLogStatus
    public var summary: String
    public var detail: String?
    public var durationMs: Double?
}

/// `GET /api/sync/log`
public struct SyncLogPage: Codable, Hashable, Sendable {
    public var entries: [SyncLogEntry]
    public var nextCursor: String?
}

// MARK: - Journal

public enum JournalType: String, TolerantEnum {
    case week, day
    case workoutPre = "workout_pre"
    case activityPost = "activity_post"
    case unknown
}

public struct JournalItem: Codable, Hashable, Sendable {
    public var type: JournalType
    public var date: LocalDate
    public var title: String
    public var body: String
    /// day → date, workout_pre → workout id, activity_post → activity id, week → ISO week
    public var ref: String
    public var sport: Sport?
    public var rpe: Int?
    public var feel: Int?
}

/// `GET /api/journal?cursor&type&q&limit`
public struct JournalPage: Codable, Hashable, Sendable {
    public var items: [JournalItem]
    public var nextCursor: String?
}

// MARK: - Search

public enum SearchItemType: String, TolerantEnum {
    case date, week, month, workout, activity, template, event
    case unknown
}

public enum SearchGroupType: String, TolerantEnum {
    case jump, workouts, activities, templates, events
    case unknown
}

public struct SearchItem: Codable, Hashable, Sendable {
    public var type: SearchItemType
    public var id: String
    public var title: String
    public var subtitle: String?
    public var date: LocalDate?
    /// web route, e.g. "/workouts/wk_…" — map with `DeepLink(webPath:)`
    public var href: String
}

public struct SearchGroup: Codable, Hashable, Sendable {
    public var type: SearchGroupType
    public var label: String
    public var items: [SearchItem]
}

/// `GET /api/search?q`
public struct SearchResponse: Codable, Hashable, Sendable {
    public var q: String
    public var groups: [SearchGroup]
}
