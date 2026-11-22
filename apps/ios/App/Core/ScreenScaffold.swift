import SwiftUI
import CadenceKit

// Shared screen scaffolding for the app's own screens: zoom transitions, the offline line, the
// loading / failed states and small building blocks (section, hairline, sport mark, status mark).

// MARK: - Zoom navigation transition (iOS 18; plain push on iOS 17)

private struct ZoomNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    /// Set once per tab's NavigationStack; rows and destinations morph within it.
    var zoomNamespace: Namespace.ID? {
        get { self[ZoomNamespaceKey.self] }
        set { self[ZoomNamespaceKey.self] = newValue }
    }
}

private struct ZoomSourceModifier: ViewModifier {
    let id: String
    @Environment(\.zoomNamespace) private var namespace

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.0)
        if #available(iOS 18.0, *) {
            if let namespace {
                content.matchedTransitionSource(id: id, in: namespace)
            } else {
                content
            }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

private struct ZoomDestinationModifier: ViewModifier {
    let id: String
    @Environment(\.zoomNamespace) private var namespace

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.0)
        if #available(iOS 18.0, *) {
            if let namespace {
                content.navigationTransition(.zoom(sourceID: id, in: namespace))
            } else {
                content
            }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

extension View {
    /// The view a pushed route zooms out of (pass the same route the row pushes).
    func zoomSource(_ route: Route) -> some View { modifier(ZoomSourceModifier(id: route.zoomID)) }

    /// Applied by `cadenceDestinations()` to every pushed screen.
    func zoomDestination(_ id: String) -> some View { modifier(ZoomDestinationModifier(id: id)) }

    /// Canvas background behind a scrolling screen.
    func screenBackground() -> some View { modifier(ScreenBackgroundModifier()) }
}

private struct ScreenBackgroundModifier: ViewModifier {
    @Environment(\.cadenceAccent) private var accent

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(Theme.colors(accent).canvas.ignoresSafeArea())
    }
}

// MARK: - Offline / loading / failed

/// "Offline — showing saved data" (+ "· updated 3 h ago"). Quiet: fg3 caption with a small glyph.
@MainActor
struct OfflineNotice: View {
    var storedAt: Date?
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        Label {
            Text(text)
        } icon: {
            Image(systemName: "wifi.slash")
        }
        .font(Theme.Typography.caption)
        .foregroundStyle(c.fg3)
        .accessibilityElement(children: .combine)
    }

    private var text: String {
        var t = "Offline \u{2014} showing saved data"
        if let storedAt { t += Format.dot + "updated " + Format.ago(storedAt, now: Date()) }
        return t
    }
}

/// The first-load placeholder: a quiet spinner with room around it.
@MainActor
struct LoadingBlock: View {
    var body: some View {
        ProgressView()
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.xxl)
            .accessibilityLabel("Loading")
    }
}

/// Nothing to show and the request failed: one line + Try again.
@MainActor
struct FailedBlock: View {
    let error: APIError?
    let retry: () -> Void

    var body: some View {
        EmptyState(symbol: error?.isOffline == true ? "wifi.slash" : "exclamationmark.circle",
                   title: error?.isOffline == true ? "You\u{2019}re offline" : "Couldn\u{2019}t load this",
                   message: error?.isOffline == true ? "Nothing saved on this iPhone yet." : error?.message,
                   actionTitle: "Try again", action: retry)
    }
}

// MARK: - Building blocks

/// A section: title (optionally a trailing button) then content, spaced by whitespace only.
@MainActor
struct ScreenSection<Content: View>: View {
    let title: String?
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    let content: Content

    init(_ title: String?, actionTitle: String? = nil, action: (() -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.actionTitle = actionTitle
        self.action = action
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            if let title {
                SectionHeader(title: title, actionTitle: actionTitle, action: action)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Sport glyph tinted with the sport's data colour (DESIGN_V2 §8.1).
struct SportMark: View {
    let sport: Sport
    var size: CGFloat = 20

    var body: some View {
        Image(systemName: sport.symbolName)
            .font(.system(size: size * 0.8, weight: .medium))
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(DataColor.sport(sport))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Compliance glyph in its status colour (neutral when planned / skipped). Always next to a word.
struct StatusMark: View {
    let state: ComplianceState
    var size: CGFloat = 13
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        Image(systemName: state.statusSymbol)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(DataColor.status(state) ?? Theme.colors(accent).fg3)
            .accessibilityHidden(true)
    }
}

/// The small intensity dot (now for every session that has an intensity), toned by zone.
struct ZoneDot: View {
    let intensity: IntensityClass
    var diameter: CGFloat = 7

    var body: some View {
        Circle()
            .fill(DataColor.intensity(intensity))
            .frame(width: diameter, height: diameter)
            .accessibilityHidden(true)
    }
}

/// The neutral key star, with a bounce when it changes.
struct KeyStarMark: View {
    let isKey: Bool
    var font: Font = .footnote
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        Image(systemName: isKey ? "star.fill" : "star")
            .font(font)
            .foregroundStyle(isKey ? Theme.colors(accent).fg2 : Theme.colors(accent).fg4)
            .symbolEffect(.bounce, value: isKey)
            .contentTransition(.symbolEffect(.replace))
            .accessibilityHidden(true)
    }
}

/// Mini step/effort profile: thin bars, zone-toned when it is a plan, neutral for done effort.
struct SessionProfileBars: View {
    let values: [Double]
    var isPlan: Bool = true
    var height: CGFloat = 28
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(isPlan ? DataColor.zone(WorkoutScreenModel.zoneIndex(v * 1.3)) : c.fg3)
                    .frame(maxWidth: .infinity)
                    .frame(height: max(2, height * CGFloat(v)))
            }
        }
        .frame(height: height, alignment: .bottom)
        .accessibilityHidden(true)
    }
}
