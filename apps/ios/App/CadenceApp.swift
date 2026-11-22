import SwiftUI
import CadenceKit

@main
struct CadenceApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .cadenceAccent(model.accent)
                .preferredColorScheme(model.themePreference.colorScheme)
                .onOpenURL { model.open($0) }
        }
    }
}

/// Placeholder navigation: connect screen or the first-paint Today. The app-UI engineer replaces
/// `HomePlaceholderView` with the real tab structure (Today · Calendar · ＋ · Trends · More).
struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch model.phase {
            case .signedOut: ConnectView()
            case .signedIn: HomePlaceholderView()
            }
        }
        .background(Theme.colors(accent).canvas.ignoresSafeArea())
        .animation(Theme.Motion.base, value: model.phase)
        .onChange(of: scenePhase) { _, newPhase in
            // back to the foreground: refresh (the snapshot also feeds the widgets)
            if newPhase == .active { Task { await model.refresh() } }
        }
    }
}
