import Foundation
import SwiftUI
import AppIntents
import WidgetKit
import CadenceKit

// Plumbing for the App Intents (compiled into the app AND the widget extension; both read the same
// App Group and the same keychain access group, see AppGroupConfig / KeychainTokenStore).

/// An error Siri / Shortcuts can show as a sentence.
struct CadenceIntentError: Error, CustomLocalizedStringResourceConvertible {
    let message: String

    var localizedStringResource: LocalizedStringResource { "\(message)" }

    static func from(_ error: Error) -> CadenceIntentError {
        if let e = error as? CadenceIntentError { return e }
        if let e = error as? APIError { return CadenceIntentError(message: IntentCopy.message(for: e)) }
        return CadenceIntentError(message: IntentCopy.message(for: .transport(message: error.localizedDescription, offline: false)))
    }
}

enum IntentServices {
    static var config: AppGroupConfig { AppGroupConfig.fromInfoPlist() }
    static var snapshotCache: SnapshotCache { SnapshotCache(directory: config.containerURL) }
    static var checkIns: CheckInStore { CheckInStore(defaults: config.defaults) }
    static var accent: Accent { SharedPreferences(defaults: config.defaults).accent }

    /// A client for the stored device token, or a "connect first" error.
    static func client() throws -> APIClient {
        let store = KeychainTokenStore(accessGroup: config.keychainGroup)
        guard let client = APIClient.restore(tokenStore: store,
                                             transport: URLSessionTransport(session: URLSessionTransport.defaultSession(timeout: 20))) else {
            throw CadenceIntentError(message: IntentCopy.notConnected)
        }
        return client
    }

    /// The cached snapshot when fresh, else a new one (falling back to the cache when offline).
    static func latestSnapshot(now: Date = Date()) async throws -> SnapshotCache.Entry {
        let cache = snapshotCache
        let cached = cache.load()
        if let cached, !WidgetRefresh.shouldFetch(fetchedAt: cached.fetchedAt, now: now) { return cached }
        let client = try client()
        do {
            let s = try await client.refreshSnapshot(into: cache, now: now)
            WidgetCenter.shared.reloadAllTimelines()
            return SnapshotCache.Entry(snapshot: s, fetchedAt: now)
        } catch {
            if let cached, (error as? APIError)?.isOffline ?? true { return cached }
            throw CadenceIntentError.from(error)
        }
    }

    /// After a write: refresh the widget cache and reload every widget (ENGINEERING.md convention).
    static func didWrite(_ client: APIClient) async {
        _ = try? await client.refreshSnapshot(into: snapshotCache)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Hands app-opening intents (iOS 17 has no OpenURLIntent) to the app's navigation.
/// The app observes it: `.onReceive(IntentNavigator.shared.$pendingLink.compactMap { $0 }) { model.pendingLink = $0; IntentNavigator.shared.pendingLink = nil }`.
@MainActor
final class IntentNavigator: ObservableObject {
    static let shared = IntentNavigator()
    @Published var pendingLink: DeepLink?

    func open(_ link: DeepLink) {
        pendingLink = link
    }
}
