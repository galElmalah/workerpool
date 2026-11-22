// Type-checking stub of WidgetKit (iOS 17 SDK; iOS 18 controls marked).
@_exported import Foundation
import SwiftUI
import AppIntents

public enum WidgetFamily: Int, CaseIterable, Hashable, Sendable, CustomDebugStringConvertible {
    case systemSmall, systemMedium, systemLarge, systemExtraLarge, accessoryCircular, accessoryRectangular, accessoryInline
    public var debugDescription: String { "" }
}

public struct WidgetRenderingMode: Equatable, Hashable, Sendable, CustomStringConvertible {
    public static let fullColor = WidgetRenderingMode(), accented = WidgetRenderingMode(), vibrant = WidgetRenderingMode()
    public var description: String { "" }
}

public protocol TimelineEntry {
    var date: Date { get }
    var relevance: TimelineEntryRelevance? { get }
}
extension TimelineEntry {
    public var relevance: TimelineEntryRelevance? { nil }
}
public struct TimelineEntryRelevance: Codable, Hashable, Sendable {
    public init(score: Float) {}
    public init(score: Float, duration: TimeInterval) {}
}
public struct TimelineReloadPolicy: Equatable, Sendable {
    public static let atEnd = TimelineReloadPolicy(), never = TimelineReloadPolicy()
    public static func after(_ date: Date) -> TimelineReloadPolicy { .init() }
}
public struct Timeline<EntryType: TimelineEntry> {
    public let entries: [EntryType]
    public let policy: TimelineReloadPolicy
    public init(entries: [EntryType], policy: TimelineReloadPolicy) { self.entries = entries; self.policy = policy }
}
extension Timeline: Sendable where EntryType: Sendable {}

public struct TimelineProviderContext: Sendable {
    public var family: WidgetFamily { .systemSmall }
    public var isPreview: Bool { false }
    public var displaySize: CGSize { .zero }
    public var environmentVariants: EnvironmentVariants { EnvironmentVariants() }
    public struct EnvironmentVariants: Sendable {}
}

public protocol TimelineProvider {
    associatedtype Entry: TimelineEntry
    typealias Context = TimelineProviderContext
    func placeholder(in context: Context) -> Entry
    func getSnapshot(in context: Context, completion: @escaping @Sendable (Entry) -> Void)
    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<Entry>) -> Void)
}
public protocol AppIntentTimelineProvider {
    associatedtype Entry: TimelineEntry
    associatedtype Intent: WidgetConfigurationIntent
    typealias Context = TimelineProviderContext
    func placeholder(in context: Context) -> Entry
    func snapshot(for configuration: Intent, in context: Context) async -> Entry
    func timeline(for configuration: Intent, in context: Context) async -> Timeline<Entry>
    func recommendations() -> [AppIntentRecommendation<Intent>]
}
extension AppIntentTimelineProvider {
    public func recommendations() -> [AppIntentRecommendation<Intent>] { [] }
}
public struct AppIntentRecommendation<Intent: WidgetConfigurationIntent> {
    public init(intent: Intent, description: LocalizedStringResource) {}
    public init(intent: Intent, description: Text) {}
}

@MainActor @preconcurrency
public protocol Widget {
    associatedtype Body: WidgetConfiguration
    @WidgetConfigurationBuilder var body: Body { get }
    init()
}
extension Widget {
    @MainActor public static func main() {}
}
@MainActor @preconcurrency
public protocol WidgetBundle {
    associatedtype Body: Widget
    @WidgetBundleBuilder var body: Body { get }
    init()
}
extension WidgetBundle {
    @MainActor public static func main() {}
}

public protocol WidgetConfiguration {
    associatedtype Body: WidgetConfiguration
    @WidgetConfigurationBuilder var body: Body { get }
}
extension Never: WidgetConfiguration {}
@resultBuilder public struct WidgetConfigurationBuilder {
    public static func buildBlock<C: WidgetConfiguration>(_ content: C) -> C { content }
    public static func buildExpression<C: WidgetConfiguration>(_ content: C) -> C { content }
}
public struct _ModifiedWidgetConfiguration<C>: WidgetConfiguration { public var body: Never { fatalError() } }

public protocol _LimitedAvailabilityWidgetMarker {}
public struct _LimitedAvailabilityWidget: Widget, _LimitedAvailabilityWidgetMarker {
    public init() {}
    public var body: Never { fatalError() }
}
public struct _WidgetBundleContent: Widget {
    public init() {}
    public var body: Never { fatalError() }
}

@resultBuilder public struct WidgetBundleBuilder {
    public static func buildExpression<W: Widget>(_ widget: W) -> W { widget }
    @available(iOS 18.0, *)
    public static func buildExpression<W: ControlWidget>(_ widget: W) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildBlock() -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildBlock<W: Widget>(_ widget: W) -> W { widget }
    public static func buildBlock<W0: Widget, W1: Widget>(_ w0: W0, _ w1: W1) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildBlock<W0: Widget, W1: Widget, W2: Widget>(_ w0: W0, _ w1: W1, _ w2: W2) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildBlock<W0: Widget, W1: Widget, W2: Widget, W3: Widget>(_ w0: W0, _ w1: W1, _ w2: W2, _ w3: W3) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildBlock<W0: Widget, W1: Widget, W2: Widget, W3: Widget, W4: Widget>(_ w0: W0, _ w1: W1, _ w2: W2, _ w3: W3, _ w4: W4) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildBlock<W0: Widget, W1: Widget, W2: Widget, W3: Widget, W4: Widget, W5: Widget>(_ w0: W0, _ w1: W1, _ w2: W2, _ w3: W3, _ w4: W4, _ w5: W5) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildBlock<W0: Widget, W1: Widget, W2: Widget, W3: Widget, W4: Widget, W5: Widget, W6: Widget>(_ w0: W0, _ w1: W1, _ w2: W2, _ w3: W3, _ w4: W4, _ w5: W5, _ w6: W6) -> _WidgetBundleContent { _WidgetBundleContent() }
    // iOS 16+: `if #available(…) { W() }` only (buildOptional takes the limited-availability marker type)
    public static func buildOptional(_ widget: (any Widget & _LimitedAvailabilityWidgetMarker)?) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildEither<W: Widget>(first: W) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildEither<W: Widget>(second: W) -> _WidgetBundleContent { _WidgetBundleContent() }
    public static func buildLimitedAvailability<W: Widget>(_ widget: W) -> _LimitedAvailabilityWidget { _LimitedAvailabilityWidget() }
}

public struct StaticConfiguration<Content: View>: WidgetConfiguration {
    public init<Provider: TimelineProvider>(kind: String, provider: Provider, @ViewBuilder content: @escaping (Provider.Entry) -> Content) {}
    public var body: Never { fatalError() }
}
public struct AppIntentConfiguration<Intent: WidgetConfigurationIntent, Content: View>: WidgetConfiguration {
    public init<Provider: AppIntentTimelineProvider>(kind: String, intent: Intent.Type = Intent.self, provider: Provider, @ViewBuilder content: @escaping (Provider.Entry) -> Content) where Intent == Provider.Intent {}
    public var body: Never { fatalError() }
}

extension WidgetConfiguration {
    public func configurationDisplayName(_ displayName: Text) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    public func configurationDisplayName(_ displayNameKey: LocalizedStringKey) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    @_disfavoredOverload public func configurationDisplayName<S: StringProtocol>(_ displayName: S) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    public func description(_ description: Text) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    public func description(_ descriptionKey: LocalizedStringKey) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    @_disfavoredOverload public func description<S: StringProtocol>(_ description: S) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    public func supportedFamilies(_ families: [WidgetFamily]) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    public func contentMarginsDisabled() -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    public func containerBackgroundRemovable(_ isRemovable: Bool = true) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    public func disfavoredLocations(_ locations: [WidgetLocation], for families: [WidgetFamily]) -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
    @available(iOS 18.0, *)
    public func promptsForUserConfiguration() -> some WidgetConfiguration { _ModifiedWidgetConfiguration<Self>() }
}
public struct WidgetLocation: Hashable, Sendable {
    public static let homeScreen = WidgetLocation(), lockScreen = WidgetLocation(), standBy = WidgetLocation(), iPhoneWidgetsOnMac = WidgetLocation()
}

public final class WidgetCenter: @unchecked Sendable {
    public static let shared = WidgetCenter()
    public func reloadAllTimelines() {}
    public func reloadTimelines(ofKind kind: String) {}
    public func getCurrentConfigurations(_ completion: @escaping (Result<[WidgetInfo], Error>) -> Void) {}
    public func currentConfigurations() async throws -> [WidgetInfo] { [] }
    public func invalidateConfigurationRecommendations() {}
}
public struct WidgetInfo: Sendable {
    public var kind: String { "" }
    public var family: WidgetFamily { .systemSmall }
}

// MARK: Environment & view modifiers

public struct ContainerBackgroundPlacement: Sendable {
    public static let widget = ContainerBackgroundPlacement()
}
public struct AccessoryWidgetBackground: View {
    public init() {}
    public var body: Never { fatalError() }
}
extension EnvironmentValues {
    public var widgetFamily: WidgetFamily { get { .systemSmall } set {} }
    public var widgetRenderingMode: WidgetRenderingMode { get { .fullColor } set {} }
    public var showsWidgetContainerBackground: Bool { get { true } set {} }
    public var showsWidgetLabel: Bool { get { false } set {} }
    public var widgetContentMargins: EdgeInsets { get { EdgeInsets() } set {} }
}
extension View {
    public func widgetURL(_ url: URL?) -> some View { _m }
    public func widgetAccentable(_ accentable: Bool = true) -> some View { _m }
    public func containerBackground<S: ShapeStyle>(_ style: S, for container: ContainerBackgroundPlacement) -> some View { _m }
    public func containerBackground<V: View>(for container: ContainerBackgroundPlacement, alignment: Alignment = .center, @ViewBuilder content: () -> V) -> some View { _m }
    public func invalidatableContent(_ invalidatable: Bool = true) -> some View { _m }
    public func widgetLabel<Label: View>(@ViewBuilder label: () -> Label) -> some View { _m }
    public func widgetLabel(_ labelKey: LocalizedStringKey) -> some View { _m }
}
extension Image {
    @available(iOS 18.0, *)
    public func widgetAccentedRenderingMode(_ renderingMode: WidgetAccentedRenderingMode?) -> some View { _m }
}
@available(iOS 18.0, *)
public struct WidgetAccentedRenderingMode: Sendable {
    public static let accented = WidgetAccentedRenderingMode(), desaturated = WidgetAccentedRenderingMode(), fullColor = WidgetAccentedRenderingMode()
}

// MARK: Previews (only used by the #Preview rewrite in typecheck-stubs.sh)

@resultBuilder public struct _TimelineEntriesBuilder {
    public static func buildExpression<E: TimelineEntry>(_ entry: E) -> [any TimelineEntry] { [entry] }
    public static func buildBlock(_ parts: [any TimelineEntry]...) -> [any TimelineEntry] { parts.flatMap { $0 } }
}
@MainActor public func __previewWidget<W: Widget>(_ name: String? = nil, as family: WidgetFamily, widget: () -> W, @_TimelineEntriesBuilder timeline: @escaping () -> [any TimelineEntry]) {}

// MARK: iOS 18 controls

@available(iOS 18.0, *)
@MainActor @preconcurrency
public protocol ControlWidget {
    associatedtype Body: ControlWidgetConfiguration
    @ControlWidgetConfigurationBuilder var body: Body { get }
    init()
}
@available(iOS 18.0, *)
public protocol ControlWidgetConfiguration {}
@available(iOS 18.0, *)
@resultBuilder public struct ControlWidgetConfigurationBuilder {
    public static func buildBlock<C: ControlWidgetConfiguration>(_ content: C) -> C { content }
    public static func buildExpression<C: ControlWidgetConfiguration>(_ content: C) -> C { content }
}
@available(iOS 18.0, *)
public protocol ControlWidgetTemplate {}
@available(iOS 18.0, *)
@resultBuilder public struct ControlWidgetTemplateBuilder {
    public static func buildBlock<C: ControlWidgetTemplate>(_ content: C) -> C { content }
    public static func buildExpression<C: ControlWidgetTemplate>(_ content: C) -> C { content }
}
@available(iOS 18.0, *)
public struct _ModifiedControlConfiguration<C>: ControlWidgetConfiguration {}
@available(iOS 18.0, *)
public struct StaticControlConfiguration<Content: ControlWidgetTemplate>: ControlWidgetConfiguration {
    public init(kind: String, @ControlWidgetTemplateBuilder content: () -> Content) {}
}
@available(iOS 18.0, *)
extension ControlWidgetConfiguration {
    public func displayName(_ displayName: LocalizedStringResource) -> some ControlWidgetConfiguration { _ModifiedControlConfiguration<Self>() }
    public func description(_ description: LocalizedStringResource) -> some ControlWidgetConfiguration { _ModifiedControlConfiguration<Self>() }
}
@available(iOS 18.0, *)
public struct ControlWidgetButton<Label: View, ActionLabel: View, Action: AppIntent>: ControlWidgetTemplate {
    public init(action: Action, @ViewBuilder label: () -> Label) where ActionLabel == EmptyView {}
    public init(action: Action, @ViewBuilder label: () -> Label, @ViewBuilder actionLabel: (Bool) -> ActionLabel) {}
}
@available(iOS 18.0, *)
public final class ControlCenter: @unchecked Sendable {
    public static let shared = ControlCenter()
    public func reloadAllControls() {}
    public func reloadControls(ofKind kind: String) {}
}
