// Type-checking stub of App Intents (iOS 17 SDK; iOS 18 additions marked) for the intents, enums,
// shortcuts and the SwiftUI `Button(intent:)` / `Toggle(isOn:intent:)` overlay Cadence uses.
@_exported import Foundation
import SwiftUI

// MARK: Strings

public struct LocalizedStringResource: Equatable, ExpressibleByStringInterpolation, CustomStringConvertible, Sendable {
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: StringInterpolation) {}
    public init(_ keyAndValue: String, table: String? = nil, locale: Locale = .current, bundle: BundleDescription = .main, comment: StaticString? = nil) {}
    public var description: String { "" }
    public struct BundleDescription: Sendable { public static let main = BundleDescription() }
    public struct StringInterpolation: StringInterpolationProtocol {
        public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ literal: String) {}
        public mutating func appendInterpolation(_ string: String) {}
        public mutating func appendInterpolation<T: BinaryInteger>(_ value: T) {}
        public mutating func appendInterpolation<T: BinaryFloatingPoint>(_ value: T) {}
        public mutating func appendInterpolation(_ resource: LocalizedStringResource) {}
        public mutating func appendInterpolation<F: FormatStyle>(_ input: F.FormatInput, format: F) where F.FormatOutput == String {}
        public mutating func appendInterpolation(_ date: Date, format: Date.FormatStyle) {}
    }
}
extension String {
    public init(localized resource: LocalizedStringResource) { self.init() }
}

public protocol CustomLocalizedStringResourceConvertible {
    var localizedStringResource: LocalizedStringResource { get }
}

public struct DisplayRepresentation: Sendable, ExpressibleByStringInterpolation {
    public struct Image: Sendable {
        public init(systemName: String, isTemplate: Bool? = nil) {}
        public init(named name: String, isTemplate: Bool? = nil) {}
    }
    public init(title: LocalizedStringResource, subtitle: LocalizedStringResource? = nil, image: Image? = nil) {}
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: LocalizedStringResource.StringInterpolation) {}
}
public struct TypeDisplayRepresentation: Sendable, ExpressibleByStringInterpolation {
    public init(name: LocalizedStringResource, numericFormat: LocalizedStringResource? = nil) {}
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: LocalizedStringResource.StringInterpolation) {}
}

public struct IntentDescription: Sendable, ExpressibleByStringInterpolation {
    public init(_ descriptionText: LocalizedStringResource, categoryName: LocalizedStringResource? = nil, searchKeywords: [LocalizedStringResource] = [], resultValueName: LocalizedStringResource? = nil) {}
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: LocalizedStringResource.StringInterpolation) {}
}

public struct IntentDialog: Sendable, ExpressibleByStringInterpolation {
    public init(_ fullDialog: LocalizedStringResource) {}
    public init(full: LocalizedStringResource, supporting: LocalizedStringResource) {}
    public init(full: LocalizedStringResource, systemImageName: String) {}
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: LocalizedStringResource.StringInterpolation) {}
}

// MARK: Intents

public protocol PersistentlyIdentifiable {}
public protocol _SupportsAppDependencies {}

public protocol AppIntent: PersistentlyIdentifiable, _SupportsAppDependencies, Sendable {
    associatedtype PerformResult: IntentResult
    associatedtype SummaryContent: ParameterSummary = _EmptySummary
    static var title: LocalizedStringResource { get }
    static var description: IntentDescription? { get }
    static var openAppWhenRun: Bool { get }
    static var isDiscoverable: Bool { get }
    static var authenticationPolicy: IntentAuthenticationPolicy { get }
    @ParameterSummaryBuilder<Self> static var parameterSummary: SummaryContent { get }
    init()
    func perform() async throws -> PerformResult
}
extension AppIntent {
    public static var description: IntentDescription? { nil }
    public static var openAppWhenRun: Bool { false }
    public static var isDiscoverable: Bool { true }
    public static var authenticationPolicy: IntentAuthenticationPolicy { .alwaysAllowed }
}
extension AppIntent where SummaryContent == _EmptySummary {
    public static var parameterSummary: _EmptySummary { _EmptySummary() }
}
public enum IntentAuthenticationPolicy: Sendable { case alwaysAllowed, requiresAuthentication, requiresLocalDeviceAuthentication }
public protocol OpenIntent: AppIntent {}
@available(iOS 18.0, *)
public protocol URLRepresentableIntent: OpenIntent {}

public protocol WidgetConfigurationIntent: AppIntent {}
extension WidgetConfigurationIntent {
    public func perform() async throws -> some IntentResult { _IntentResult() }
}

public protocol SystemIntent: AppIntent {}
public protocol LiveActivityIntent: AppIntent {}
public protocol AudioPlaybackIntent: AppIntent {}
public protocol ForegroundContinuableIntent: AppIntent {}
@available(iOS 18.0, *)
public protocol ControlConfigurationIntent: AppIntent {}

@available(iOS 18.0, *)
public struct OpenURLIntent: AppIntent {
    public static var title: LocalizedStringResource { "Open URL" }
    public init() {}
    public init(_ url: URL) {}
    public func perform() async throws -> some IntentResult { _IntentResult() }
}

// MARK: Results

public protocol IntentResult: Sendable {}
public protocol ProvidesDialog: IntentResult {}
public protocol ShowsSnippetView: IntentResult {}
public protocol OpensIntent: IntentResult {}
public protocol ReturnsValue<Value>: IntentResult { associatedtype Value }
public struct _IntentResult: IntentResult, ProvidesDialog, ShowsSnippetView, OpensIntent {}
extension IntentResult {
    public static func result() -> Self where Self == _IntentResult { _IntentResult() }
    public static func result(dialog: IntentDialog) -> Self where Self == _IntentResult { _IntentResult() }
    public static func result<Content: View>(dialog: IntentDialog, @ViewBuilder view: () -> Content) -> Self where Self == _IntentResult { _IntentResult() }
    public static func result<Content: View>(dialog: IntentDialog, view: Content) -> Self where Self == _IntentResult { _IntentResult() }
    public static func result<Content: View>(@ViewBuilder view: () -> Content) -> Self where Self == _IntentResult { _IntentResult() }
    public static func result<I: AppIntent>(opensIntent: I) -> Self where Self == _IntentResult { _IntentResult() }
    public static func result<I: AppIntent>(opensIntent: I, dialog: IntentDialog) -> Self where Self == _IntentResult { _IntentResult() }
}

// MARK: Parameters

@propertyWrapper
public final class IntentParameter<Value>: @unchecked Sendable {
    public var wrappedValue: Value { get { fatalError() } set {} }
    public var projectedValue: IntentParameter<Value> { self }
    public init(title: LocalizedStringResource, description: LocalizedStringResource? = nil, requestValueDialog: IntentDialog? = nil) {}
    public init(title: LocalizedStringResource, description: LocalizedStringResource? = nil, default defaultValue: Value, requestValueDialog: IntentDialog? = nil) {}
    public init(title: LocalizedStringResource, description: LocalizedStringResource? = nil, default defaultValue: Value, inputOptions: String.IntentInputOptions? = nil, requestValueDialog: IntentDialog? = nil) {}
    public init(title: LocalizedStringResource, description: LocalizedStringResource? = nil, inputOptions: String.IntentInputOptions? = nil, requestValueDialog: IntentDialog? = nil) {}
    public init<T>(title: LocalizedStringResource, description: LocalizedStringResource? = nil, inclusiveRange: (T, T), requestValueDialog: IntentDialog? = nil) where Value == T {}
    public init<T>(title: LocalizedStringResource, description: LocalizedStringResource? = nil, default defaultValue: T, inclusiveRange: (T, T), requestValueDialog: IntentDialog? = nil) where Value == T {}
    public func requestValue(_ dialog: IntentDialog? = nil) async throws -> Value { fatalError() }
}
public typealias Parameter = IntentParameter
extension String {
    public struct IntentInputOptions: Sendable {
        public init(keyboardType: UIKeyboardType = .default, capitalizationType: String = "", multiline: Bool = false, autocorrect: Bool = true, smartQuotes: Bool = true, smartDashes: Bool = true) {}
    }
}

public protocol _IntentValue {}
extension String: _IntentValue {}
extension Int: _IntentValue {}
extension Double: _IntentValue {}
extension Bool: _IntentValue {}
extension Date: _IntentValue {}
extension URL: _IntentValue {}
extension Optional: _IntentValue where Wrapped: _IntentValue {}

public protocol TypeDisplayRepresentable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { get }
}
public protocol CaseDisplayRepresentable: Hashable {
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] { get }
}
public protocol StaticDisplayRepresentable {}
public protocol AppValue {}
public protocol AppEnum: _IntentValue, TypeDisplayRepresentable, CaseDisplayRepresentable, CaseIterable, RawRepresentable, Hashable, Sendable, AppValue, StaticDisplayRepresentable where RawValue: _IntentValue {}

public protocol AppEntity: _IntentValue, TypeDisplayRepresentable, Identifiable, Sendable, AppValue {
    associatedtype DefaultQuery: EntityQuery
    static var defaultQuery: DefaultQuery { get }
    var displayRepresentation: DisplayRepresentation { get }
}
public protocol EntityQuery: Sendable {
    associatedtype Entity: AppEntity
    init()
    func entities(for identifiers: [Entity.ID]) async throws -> [Entity]
}

// MARK: Parameter summary

public protocol ParameterSummary {}
public struct _EmptySummary: ParameterSummary { public init() {} }
public struct ParameterSummaryString<Intent: AppIntent>: ExpressibleByStringInterpolation {
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: StringInterpolation) {}
    public struct StringInterpolation: StringInterpolationProtocol {
        public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ literal: String) {}
        public mutating func appendInterpolation<Value>(_ keyPath: KeyPath<Intent, IntentParameter<Value>>) {}
    }
}
public struct ParameterSummaryCaseCondition<Intent: AppIntent>: ParameterSummary {}
public struct Summary<Intent: AppIntent, Content>: ParameterSummary {
    public init(_ summary: ParameterSummaryString<Intent>) where Content == Void {}
    public init(_ summary: ParameterSummaryString<Intent>, @_SummaryContentBuilder<Intent> _ content: () -> Content) {}
}
@resultBuilder public struct ParameterSummaryBuilder<Intent: AppIntent> {
    public static func buildExpression<C>(_ summary: Summary<Intent, C>) -> Summary<Intent, C> { summary }
    public static func buildBlock<P: ParameterSummary>(_ summary: P) -> P { summary }
}
@resultBuilder public struct _SummaryContentBuilder<Intent: AppIntent> {
    public static func buildBlock<each P>(_ p: repeat each P) -> (repeat each P) { (repeat each p) }
    public static func buildExpression<V>(_ kp: KeyPath<Intent, IntentParameter<V>>) -> KeyPath<Intent, IntentParameter<V>> { kp }
}

// MARK: App Shortcuts

public struct AppShortcutPhraseToken: Sendable {
    public static let applicationName = AppShortcutPhraseToken()
}
public struct AppShortcutPhrase<Intent: AppIntent>: ExpressibleByStringInterpolation, Sendable {
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: StringInterpolation) {}
    public struct StringInterpolation: StringInterpolationProtocol {
        public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ literal: String) {}
        public mutating func appendInterpolation(_ token: AppShortcutPhraseToken) {}
        /// Only AppEntity / AppEnum parameters may appear in phrases.
        public mutating func appendInterpolation<Value: AppEnum>(_ keyPath: KeyPath<Intent, IntentParameter<Value>>) {}
        public mutating func appendInterpolation<Value: AppEntity>(_ keyPath: KeyPath<Intent, IntentParameter<Value>>) {}
    }
}
public struct AppShortcut: Sendable {
    public init<Intent: AppIntent>(intent: Intent, phrases: [AppShortcutPhrase<Intent>], shortTitle: LocalizedStringResource, systemImageName: String) {}
    public init<Intent: AppIntent>(intent: Intent, phrases: [AppShortcutPhrase<Intent>], shortTitle: LocalizedStringResource, systemImageName: String, parameterPresentation: Any) {}
}
@resultBuilder public struct AppShortcutsBuilder {
    public static func buildBlock(_ components: AppShortcut...) -> [AppShortcut] { components }
    public static func buildExpression(_ expression: AppShortcut) -> AppShortcut { expression }
}
public protocol AppShortcutsProvider {
    @AppShortcutsBuilder static var appShortcuts: [AppShortcut] { get }
    static var shortcutTileColor: ShortcutTileColor { get }
    static func updateAppShortcutParameters()
}
extension AppShortcutsProvider {
    public static var shortcutTileColor: ShortcutTileColor { .blue }
    public static func updateAppShortcutParameters() {}
}
public enum ShortcutTileColor: Sendable { case red, tangerine, orange, yellow, lime, grayGreen, grayBlue, blue, navy, purple, lightBlue, pink, teal, grape, lightGray, gray, grayBrown }

public struct AppDependencyManager: Sendable {
    public static let shared = AppDependencyManager()
    public func add<D: Sendable>(dependency: @autoclosure @escaping @Sendable () -> D) {}
}

// MARK: SwiftUI overlay (Button(intent:), Toggle(isOn:intent:))

extension Button {
    public init<I: AppIntent>(intent: I, @ViewBuilder label: () -> Label) { fatalError() }
}
extension Button where Label == Text {
    public init<I: AppIntent>(_ titleKey: LocalizedStringKey, intent: I) { fatalError() }
}
extension Toggle {
    public init<I: AppIntent>(isOn: Bool, intent: I, @ViewBuilder label: () -> Label) { fatalError() }
}
