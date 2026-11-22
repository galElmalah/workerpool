import SwiftUI
import CadenceKit

/// Connect screen until a device token exists, then the tabs.
@MainActor
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch model.phase {
            case .signedOut:
                ConnectScreen()
                    .transition(.opacity)
            case .signedIn:
                MainTabView()
                    .transition(.opacity)
            }
        }
        .background(Theme.colors(accent).canvas.ignoresSafeArea())
        .animation(Theme.Motion.smooth, value: model.phase)
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                // back in the foreground: refresh (the snapshot also feeds the widgets)
                Task { await model.refresh() }
            case .background:
                BackgroundRefresh.schedule()
            default:
                break
            }
        }
    }
}

/// Today · Calendar · Trends · Activities · More, each with its own NavigationStack and path.
@MainActor
struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            TabStack(tab: .today) { TodayScreen() }
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag(AppTab.today)
            TabStack(tab: .calendar) { CalendarScreen() }
                .tabItem { Label("Calendar", systemImage: "calendar") }
                .tag(AppTab.calendar)
            TabStack(tab: .trends) { TrendsScreen() }
                .tabItem { Label("Trends", systemImage: "chart.xyaxis.line") }
                .tag(AppTab.trends)
            TabStack(tab: .activities) { ActivitiesScreen() }
                .tabItem { Label("Activities", systemImage: "list.bullet") }
                .tag(AppTab.activities)
            TabStack(tab: .more) { MoreScreen() }
                .tabItem { Label("More", systemImage: "ellipsis") }
                .tag(AppTab.more)
        }
        .sensoryFeedback(.selection, trigger: model.selectedTab)
    }
}

/// One tab: a NavigationStack bound to the tab's path on `AppModel`, the route destinations, the
/// zoom-transition namespace and the toast.
@MainActor
struct TabStack<Root: View>: View {
    let tab: AppTab
    let root: Root
    @Environment(AppModel.self) private var model
    @Namespace private var zoom

    init(tab: AppTab, @ViewBuilder root: () -> Root) {
        self.tab = tab
        self.root = root()
    }

    var body: some View {
        NavigationStack(path: Binding(get: { model.routes(for: tab) }, set: { model.setRoutes($0, for: tab) })) {
            root
                .cadenceDestinations()
        }
        .environment(\.zoomNamespace, zoom)
        .toastHost()
    }
}

/// The More tab: Journal, Settings, devices, Garmin.
@MainActor
struct MoreScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        List {
            Section {
                row("Journal", symbol: "book", route: .journal)
            }
            Section {
                row("Settings", symbol: "gearshape", route: .settings)
                row("Garmin", symbol: "arrow.triangle.2.circlepath", route: .garmin)
                row("Devices", symbol: "iphone", route: .devices)
            }
            Section {
                Button(role: .destructive) {
                    Task { await model.signOut() }
                } label: {
                    Text("Sign out of this iPhone")
                }
            } footer: {
                Text("Signing out revokes this iPhone\u{2019}s token on the server.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
            }
        }
        .listStyle(.insetGrouped)
        .screenBackground()
        .navigationTitle("More")
    }

    private func row(_ title: String, symbol: String, route: Route) -> some View {
        let c = Theme.colors(accent)
        return NavigationLink(value: route) {
            Label {
                Text(title).foregroundStyle(c.fg1)
            } icon: {
                Image(systemName: symbol).foregroundStyle(c.fg2)
            }
        }
        .listRowBackground(c.surface1)
    }
}
