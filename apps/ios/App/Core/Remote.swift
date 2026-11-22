import Foundation
import Observation
import CadenceKit

/// One remote value for a screen: shows the cached response instantly (offline first paint), then
/// the fresh one. Keeps the last value on failure and remembers whether the failure was "offline".
@MainActor
@Observable
final class Remote<Value> {
    private(set) var value: Value? = nil
    /// when the shown value was fetched/cached; nil while nothing is shown
    private(set) var storedAt: Date? = nil
    private(set) var error: APIError? = nil
    private(set) var isLoading = false
    /// true until the first fetch finished (success or failure)
    private(set) var isFirstLoad = true

    init() {}

    /// Offline: keep showing saved data with a quiet line.
    var isOffline: Bool { error?.isOffline ?? false }

    /// Nothing to show and the last fetch failed.
    var failedEmpty: Bool { value == nil && error != nil }

    /// Loads: first the cache (only when nothing is shown yet), then the network.
    func load(cached: () -> Cached<Value>?, fetch: () async throws -> Value) async {
        if value == nil, let hit = cached() {
            value = hit.value
            storedAt = hit.storedAt
        }
        isLoading = true
        defer {
            isLoading = false
            isFirstLoad = false
        }
        do {
            let fresh = try await fetch()
            value = fresh
            storedAt = Date()
            error = nil
        } catch let e as APIError {
            error = e
        } catch is CancellationError {
            // the view went away or a newer load started
        } catch {
            self.error = .transport(message: error.localizedDescription, offline: false)
        }
    }

    /// Optimistic local change (the screen reloads from the server afterwards).
    func update(_ change: (Value) -> Value) {
        if let v = value { value = change(v) }
    }

    /// Forget the shown value (a different range is about to load; its cache then paints first).
    func reset() {
        value = nil
        storedAt = nil
        error = nil
        isFirstLoad = true
    }

    func set(_ newValue: Value) {
        value = newValue
        storedAt = Date()
    }
}
