import Foundation
import SwiftUI
import UIKit
import WidgetKit
import CadenceKit

/// App-wide state: connection, the API client, the latest snapshot and appearance.
/// Screens read it from the environment (`@EnvironmentObject var model: AppModel`).
@MainActor
final class AppModel: ObservableObject {
    enum Phase: Equatable {
        /// no stored device token → connect screen
        case signedOut
        case signedIn
    }

    @Published private(set) var phase: Phase
    @Published private(set) var snapshot: MobileSnapshot?
    @Published private(set) var snapshotFetchedAt: Date?
    @Published private(set) var isRefreshing = false
    @Published var lastError: APIError?
    @Published private(set) var accent: Accent
    @Published private(set) var themePreference: ThemePreference
    /// set by `.onOpenURL`; screens navigate and then clear it
    @Published var pendingLink: DeepLink?

    let config: AppGroupConfig
    let tokenStore: TokenStore
    let snapshotCache: SnapshotCache
    let responseCache: ResponseCache
    let preferences: SharedPreferences
    private(set) var client: APIClient?

    init() {
        let config = AppGroupConfig.fromInfoPlist()
        let tokenStore = KeychainTokenStore(accessGroup: config.keychainGroup)
        let snapshotCache = SnapshotCache(directory: config.containerURL)
        let preferences = SharedPreferences(defaults: config.defaults)
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let cached = snapshotCache.load()
        self.config = config
        self.tokenStore = tokenStore
        self.snapshotCache = snapshotCache
        self.responseCache = ResponseCache(directory: caches.appendingPathComponent("CadenceResponses"))
        self.preferences = preferences
        self.accent = preferences.accent
        self.themePreference = preferences.theme
        self.snapshot = cached?.snapshot
        self.snapshotFetchedAt = cached?.fetchedAt
        self.phase = tokenStore.isConnected ? .signedIn : .signedOut
        self.client = makeClient()
    }

    var appVersion: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? CadenceKitInfo.version
    }

    var units: UnitSystem { snapshot?.units ?? preferences.units }

    private func makeClient() -> APIClient? {
        APIClient.restore(tokenStore: tokenStore, responseCache: responseCache, appVersion: appVersion,
                          onUnauthorized: { [weak self] in
                              Task { @MainActor in self?.didLoseAuthorization() }
                          })
    }

    // MARK: Connect / sign out

    /// Normalises the address, exchanges the passphrase for a device token, then loads data.
    func connect(server: String, passphrase: String) async {
        lastError = nil
        do {
            let url = try ServerAddress.normalize(server)
            let fresh = APIClient(baseURL: url, tokenStore: tokenStore, responseCache: responseCache, appVersion: appVersion,
                                  onUnauthorized: { [weak self] in Task { @MainActor in self?.didLoseAuthorization() } })
            try await fresh.connect(passphrase: passphrase, deviceName: UIDevice.current.name)
            client = fresh
            phase = .signedIn
            await refresh()
        } catch let e as APIError {
            lastError = e
        } catch {
            lastError = .transport(message: error.localizedDescription, offline: false)
        }
    }

    func signOut() async {
        await client?.signOut()
        didLoseAuthorization()
    }

    private func didLoseAuthorization() {
        client = nil
        snapshot = nil
        snapshotFetchedAt = nil
        snapshotCache.clear()
        phase = .signedOut
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Data

    /// Snapshot (+ settings for appearance); updates the widget cache and reloads widgets.
    func refresh() async {
        guard let client, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let now = Date()
            snapshot = try await client.refreshSnapshot(into: snapshotCache, now: now)
            snapshotFetchedAt = now
            lastError = nil
            WidgetCenter.shared.reloadAllTimelines()
            if let settings = try? await client.settings() {
                preferences.apply(settings)
                accent = preferences.accent
                themePreference = preferences.theme
            }
        } catch let e as APIError {
            if e != .unauthorized { lastError = e }
        } catch is CancellationError {
            // pull-to-refresh released early
        } catch {
            lastError = .transport(message: error.localizedDescription, offline: false)
        }
    }

    func setAccent(_ accent: Accent) async {
        self.accent = accent
        preferences.accent = accent
        WidgetCenter.shared.reloadAllTimelines()
        _ = try? await client?.patchSettings(SettingsPatch(accent: accent))
    }

    func open(_ url: URL) {
        if let link = DeepLink(url: url) { pendingLink = link }
    }
}
