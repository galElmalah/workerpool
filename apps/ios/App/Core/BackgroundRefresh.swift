import Foundation
import BackgroundTasks

/// Background app refresh: keeps the widget snapshot fresh while the app is closed.
/// The identifier is listed in Info.plist (`BGTaskSchedulerPermittedIdentifiers`, project.yml) and the
/// app declares the `fetch` background mode. The scene's `.backgroundTask(.appRefresh(id))` runs it.
enum BackgroundRefresh {
    /// "<bundle id>.refresh"
    static var identifier: String { (Bundle.main.bundleIdentifier ?? "app.cadence") + ".refresh" }

    /// Asks iOS for the next refresh in about an hour (iOS decides the actual time).
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // simulator / refresh disabled in Settings: widgets still refresh on their own timeline
        }
    }
}
