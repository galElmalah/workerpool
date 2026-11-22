import Foundation
#if canImport(Security)
import Security
#endif

/// What the phone keeps after connecting: the server origin, the device token and the device row.
/// Stored as one item so the widget extension reads everything it needs in a single keychain query.
public struct DeviceCredentials: Codable, Hashable, Sendable {
    public var serverURL: URL
    /// "cad_…" bearer token
    public var token: String
    public var deviceId: String?
    public var deviceName: String?
    public var connectedAt: IsoInstant?

    public init(serverURL: URL, token: String, deviceId: String? = nil, deviceName: String? = nil, connectedAt: IsoInstant? = nil) {
        self.serverURL = serverURL; self.token = token; self.deviceId = deviceId; self.deviceName = deviceName
        self.connectedAt = connectedAt
    }
}

/// Persistence for `DeviceCredentials`. `APIClient` reads it on every request and clears it on 401.
public protocol TokenStore: AnyObject, Sendable {
    func load() -> DeviceCredentials?
    func save(_ credentials: DeviceCredentials) throws
    func clear()
}

extension TokenStore {
    public var token: String? { load()?.token }
    public var isConnected: Bool { load() != nil }
}

/// For tests, previews and Linux.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: DeviceCredentials?

    public init(_ credentials: DeviceCredentials? = nil) { value = credentials }

    public func load() -> DeviceCredentials? {
        lock.lock(); defer { lock.unlock() }
        return value
    }

    public func save(_ credentials: DeviceCredentials) throws {
        lock.lock(); defer { lock.unlock() }
        value = credentials
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        value = nil
    }
}

#if canImport(Security)
public enum KeychainError: Error, Equatable, Sendable {
    case status(OSStatus)
}

/// Keychain-backed store shared between the app and the widget extension.
///
/// `accessGroup` must be the full keychain access group including the team prefix, e.g.
/// "ABCDE12345.com.example.cadence.shared" — both targets list it under `keychain-access-groups`
/// (project.yml) and read it from Info.plist key `CadenceKeychainGroup` (`AppGroupConfig`).
/// Pass nil to use the app's default group (no sharing; e.g. in unit tests on macOS).
/// Accessibility is "after first unlock, this device only": widgets refresh while the phone is
/// locked, and the token never syncs to iCloud or migrates to another device.
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    public let service: String
    public let account: String
    public let accessGroup: String?

    public init(service: String = "app.cadence.device", account: String = "credentials", accessGroup: String?) {
        self.service = service; self.account = account; self.accessGroup = accessGroup
    }

    private func baseQuery(group: String?) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    /// The shared group first; without the keychain-sharing entitlement (unsigned simulator builds)
    /// SecItem* returns errSecMissingEntitlement and we fall back to the app's default group, so the
    /// app still works (the widget then cannot read the token until signing is set up).
    private var groups: [String?] { accessGroup == nil ? [nil] : [accessGroup, nil] }

    public func load() -> DeviceCredentials? {
        for group in groups {
            var q = baseQuery(group: group)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            let status = SecItemCopyMatching(q as CFDictionary, &item)
            if status == errSecSuccess, let data = item as? Data {
                return try? JSONDecoder().decode(DeviceCredentials.self, from: data)
            }
            if status != errSecMissingEntitlement && status != errSecItemNotFound { return nil }
        }
        return nil
    }

    public func save(_ credentials: DeviceCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        var lastStatus: OSStatus = errSecSuccess
        for group in groups {
            lastStatus = write(data, group: group)
            if lastStatus != errSecMissingEntitlement { break }
        }
        guard lastStatus == errSecSuccess else { throw KeychainError.status(lastStatus) }
    }

    private func write(_ data: Data, group: String?) -> OSStatus {
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(baseQuery(group: group) as CFDictionary, attrs as CFDictionary)
        guard status == errSecItemNotFound else { return status }
        var add = baseQuery(group: group)
        for (k, v) in attrs { add[k] = v }
        return SecItemAdd(add as CFDictionary, nil)
    }

    public func clear() {
        for group in groups { SecItemDelete(baseQuery(group: group) as CFDictionary) }
    }
}
#endif
