import Foundation

// The connect screen's error states (docs/MOBILE_API.md §1): wrong passphrase, throttled with a
// countdown, unreachable server, bad address — each with one plain sentence and the field to fix.

public enum ConnectField: Hashable, Sendable {
    case server, passphrase, deviceName
}

public enum ConnectFailure: Hashable, Sendable {
    case invalidAddress(String)
    case wrongPassphrase
    /// too many attempts; `until` is when the server accepts the next try (nil: unknown)
    case throttled(until: Date?)
    case unreachable(offline: Bool)
    case notConfigured
    case other(String)

    public init(_ error: APIError, now: Date) {
        switch error {
        case .invalidBaseURL(let reason): self = .invalidAddress(reason)
        case .server(let code, let message, let status):
            if code == "invalid_passphrase" || status == 401 { self = .wrongPassphrase }
            else if code == "not_configured" { self = .notConfigured }
            else if status == 404 { self = .other("That address answered, but it is not a Cadence server.") }
            else { self = .other(message) }
        case .throttled(let retry, _, _): self = .throttled(until: retry.map { now.addingTimeInterval($0) })
        case .transport(_, let offline): self = .unreachable(offline: offline)
        case .decoding: self = .other("That address answered, but not like a Cadence server. Check the address.")
        case .unauthorized: self = .wrongPassphrase
        case .notConnected: self = .other(error.message)
        }
    }

    /// The field the person should look at.
    public var field: ConnectField? {
        switch self {
        case .invalidAddress, .unreachable, .notConfigured: return .server
        case .wrongPassphrase: return .passphrase
        case .throttled, .other: return nil
        }
    }

    /// Whole seconds until a throttled connect may be retried (nil when not throttled or unknown).
    public func secondsRemaining(now: Date) -> Int? {
        guard case .throttled(let until?) = self else { return nil }
        return max(0, Int(until.timeIntervalSince(now).rounded(.up)))
    }

    /// Connecting is blocked until the throttle window has passed.
    public func blocksRetry(now: Date) -> Bool { (secondsRemaining(now: now) ?? 0) > 0 }

    public func message(now: Date) -> String {
        switch self {
        case .invalidAddress(let reason): return reason
        case .wrongPassphrase: return "That passphrase is not right. It is the one you use on the web app."
        case .throttled:
            if let s = secondsRemaining(now: now), s > 0 { return "Too many attempts. Try again in \(ConnectFailure.countdown(s))." }
            return "Too many attempts. You can try again now."
        case .unreachable(let offline):
            return offline ? "This iPhone is offline. Connect to the internet and try again."
                : "Couldn\u{2019}t reach that server. Check the address and that the server is running."
        case .notConfigured: return "That server has no passphrase set yet. Set one up in the web app first."
        case .other(let message): return message
        }
    }

    /// 75 → "1:15", 9 → "9 s"
    public static func countdown(_ seconds: Int) -> String {
        seconds < 60 ? "\(seconds)\u{202F}s" : "\(seconds / 60):\(zeroPad(seconds % 60, 2))"
    }
}

public enum ConnectForm {
    /// Trimmed, at most 64 characters (server rule); "iPhone" when empty.
    public static func deviceName(_ raw: String) -> String {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "iPhone" : String(t.prefix(64))
    }

    public static func canSubmit(server: String, passphrase: String) -> Bool {
        !server.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !passphrase.isEmpty
    }
}
