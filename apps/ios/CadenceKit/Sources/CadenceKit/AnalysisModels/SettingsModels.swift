import Foundation

// Settings, Garmin and Devices screens.

extension UnitSystem {
    public var settingsLabel: String {
        switch self {
        case .metric: return "Metric"
        case .imperial: return "Imperial"
        case .unknown: return "Metric"
        }
    }
}

extension ThemePreference {
    public var settingsLabel: String {
        switch self {
        case .system: return "System"
        case .dark: return "Dark"
        case .light: return "Light"
        case .unknown: return "System"
        }
    }

    /// Order for the appearance picker.
    public static var pickerCases: [ThemePreference] { [.system, .light, .dark] }
}

extension Accent {
    public var settingsLabel: String {
        switch self {
        case .blue: return "Blue"
        case .green: return "Green"
        case .rose: return "Rose"
        case .unknown: return "Blue"
        }
    }
}

extension WeekStart {
    public var settingsLabel: String {
        switch self {
        case .monday: return "Monday"
        case .sunday: return "Sunday"
        case .unknown: return "Monday"
        }
    }
}

extension Sex {
    public var settingsLabel: String {
        switch self {
        case .male: return "Male"
        case .female: return "Female"
        case .unspecified, .unknown: return "Not set"
        }
    }
}

public enum SettingsText {
    /// "Born 1987" / nil
    public static func birthYear(_ y: Int?) -> String? { y.map { "Born \($0)" } }

    /// "cadence.example.com" (host[:port]) for the server row.
    public static func serverHost(_ url: URL) -> String {
        guard let host = url.host else { return url.absoluteString }
        if let port = url.port { return "\(host):\(port)" }
        return host
    }

    /// "Push planned workouts 7 days ahead" / "Off"
    public static func autoPush(_ days: Int) -> String {
        days <= 0 ? "Off" : "\(days) day\(days == 1 ? "" : "s") ahead"
    }

    public static let autoPushOptions = [0, 3, 7, 14]
}

// MARK: - Garmin

public struct GarminStatusModel: Hashable, Sendable {
    /// "Connected", "Not connected", "Needs verification", "Error"
    public var stateText: String
    /// "as Jonas Weber"
    public var accountText: String?
    /// "Last sync 12 h ago"
    public var lastSyncText: String
    /// "1,234 activities · 3 workouts waiting to push"
    public var countsText: String?
    /// backfill progress, "Importing history: 120 of 400"
    public var backfillText: String?
    public var errorText: String?
    public var canSync: Bool
    public var isDemo: Bool

    public init(status s: GarminStatus, now: Date) {
        switch s.state {
        case .connected: stateText = "Connected"
        case .disconnected: stateText = "Not connected"
        case .needsMfa: stateText = "Needs verification"
        case .error: stateText = "Sync problem"
        case .unknown: stateText = s.connected ? "Connected" : "Not connected"
        }
        accountText = s.displayName.flatMap { $0.isEmpty ? nil : "as \($0)" }
        if let d = Instant.parse(s.lastSyncAt) {
            lastSyncText = "Last sync \(Format.ago(d, now: now))"
        } else {
            lastSyncText = "Never synced"
        }
        var counts: [String] = []
        if let c = s.counts {
            let n = c.garminActivities ?? c.activities
            counts.append("\(Format.number(Double(n))) \(n == 1 ? "activity" : "activities")")
            if let p = c.workoutsPending, p > 0 { counts.append("\(p) workout\(p == 1 ? "" : "s") waiting to push") }
            if let e = c.workoutsError, e > 0 { counts.append("\(e) failed to push") }
        }
        countsText = counts.isEmpty ? nil : counts.joined(separator: Format.dot)
        if let b = s.backfill, b.running {
            backfillText = b.total.map { "Importing history: \(b.done) of \($0)" } ?? "Importing history: \(b.done) so far"
        } else {
            backfillText = nil
        }
        errorText = s.lastError.flatMap { $0.isEmpty ? nil : $0 }
        canSync = s.connected || s.state == .connected
        isDemo = s.demo ?? false
    }
}

public struct SyncLogRowModel: Hashable, Sendable, Identifiable {
    public var id: String
    /// "Activities", "Wellness", "Workout push"…
    public var kindText: String
    public var summary: String
    /// "3 h ago · 2.4 s"
    public var whenText: String
    public var isError: Bool
    public var isRunning: Bool
    public var detail: String?
    /// SF Symbol (neutral): checkmark, exclamationmark.triangle, arrow.triangle.2.circlepath
    public var symbol: String

    public init(entry e: SyncLogEntry, now: Date) {
        id = e.id
        kindText = SyncLogRowModel.kindLabel(e.kind)
        summary = e.summary.isEmpty ? kindText : e.summary
        var when = [Format.ago(Instant.parse(e.at), now: now)]
        if let ms = e.durationMs, ms > 0 { when.append("\(Format.number(ms / 1000, decimals: 1))\(Format.unitSpace)s") }
        whenText = when.joined(separator: Format.dot)
        isError = e.status == .error
        isRunning = e.status == .running
        detail = e.detail.flatMap { $0.isEmpty ? nil : $0 }
        switch e.status {
        case .error: symbol = "exclamationmark.triangle"
        case .running: symbol = "arrow.triangle.2.circlepath"
        default: symbol = "checkmark"
        }
    }

    public static func kindLabel(_ k: SyncLogKind) -> String {
        switch k {
        case .pullActivities: return "Activities"
        case .pullWellness: return "Wellness"
        case .pushWorkout: return "Workout push"
        case .backfill: return "History import"
        case .auth: return "Sign-in"
        case .recompute: return "Recompute"
        case .unknown: return "Sync"
        }
    }
}

/// Copy after "Sync now".
public enum SyncResultText {
    public static func text(_ r: SyncReport) -> String {
        if r.status == "skipped" { return r.skippedBecause.map { "Skipped: \($0)" } ?? "Nothing to sync right now." }
        if r.status == "error" { return r.error?.message ?? "Sync failed." }
        return r.summary.isEmpty ? "Up to date." : r.summary.prefix(1).uppercased() + r.summary.dropFirst()
    }

    /// Friendly copy for sync errors by server code.
    public static func error(_ e: APIError) -> String {
        switch e.code {
        case "sync_in_progress": return "A sync is already running."
        case "garmin_not_connected": return "Garmin isn't connected. Connect it in the web app."
        case "garmin_rate_limited": return "Garmin asked us to slow down. Try again in a few minutes."
        default: return e.message
        }
    }
}

// MARK: - Devices

public struct DeviceRowModel: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var isCurrent: Bool
    /// "iPhone · added 21 Nov 2026 · used 3 h ago"
    public var detail: String
    public var symbol: String

    public init(device d: Device, currentDeviceId: String?, now: Date, timeZone: TimeZone = .current) {
        id = d.id
        name = d.name.isEmpty ? "Unnamed device" : d.name
        isCurrent = d.id == currentDeviceId
        var parts: [String] = []
        if isCurrent { parts.append("This iPhone") }
        if let created = Instant.parse(d.createdAt) {
            parts.append("added \(Format.dateMedium(Day(created, timeZone: timeZone).string, withYear: true))")
        }
        if isCurrent {
            // nothing: "used just now" is implied
        } else if let used = Instant.parse(d.lastUsedAt) {
            parts.append("used \(Format.ago(used, now: now))")
        } else {
            parts.append("never used")
        }
        detail = parts.joined(separator: Format.dot)
        symbol = d.platform == .ios ? "iphone" : "laptopcomputer"
    }

    /// Current device first, then by name order from the server (newest first).
    public static func rows(_ devices: [Device], currentDeviceId: String?, now: Date, timeZone: TimeZone = .current) -> [DeviceRowModel] {
        let rows = devices.map { DeviceRowModel(device: $0, currentDeviceId: currentDeviceId, now: now, timeZone: timeZone) }
        return rows.filter(\.isCurrent) + rows.filter { !$0.isCurrent }
    }
}
