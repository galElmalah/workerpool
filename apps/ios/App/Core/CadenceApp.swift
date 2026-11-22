import SwiftUI
import Combine
import CadenceKit

@main
@MainActor
struct CadenceApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .cadenceAccent(model.accent)
                .preferredColorScheme(model.themePreference.colorScheme)
                .onOpenURL { model.open($0) }
                // App Intents that open the app (Shared/Intents) hand their link over here
                .onReceive(IntentNavigator.shared.$pendingLink.compactMap { $0 }) { link in
                    model.open(link)
                    IntentNavigator.shared.pendingLink = nil
                }
        }
        .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) {
            await refreshInBackground()
        }
    }

    /// Runs when iOS grants background time: update the snapshot (widgets), then ask for the next slot.
    private func refreshInBackground() async {
        BackgroundRefresh.schedule()
        await model.backgroundRefresh()
    }
}
