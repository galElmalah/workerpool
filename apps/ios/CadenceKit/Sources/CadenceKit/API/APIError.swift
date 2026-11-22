import Foundation

/// Every error `APIClient` throws.
public enum APIError: Error, Equatable, Sendable {
    /// 401 on an authenticated call: the device token is missing, unknown or revoked. The client has
    /// already cleared the stored token; show the connect screen.
    case unauthorized
    /// 429 (login throttling, Garmin rate limits). `retryAfter` from the `Retry-After` header, seconds.
    case throttled(retryAfter: TimeInterval?, code: String, message: String)
    /// Any other non-2xx with the server's `{ error: { code, message } }` (e.g. 401 invalid_passphrase
    /// on connect, 404 not_found, 409 sync_in_progress, 400 validation). `message` is user-presentable.
    case server(code: String, message: String, status: Int)
    /// The request never got an HTTP response (offline, DNS, TLS, timeout). `offline` is true for
    /// connectivity errors where cached data should be shown.
    case transport(message: String, offline: Bool)
    /// 2xx but the body did not decode as the expected type (contract drift). `detail` names the path.
    case decoding(detail: String)
    /// Base URL is malformed or plain HTTP to a public host.
    case invalidBaseURL(reason: String)
    /// No device token stored — connect first.
    case notConnected

    /// One line suitable for an inline error message.
    public var message: String {
        switch self {
        case .unauthorized: return "This device was signed out. Connect again."
        case .throttled(let retry, _, let message):
            if let retry { return "\(message.isEmpty ? "Too many attempts." : message) Try again in \(Int(retry.rounded(.up))) s." }
            return message.isEmpty ? "Too many requests. Try again shortly." : message
        case .server(_, let message, _): return message
        case .transport(let message, let offline): return offline ? "You're offline." : message
        case .decoding: return "The server sent something this app version does not understand."
        case .invalidBaseURL(let reason): return reason
        case .notConnected: return "Not connected to a Cadence server."
        }
    }

    /// Server error code when there is one ("invalid_passphrase", "not_found", …).
    public var code: String? {
        switch self {
        case .unauthorized: return "unauthorized"
        case .throttled(_, let code, _): return code
        case .server(let code, _, _): return code
        default: return nil
        }
    }

    /// True when showing cached data is the right reaction.
    public var isOffline: Bool {
        if case .transport(_, let offline) = self { return offline }
        return false
    }
}

extension APIError: LocalizedError {
    public var errorDescription: String? { message }
}
