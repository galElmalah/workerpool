// Type-checking stub of the SwiftUI surface the Cadence app and widgets use.
//
// Purpose: let `swiftc -typecheck` run over App/, Widgets/ and Shared/ on Linux, where SwiftUI does
// not exist. Signatures are written from the iOS 17 SDK (Xcode 15/16) as faithfully as possible —
// generic where SwiftUI is generic, `some View` where SwiftUI returns opaque types, the same argument
// labels, defaults, optionality, `@escaping`, `@MainActor`. Bodies are never executed.
//
// Deliberately conservative choices (so the stub errs on the side of reporting):
//   * ViewBuilder.buildBlock has overloads for 0…10 children (the Xcode 15 limit).
//   * ViewBuilder has no buildArray (no `for` loops in view builders — use ForEach).
//   * UIKit is imported but not re-exported (files using UIColor/UIDevice must `import UIKit`).
//   * APIs newer than iOS 17 carry @available(iOS 18.0, *).
// A clean type-check proves the targets are internally consistent against these declarations; it
// does not prove the declarations match Apple's SDK exactly. When in doubt, the app code is written
// in the plainest form of an API.

@_exported import Foundation
@_exported import Observation
@_exported import Combine
import UIKit

// MARK: - Core protocols

@MainActor @preconcurrency
public protocol View {
    associatedtype Body: View
    @ViewBuilder @MainActor @preconcurrency var body: Self.Body { get }
}

extension Never: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}

@MainActor @preconcurrency
public protocol ViewModifier {
    associatedtype Body: View
    typealias Content = _ViewModifier_Content<Self>
    @ViewBuilder @MainActor @preconcurrency func body(content: Self.Content) -> Self.Body
}

public struct _ViewModifier_Content<Modifier: ViewModifier>: View {
    public var body: Never { fatalError() }
}

public struct ModifiedContent<Content, Modifier> {
    public var content: Content
    public var modifier: Modifier
    public init(content: Content, modifier: Modifier) { self.content = content; self.modifier = modifier }
}
extension ModifiedContent: View where Content: View, Modifier: ViewModifier {
    public var body: Never { fatalError() }
}

/// What every stubbed modifier returns (SwiftUI returns `some View`).
public struct _Modified<Content: View>: View {
    @usableFromInline init(_ c: Content) {}
    public var body: Never { fatalError() }
}

extension View {
    @inlinable public var _m: _Modified<Self> { _Modified(self) }
    public func modifier<T>(_ modifier: T) -> ModifiedContent<Self, T> { ModifiedContent(content: self, modifier: modifier) }
}

public protocol DynamicProperty {}

@MainActor @preconcurrency
public protocol App {
    associatedtype Body: Scene
    @SceneBuilder @MainActor @preconcurrency var body: Self.Body { get }
    @MainActor @preconcurrency init()
}
extension App {
    @MainActor public static func main() {}
}

@MainActor @preconcurrency
public protocol Scene {
    associatedtype Body: Scene
    @SceneBuilder @MainActor @preconcurrency var body: Self.Body { get }
}
extension Never: Scene {}

@resultBuilder public struct SceneBuilder {
    public static func buildBlock<Content: Scene>(_ content: Content) -> Content { content }
    public static func buildBlock<C0: Scene, C1: Scene>(_ c0: C0, _ c1: C1) -> _TupleScene { _TupleScene() }
    public static func buildExpression<Content: Scene>(_ content: Content) -> Content { content }
}
public struct _TupleScene: Scene { public var body: Never { fatalError() } }

public struct WindowGroup<Content: View>: Scene {
    public init(@ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}

public struct _ModifiedScene<S: Scene>: Scene { public var body: Never { fatalError() } }

public struct BackgroundTask<Request, Response>: Sendable {
    public static func appRefresh(_ identifier: String) -> BackgroundTask<Void, Void> { .init() }
    public static func urlSession(_ identifier: String) -> BackgroundTask<String, Void> { .init() }
}

extension Scene {
    public func backgroundTask<D: Sendable, R: Sendable>(_ task: BackgroundTask<D, R>, action: @escaping @Sendable (D) async -> R) -> some Scene { _ModifiedScene<Self>() }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping (V, V) -> Void) -> some Scene { _ModifiedScene<Self>() }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping () -> Void) -> some Scene { _ModifiedScene<Self>() }
}

public enum ScenePhase: Comparable, Hashable, Sendable { case background, inactive, active }

// MARK: - ViewBuilder

@resultBuilder public struct ViewBuilder {
    public static func buildExpression<Content: View>(_ content: Content) -> Content { content }
    public static func buildBlock() -> EmptyView { EmptyView() }
    public static func buildBlock<Content: View>(_ content: Content) -> Content { content }
    public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> TupleView<(C0, C1)> { TupleView((c0, c1)) }
    public static func buildBlock<C0: View, C1: View, C2: View>(_ c0: C0, _ c1: C1, _ c2: C2) -> TupleView<(C0, C1, C2)> { TupleView((c0, c1, c2)) }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3) -> TupleView<(C0, C1, C2, C3)> { TupleView((c0, c1, c2, c3)) }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4) -> TupleView<(C0, C1, C2, C3, C4)> { TupleView((c0, c1, c2, c3, c4)) }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5) -> TupleView<(C0, C1, C2, C3, C4, C5)> { TupleView((c0, c1, c2, c3, c4, c5)) }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6) -> TupleView<(C0, C1, C2, C3, C4, C5, C6)> { TupleView((c0, c1, c2, c3, c4, c5, c6)) }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7) -> TupleView<(C0, C1, C2, C3, C4, C5, C6, C7)> { TupleView((c0, c1, c2, c3, c4, c5, c6, c7)) }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View, C8: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7, _ c8: C8) -> TupleView<(C0, C1, C2, C3, C4, C5, C6, C7, C8)> { TupleView((c0, c1, c2, c3, c4, c5, c6, c7, c8)) }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View, C8: View, C9: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7, _ c8: C8, _ c9: C9) -> TupleView<(C0, C1, C2, C3, C4, C5, C6, C7, C8, C9)> { TupleView((c0, c1, c2, c3, c4, c5, c6, c7, c8, c9)) }
    public static func buildIf<Content: View>(_ content: Content?) -> Content? { content }
    public static func buildEither<T: View, F: View>(first: T) -> _ConditionalContent<T, F> { .init() }
    public static func buildEither<T: View, F: View>(second: F) -> _ConditionalContent<T, F> { .init() }
    public static func buildLimitedAvailability<Content: View>(_ content: Content) -> AnyView { AnyView(content) }
}

public struct TupleView<T>: View {
    public init(_ value: T) {}
    public var body: Never { fatalError() }
}
public struct _ConditionalContent<TrueContent: View, FalseContent: View>: View {
    init() {}
    public var body: Never { fatalError() }
}
extension Optional: View where Wrapped: View {
    public var body: Never { fatalError() }
}
public struct EmptyView: View { public init() {}; public var body: Never { fatalError() } }
public struct AnyView: View {
    public init<V: View>(_ view: V) {}
    public init<V: View>(erasing view: V) {}
    public var body: Never { fatalError() }
}
public struct Group<Content> {
    public init(@ViewBuilder content: () -> Content) where Content: View {}
}
extension Group: View where Content: View { public var body: Never { fatalError() } }

// MARK: - Geometry & layout values

public struct Angle: Hashable, Sendable {
    public var radians: Double
    public var degrees: Double { radians * 180 / .pi }
    public init(radians: Double) { self.radians = radians }
    public init(degrees: Double) { self.radians = degrees * .pi / 180 }
    public static func degrees(_ d: Double) -> Angle { Angle(degrees: d) }
    public static func radians(_ r: Double) -> Angle { Angle(radians: r) }
    public static var zero: Angle { Angle(radians: 0) }
}

public struct UnitPoint: Hashable, Sendable {
    public var x: CGFloat, y: CGFloat
    public init(x: CGFloat, y: CGFloat) { self.x = x; self.y = y }
    public static let zero = UnitPoint(x: 0, y: 0), center = UnitPoint(x: 0.5, y: 0.5)
    public static let leading = UnitPoint(x: 0, y: 0.5), trailing = UnitPoint(x: 1, y: 0.5)
    public static let top = UnitPoint(x: 0.5, y: 0), bottom = UnitPoint(x: 0.5, y: 1)
    public static let topLeading = UnitPoint(x: 0, y: 0), topTrailing = UnitPoint(x: 1, y: 0)
    public static let bottomLeading = UnitPoint(x: 0, y: 1), bottomTrailing = UnitPoint(x: 1, y: 1)
}

public enum Axis: Int8, CaseIterable, Sendable {
    case horizontal, vertical
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int8
        public init(rawValue: Int8) { self.rawValue = rawValue }
        public static let horizontal = Set(rawValue: 1), vertical = Set(rawValue: 2)
    }
}

public enum Edge: Int8, CaseIterable, Sendable {
    case top, leading, bottom, trailing
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int8
        public init(rawValue: Int8) { self.rawValue = rawValue }
        public init(_ e: Edge) { self.rawValue = 1 << e.rawValue }
        public static let top = Set(rawValue: 1), leading = Set(rawValue: 2), bottom = Set(rawValue: 4), trailing = Set(rawValue: 8)
        public static let all = Set(rawValue: 15), horizontal = Set(rawValue: 10), vertical = Set(rawValue: 5)
    }
}

public struct EdgeInsets: Equatable, Sendable {
    public var top: CGFloat, leading: CGFloat, bottom: CGFloat, trailing: CGFloat
    public init(top: CGFloat, leading: CGFloat, bottom: CGFloat, trailing: CGFloat) { self.top = top; self.leading = leading; self.bottom = bottom; self.trailing = trailing }
    public init() { self.init(top: 0, leading: 0, bottom: 0, trailing: 0) }
}

public struct HorizontalAlignment: Equatable, Sendable {
    public static let leading = HorizontalAlignment(), center = HorizontalAlignment(), trailing = HorizontalAlignment()
    public static let listRowSeparatorLeading = HorizontalAlignment(), listRowSeparatorTrailing = HorizontalAlignment()
}
public struct VerticalAlignment: Equatable, Sendable {
    public static let top = VerticalAlignment(), center = VerticalAlignment(), bottom = VerticalAlignment()
    public static let firstTextBaseline = VerticalAlignment(), lastTextBaseline = VerticalAlignment()
}
public struct Alignment: Equatable, Sendable {
    public var horizontal: HorizontalAlignment
    public var vertical: VerticalAlignment
    public init(horizontal: HorizontalAlignment, vertical: VerticalAlignment) { self.horizontal = horizontal; self.vertical = vertical }
    public static let center = Alignment(horizontal: .center, vertical: .center)
    public static let leading = Alignment(horizontal: .leading, vertical: .center)
    public static let trailing = Alignment(horizontal: .trailing, vertical: .center)
    public static let top = Alignment(horizontal: .center, vertical: .top)
    public static let bottom = Alignment(horizontal: .center, vertical: .bottom)
    public static let topLeading = Alignment(horizontal: .leading, vertical: .top)
    public static let topTrailing = Alignment(horizontal: .trailing, vertical: .top)
    public static let bottomLeading = Alignment(horizontal: .leading, vertical: .bottom)
    public static let bottomTrailing = Alignment(horizontal: .trailing, vertical: .bottom)
    public static let leadingFirstTextBaseline = Alignment(horizontal: .leading, vertical: .firstTextBaseline)
}
public struct ViewDimensions {
    public var width: CGFloat { 0 }
    public var height: CGFloat { 0 }
    public subscript(guide: HorizontalAlignment) -> CGFloat { 0 }
    public subscript(guide: VerticalAlignment) -> CGFloat { 0 }
}

public enum ContentMode: Hashable, Sendable { case fit, fill }

public struct ProposedViewSize: Equatable, Sendable {
    public var width: CGFloat?, height: CGFloat?
    public init(width: CGFloat?, height: CGFloat?) { self.width = width; self.height = height }
    public static let unspecified = ProposedViewSize(width: nil, height: nil)
}

public struct SafeAreaRegions: OptionSet, Sendable {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let container = SafeAreaRegions(rawValue: 1), keyboard = SafeAreaRegions(rawValue: 2), all = SafeAreaRegions(rawValue: 3)
}

// MARK: - Colors, styles, fonts

public protocol ShapeStyle: Sendable {}

public struct Color: Hashable, CustomStringConvertible, Sendable, ShapeStyle {
    public enum RGBColorSpace: Sendable { case sRGB, sRGBLinear, displayP3 }
    public init(_ colorSpace: RGBColorSpace = .sRGB, red: Double, green: Double, blue: Double, opacity: Double = 1) {}
    public init(_ colorSpace: RGBColorSpace = .sRGB, white: Double, opacity: Double = 1) {}
    public init(hue: Double, saturation: Double, brightness: Double, opacity: Double = 1) {}
    public init(_ name: String, bundle: Bundle? = nil) {}
    public init(uiColor: UIColor) {}
    public init(_ color: UIColor) {}
    public func opacity(_ opacity: Double) -> Color { self }
    public func mix(with rhs: Color, by fraction: Double) -> Color { self }
    public var description: String { "" }
    public static let black = Color(white: 0), white = Color(white: 1), gray = Color(white: 0.5), clear = Color(white: 0, opacity: 0)
    public static let red = Color(white: 0), orange = Color(white: 0), yellow = Color(white: 0), green = Color(white: 0), mint = Color(white: 0)
    public static let teal = Color(white: 0), cyan = Color(white: 0), blue = Color(white: 0), indigo = Color(white: 0), purple = Color(white: 0)
    public static let pink = Color(white: 0), brown = Color(white: 0)
    public static let primary = Color(white: 0), secondary = Color(white: 0), accentColor = Color(white: 0)
}
extension Color: View {
    public var body: Never { fatalError() }
}
extension ShapeStyle where Self == Color {
    public static var black: Color { .black }
    public static var white: Color { .white }
    public static var clear: Color { .clear }
    public static var red: Color { .red }
    public static var orange: Color { .orange }
    public static var yellow: Color { .yellow }
    public static var green: Color { .green }
    public static var blue: Color { .blue }
    public static var gray: Color { .gray }
    public static var accentColor: Color { .accentColor }
}

public struct HierarchicalShapeStyle: ShapeStyle {
    public static let primary = HierarchicalShapeStyle(), secondary = HierarchicalShapeStyle()
    public static let tertiary = HierarchicalShapeStyle(), quaternary = HierarchicalShapeStyle()
    @available(iOS 17.0, *) public static let quinary = HierarchicalShapeStyle()
}
extension ShapeStyle where Self == HierarchicalShapeStyle {
    public static var primary: HierarchicalShapeStyle { .primary }
    public static var secondary: HierarchicalShapeStyle { .secondary }
    public static var tertiary: HierarchicalShapeStyle { .tertiary }
    public static var quaternary: HierarchicalShapeStyle { .quaternary }
}
public struct ForegroundStyle: ShapeStyle { public init() {} }
extension ShapeStyle where Self == ForegroundStyle { public static var foreground: ForegroundStyle { .init() } }
public struct BackgroundStyle: ShapeStyle { public init() {} }
extension ShapeStyle where Self == BackgroundStyle { public static var background: BackgroundStyle { .init() } }
public struct TintShapeStyle: ShapeStyle { public init() {} }
extension ShapeStyle where Self == TintShapeStyle { public static var tint: TintShapeStyle { .init() } }
public struct SeparatorShapeStyle: ShapeStyle { public init() {} }
extension ShapeStyle where Self == SeparatorShapeStyle { public static var separator: SeparatorShapeStyle { .init() } }

public struct Material: ShapeStyle {
    public static let regular = Material(), thick = Material(), thin = Material(), ultraThin = Material(), ultraThick = Material(), bar = Material()
}
extension ShapeStyle where Self == Material {
    public static var regularMaterial: Material { .regular }
    public static var thinMaterial: Material { .thin }
    public static var ultraThinMaterial: Material { .ultraThin }
    public static var thickMaterial: Material { .thick }
    public static var bar: Material { .bar }
}

public struct AnyShapeStyle: ShapeStyle {
    public init<S: ShapeStyle>(_ style: S) {}
}
extension ShapeStyle {
    public func opacity(_ opacity: Double) -> some ShapeStyle { self }
}

public struct Gradient: Hashable, Sendable {
    public struct Stop: Hashable, Sendable {
        public init(color: Color, location: CGFloat) {}
    }
    public init(colors: [Color]) {}
    public init(stops: [Stop]) {}
}
public struct LinearGradient: ShapeStyle {
    public init(gradient: Gradient, startPoint: UnitPoint, endPoint: UnitPoint) {}
    public init(colors: [Color], startPoint: UnitPoint, endPoint: UnitPoint) {}
    public init(stops: [Gradient.Stop], startPoint: UnitPoint, endPoint: UnitPoint) {}
}
extension LinearGradient: View { public var body: Never { fatalError() } }
extension ShapeStyle where Self == LinearGradient {
    public static func linearGradient(_ gradient: Gradient, startPoint: UnitPoint, endPoint: UnitPoint) -> LinearGradient { LinearGradient(gradient: gradient, startPoint: startPoint, endPoint: endPoint) }
    public static func linearGradient(colors: [Color], startPoint: UnitPoint, endPoint: UnitPoint) -> LinearGradient { LinearGradient(colors: colors, startPoint: startPoint, endPoint: endPoint) }
}

public enum ColorScheme: CaseIterable, Hashable, Sendable { case light, dark }
public enum ColorSchemeContrast: CaseIterable, Hashable, Sendable { case standard, increased }
public enum ColorRenderingMode: Hashable, Sendable { case nonLinear, linear, extendedLinear }

public struct Font: Hashable, Sendable {
    public enum TextStyle: CaseIterable, Hashable, Sendable { case largeTitle, title, title2, title3, headline, subheadline, body, callout, footnote, caption, caption2 }
    public enum Design: Hashable, Sendable { case `default`, serif, rounded, monospaced }
    public struct Weight: Hashable, Sendable {
        public static let ultraLight = Weight(), thin = Weight(), light = Weight(), regular = Weight(), medium = Weight()
        public static let semibold = Weight(), bold = Weight(), heavy = Weight(), black = Weight()
    }
    public struct Width: Hashable, Sendable {
        public static let compressed = Width(), condensed = Width(), standard = Width(), expanded = Width()
    }
    public enum Leading: Hashable, Sendable { case standard, tight, loose }
    public static let largeTitle = Font(), title = Font(), title2 = Font(), title3 = Font(), headline = Font()
    public static let subheadline = Font(), body = Font(), callout = Font(), footnote = Font(), caption = Font(), caption2 = Font()
    public static func system(_ style: TextStyle, design: Design? = nil, weight: Weight? = nil) -> Font { Font() }
    public static func system(size: CGFloat, weight: Weight? = nil, design: Design? = nil) -> Font { Font() }
    public static func custom(_ name: String, size: CGFloat) -> Font { Font() }
    public static func custom(_ name: String, size: CGFloat, relativeTo textStyle: TextStyle) -> Font { Font() }
    public func weight(_ weight: Weight) -> Font { self }
    public func width(_ width: Width) -> Font { self }
    public func bold() -> Font { self }
    public func italic() -> Font { self }
    public func monospacedDigit() -> Font { self }
    public func monospaced() -> Font { self }
    public func smallCaps() -> Font { self }
    public func leading(_ leading: Leading) -> Font { self }
}

public enum TextAlignment: Hashable, CaseIterable, Sendable { case leading, center, trailing }

public enum DynamicTypeSize: Hashable, Comparable, CaseIterable, Sendable {
    case xSmall, small, medium, large, xLarge, xxLarge, xxxLarge, accessibility1, accessibility2, accessibility3, accessibility4, accessibility5
    public var isAccessibilitySize: Bool { false }
}

public enum LegibilityWeight: Hashable, Sendable { case regular, bold }

// MARK: - Animation & transitions

public struct Animation: Equatable, Sendable {
    public static let `default` = Animation()
    public static func easeIn(duration: Double) -> Animation { Animation() }
    public static func easeOut(duration: Double) -> Animation { Animation() }
    public static func easeInOut(duration: Double) -> Animation { Animation() }
    public static func linear(duration: Double) -> Animation { Animation() }
    public static var easeIn: Animation { Animation() }
    public static var easeOut: Animation { Animation() }
    public static var easeInOut: Animation { Animation() }
    public static var linear: Animation { Animation() }
    public static func spring(response: Double = 0.5, dampingFraction: Double = 0.825, blendDuration: Double = 0) -> Animation { Animation() }
    public static func spring(duration: TimeInterval = 0.5, bounce: Double = 0, blendDuration: Double = 0) -> Animation { Animation() }
    public static var spring: Animation { Animation() }
    public static var smooth: Animation { Animation() }
    public static var snappy: Animation { Animation() }
    public static var bouncy: Animation { Animation() }
    public static func smooth(duration: TimeInterval = 0.5, extraBounce: Double = 0) -> Animation { Animation() }
    public static func snappy(duration: TimeInterval = 0.5, extraBounce: Double = 0) -> Animation { Animation() }
    public static func interactiveSpring(response: Double = 0.15, dampingFraction: Double = 0.86, blendDuration: Double = 0.25) -> Animation { Animation() }
    public func delay(_ delay: Double) -> Animation { self }
    public func speed(_ speed: Double) -> Animation { self }
    public func repeatForever(autoreverses: Bool = true) -> Animation { self }
}

public struct Transaction {
    public init() {}
    public init(animation: Animation?) {}
    public var animation: Animation?
    public var disablesAnimations: Bool = false
}

@MainActor public func withAnimation<Result>(_ animation: Animation? = .default, _ body: () throws -> Result) rethrows -> Result { try body() }
@MainActor public func withTransaction<Result>(_ transaction: Transaction, _ body: () throws -> Result) rethrows -> Result { try body() }

public struct AnyTransition: Sendable {
    public static let opacity = AnyTransition(), identity = AnyTransition(), scale = AnyTransition(), slide = AnyTransition()
    public static func move(edge: Edge) -> AnyTransition { AnyTransition() }
    public static func push(from edge: Edge) -> AnyTransition { AnyTransition() }
    public static func offset(x: CGFloat = 0, y: CGFloat = 0) -> AnyTransition { AnyTransition() }
    public static func scale(scale: CGFloat, anchor: UnitPoint = .center) -> AnyTransition { AnyTransition() }
    public static func asymmetric(insertion: AnyTransition, removal: AnyTransition) -> AnyTransition { AnyTransition() }
    public func combined(with other: AnyTransition) -> AnyTransition { self }
    public func animation(_ animation: Animation?) -> AnyTransition { self }
}

public struct ContentTransition: Equatable, Sendable {
    public static let identity = ContentTransition(), opacity = ContentTransition(), interpolate = ContentTransition()
    public static func numericText(countsDown: Bool = false) -> ContentTransition { ContentTransition() }
    @available(iOS 17.0, *) public static func numericText(value: Double) -> ContentTransition { ContentTransition() }
    public static func symbolEffect<T: ContentTransitionSymbolEffect & SymbolEffect>(_ effect: T, options: SymbolEffectOptions = .default) -> ContentTransition { ContentTransition() }
    public static var symbolEffect: ContentTransition { ContentTransition() }
}

// MARK: - Text, Image, Label

public struct LocalizedStringKey: Equatable, ExpressibleByStringInterpolation, Sendable {
    public init(_ value: String) {}
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: StringInterpolation) {}
    public struct StringInterpolation: StringInterpolationProtocol {
        public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ literal: String) {}
        public mutating func appendInterpolation(_ string: String) {}
        public mutating func appendInterpolation<Subject: ReferenceConvertible>(_ subject: Subject, formatter: Formatter? = nil) {}
        public mutating func appendInterpolation<Subject: NSObject>(_ subject: Subject, formatter: Formatter? = nil) {}
        public mutating func appendInterpolation<F: FormatStyle>(_ input: F.FormatInput, format: F) where F.FormatInput: Equatable, F.FormatOutput == String {}
        public mutating func appendInterpolation<T: _FormatSpecifiable>(_ value: T) {}
        public mutating func appendInterpolation<T: _FormatSpecifiable>(_ value: T, specifier: String) {}
        public mutating func appendInterpolation(_ text: Text) {}
        public mutating func appendInterpolation(_ attributedString: AttributedString) {}
        public mutating func appendInterpolation(_ image: Image) {}
        public mutating func appendInterpolation(_ date: Date, style: Text.DateStyle) {}
    }
}
public protocol _FormatSpecifiable: Equatable {}
extension Int: _FormatSpecifiable {}
extension Int8: _FormatSpecifiable {}
extension Int16: _FormatSpecifiable {}
extension Int32: _FormatSpecifiable {}
extension Int64: _FormatSpecifiable {}
extension UInt: _FormatSpecifiable {}
extension UInt8: _FormatSpecifiable {}
extension UInt16: _FormatSpecifiable {}
extension UInt32: _FormatSpecifiable {}
extension UInt64: _FormatSpecifiable {}
extension Float: _FormatSpecifiable {}
extension Double: _FormatSpecifiable {}
extension CGFloat: _FormatSpecifiable {}

public struct Text: Equatable, Sendable, View {
    public enum DateStyle: Sendable { case time, date, relative, offset, timer }
    public enum Case: Hashable, Sendable { case uppercase, lowercase }
    public enum TruncationMode: Sendable { case head, tail, middle }
    public struct LineStyle: Hashable, Sendable {
        public enum Pattern: Sendable { case solid, dot, dash, dashDot, dashDotDot }
        public init(pattern: Pattern = .solid, color: Color? = nil) {}
        public static let single = LineStyle()
    }
    public init(_ key: LocalizedStringKey, tableName: String? = nil, bundle: Bundle? = nil, comment: StaticString? = nil) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ content: S) {}
    public init(verbatim content: String) {}
    public init(_ attributedContent: AttributedString) {}
    public init(_ date: Date, style: DateStyle) {}
    public init(_ dates: ClosedRange<Date>) {}
    public init(_ image: Image) {}
    public init<F: FormatStyle>(_ input: F.FormatInput, format: F) where F.FormatInput: Equatable, F.FormatOutput == String {}
    public init(timerInterval: ClosedRange<Date>, pauseTime: Date? = nil, countsDown: Bool = true, showsHours: Bool = true) {}
    public init<Subject: ReferenceConvertible>(_ subject: Subject, formatter: Formatter) {}
    public static func + (lhs: Text, rhs: Text) -> Text { lhs }
    public var body: Never { fatalError() }

    public func foregroundColor(_ color: Color?) -> Text { self }
    public func foregroundStyle<S: ShapeStyle>(_ style: S) -> Text { self }
    public func font(_ font: Font?) -> Text { self }
    public func fontWeight(_ weight: Font.Weight?) -> Text { self }
    public func fontWidth(_ width: Font.Width?) -> Text { self }
    public func fontDesign(_ design: Font.Design?) -> Text { self }
    public func bold() -> Text { self }
    public func bold(_ isActive: Bool) -> Text { self }
    public func italic() -> Text { self }
    public func italic(_ isActive: Bool) -> Text { self }
    public func monospaced(_ isActive: Bool = true) -> Text { self }
    public func monospacedDigit() -> Text { self }
    public func strikethrough(_ isActive: Bool = true, color: Color? = nil) -> Text { self }
    public func strikethrough(_ isActive: Bool = true, pattern: LineStyle.Pattern, color: Color? = nil) -> Text { self }
    public func underline(_ isActive: Bool = true, color: Color? = nil) -> Text { self }
    public func kerning(_ kerning: CGFloat) -> Text { self }
    public func tracking(_ tracking: CGFloat) -> Text { self }
    public func baselineOffset(_ baselineOffset: CGFloat) -> Text { self }
    public func textScale(_ scale: Text.Scale, isEnabled: Bool = true) -> Text { self }
    public struct Scale: Hashable, Sendable { public static let `default` = Scale(), secondary = Scale() }
}

public struct Image: Equatable, Sendable, View {
    public enum TemplateRenderingMode: Hashable, Sendable { case template, original }
    public enum Scale: Hashable, Sendable { case small, medium, large }
    public enum ResizingMode: Hashable, Sendable { case tile, stretch }
    public enum Interpolation: Hashable, Sendable { case none, low, medium, high }
    public init(_ name: String, bundle: Bundle? = nil) {}
    public init(systemName: String) {}
    public init(systemName: String, variableValue: Double?) {}
    public init(decorative name: String, bundle: Bundle? = nil) {}
    public init(uiImage: AnyObject) {}
    public func resizable(capInsets: EdgeInsets = EdgeInsets(), resizingMode: ResizingMode = .stretch) -> Image { self }
    public func renderingMode(_ renderingMode: TemplateRenderingMode?) -> Image { self }
    public func interpolation(_ interpolation: Interpolation) -> Image { self }
    public func symbolRenderingMode(_ mode: SymbolRenderingMode?) -> Image { self }
    public var body: Never { fatalError() }
}

public struct SymbolRenderingMode: Sendable {
    public static let monochrome = SymbolRenderingMode(), multicolor = SymbolRenderingMode()
    public static let hierarchical = SymbolRenderingMode(), palette = SymbolRenderingMode()
}
public struct SymbolVariants: Hashable, Sendable {
    public static let none = SymbolVariants(), fill = SymbolVariants(), circle = SymbolVariants(), slash = SymbolVariants()
}

public struct Label<Title: View, Icon: View>: View {
    public init(@ViewBuilder title: () -> Title, @ViewBuilder icon: () -> Icon) {}
    public var body: Never { fatalError() }
}
extension Label where Title == Text, Icon == Image {
    public init(_ titleKey: LocalizedStringKey, systemImage name: String) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage name: String) {}
    public init(_ titleKey: LocalizedStringKey, image name: String) {}
}

public struct LabeledContent<Label: View, Content: View>: View {
    public init(@ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension LabeledContent where Label == Text {
    public init(_ titleKey: LocalizedStringKey, @ViewBuilder content: () -> Content) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) {}
}
extension LabeledContent where Label == Text, Content == Text {
    public init(_ titleKey: LocalizedStringKey, value: String) {}
    @_disfavoredOverload public init<S1: StringProtocol, S2: StringProtocol>(_ title: S1, value: S2) {}
    public init<F: FormatStyle>(_ titleKey: LocalizedStringKey, value: F.FormatInput, format: F) where F.FormatInput: Equatable, F.FormatOutput == String {}
}

// MARK: - Stacks, grids, containers

public struct VStack<Content: View>: View {
    public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct HStack<Content: View>: View {
    public init(alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct ZStack<Content: View>: View {
    public init(alignment: Alignment = .center, @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct LazyVStack<Content: View>: View {
    public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = .init(), @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct LazyHStack<Content: View>: View {
    public init(alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = .init(), @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct PinnedScrollableViews: OptionSet, Sendable {
    public let rawValue: UInt32
    public init(rawValue: UInt32) { self.rawValue = rawValue }
    public static let sectionHeaders = PinnedScrollableViews(rawValue: 1), sectionFooters = PinnedScrollableViews(rawValue: 2)
}
public struct GridItem: Sendable {
    public enum Size: Sendable {
        case fixed(CGFloat)
        case flexible(minimum: CGFloat = 10, maximum: CGFloat = .infinity)
        case adaptive(minimum: CGFloat, maximum: CGFloat = .infinity)
    }
    public init(_ size: Size = .flexible(), spacing: CGFloat? = nil, alignment: Alignment? = nil) {}
}
public struct LazyVGrid<Content: View>: View {
    public init(columns: [GridItem], alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = .init(), @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct LazyHGrid<Content: View>: View {
    public init(rows: [GridItem], alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = .init(), @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct Grid<Content: View>: View {
    public init(alignment: Alignment = .center, horizontalSpacing: CGFloat? = nil, verticalSpacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct GridRow<Content: View>: View {
    public init(alignment: VerticalAlignment? = nil, @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct Spacer: View {
    public init(minLength: CGFloat? = nil) {}
    public var body: Never { fatalError() }
}
public struct Divider: View { public init() {}; public var body: Never { fatalError() } }

public struct ViewThatFits<Content: View>: View {
    public init(in axes: Axis.Set = [.horizontal, .vertical], @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}

public struct GeometryProxy {
    public var size: CGSize { .zero }
    public var safeAreaInsets: EdgeInsets { EdgeInsets() }
    public func frame(in coordinateSpace: CoordinateSpace) -> CGRect { .zero }
}
public enum CoordinateSpace: Hashable { case global, local, named(AnyHashable) }
public struct GeometryReader<Content: View>: View {
    public init(@ViewBuilder content: @escaping (GeometryProxy) -> Content) {}
    public var body: Never { fatalError() }
}

public struct ScrollViewProxy {
    public func scrollTo<ID: Hashable>(_ id: ID, anchor: UnitPoint? = nil) {}
}
public struct ScrollViewReader<Content: View>: View {
    public init(@ViewBuilder content: @escaping (ScrollViewProxy) -> Content) {}
    public var body: Never { fatalError() }
}
public struct ScrollView<Content: View>: View {
    public init(_ axes: Axis.Set = .vertical, showsIndicators: Bool = true, @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
public struct ScrollPosition {}
public enum ScrollDismissesKeyboardMode: Sendable { case automatic, immediately, interactively, never }
public struct ScrollBounceBehavior: Sendable { public static let automatic = ScrollBounceBehavior(), always = ScrollBounceBehavior(), basedOnSize = ScrollBounceBehavior() }
public struct ScrollIndicatorVisibility: Sendable { public static let automatic = ScrollIndicatorVisibility(), visible = ScrollIndicatorVisibility(), hidden = ScrollIndicatorVisibility(), never = ScrollIndicatorVisibility() }

public struct ForEach<Data: RandomAccessCollection, ID: Hashable, Content> {
    public var data: Data
}
extension ForEach: View where Content: View {
    public var body: Never { fatalError() }
}
extension ForEach where Content: View {
    public init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) where ID == Data.Element.ID, Data.Element: Identifiable { self.data = data }
    public init(_ data: Data, id: KeyPath<Data.Element, ID>, @ViewBuilder content: @escaping (Data.Element) -> Content) { self.data = data }
    public init<C: MutableCollection & RandomAccessCollection>(_ data: Binding<C>, @ViewBuilder content: @escaping (Binding<C.Element>) -> Content) where Data == LazyMapSequence<C.Indices, (C.Index, ID)>, ID == C.Element.ID, C.Element: Identifiable, C.Index: Hashable { fatalError() }
    public init<C: MutableCollection & RandomAccessCollection>(_ data: Binding<C>, id: KeyPath<C.Element, ID>, @ViewBuilder content: @escaping (Binding<C.Element>) -> Content) where Data == LazyMapSequence<C.Indices, (C.Index, ID)>, C.Index: Hashable { fatalError() }
}
extension ForEach where Data == Range<Int>, ID == Int, Content: View {
    public init(_ data: Range<Int>, @ViewBuilder content: @escaping (Int) -> Content) { self.data = data }
}
extension ForEach: DynamicViewContent where Content: View {}
public protocol DynamicViewContent: View {}
extension DynamicViewContent {
    public func onDelete(perform action: ((IndexSet) -> Void)?) -> some DynamicViewContent { self }
    public func onMove(perform action: ((IndexSet, Int) -> Void)?) -> some DynamicViewContent { self }
}

public struct List<SelectionValue: Hashable, Content: View>: View {
    public var body: Never { fatalError() }
}
extension List {
    public init(@ViewBuilder content: () -> Content) where SelectionValue == Never {}
    public init(selection: Binding<SelectionValue?>?, @ViewBuilder content: () -> Content) {}
    public init<Data: RandomAccessCollection, RowContent: View>(_ data: Data, @ViewBuilder rowContent: @escaping (Data.Element) -> RowContent) where Content == ForEach<Data, Data.Element.ID, RowContent>, Data.Element: Identifiable, SelectionValue == Never {}
}

public struct Form<Content: View>: View {
    public init(@ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}

public struct Section<Parent, Content, Footer> {}
extension Section: View where Parent: View, Content: View, Footer: View {
    public var body: Never { fatalError() }
    public init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Parent, @ViewBuilder footer: () -> Footer) {}
}
extension Section where Parent == EmptyView, Content: View, Footer == EmptyView {
    public init(@ViewBuilder content: () -> Content) {}
}
extension Section where Parent: View, Content: View, Footer == EmptyView {
    public init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Parent) {}
}
extension Section where Parent == EmptyView, Content: View, Footer: View {
    public init(@ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {}
}
extension Section where Parent == Text, Content: View, Footer == EmptyView {
    public init(_ titleKey: LocalizedStringKey, @ViewBuilder content: () -> Content) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) {}
    public init(_ titleKey: LocalizedStringKey, isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content) {}
}

public struct DisclosureGroup<Label: View, Content: View>: View {
    public init(isExpanded: Binding<Bool>, @ViewBuilder content: @escaping () -> Content, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension DisclosureGroup where Label == Text {
    public init(_ titleKey: LocalizedStringKey, @ViewBuilder content: @escaping () -> Content) {}
    public init(_ titleKey: LocalizedStringKey, isExpanded: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ label: S, isExpanded: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) {}
}

// MARK: - Layout protocol, AnyLayout

public protocol Layout: Animatable {
    associatedtype Cache = Void
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache)
    func makeCache(subviews: Subviews) -> Cache
    typealias Subviews = LayoutSubviews
}
extension Layout where Cache == Void { public func makeCache(subviews: Subviews) -> Void {} }
public struct LayoutSubviews: RandomAccessCollection {
    public var startIndex: Int { 0 }
    public var endIndex: Int { 0 }
    public subscript(i: Int) -> LayoutSubview { LayoutSubview() }
}
public struct LayoutSubview {
    public func sizeThatFits(_ proposal: ProposedViewSize) -> CGSize { .zero }
    public func place(at position: CGPoint, anchor: UnitPoint = .topLeading, proposal: ProposedViewSize) {}
}
extension Layout {
    public func callAsFunction<V: View>(@ViewBuilder _ content: () -> V) -> some View { _Modified(content()) }
}
public struct VStackLayout: Layout {
    public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil) {}
    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize { .zero }
    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {}
}
public struct HStackLayout: Layout {
    public init(alignment: VerticalAlignment = .center, spacing: CGFloat? = nil) {}
    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize { .zero }
    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {}
}
public struct ZStackLayout: Layout {
    public init(alignment: Alignment = .center) {}
    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize { .zero }
    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {}
}
public struct AnyLayout: Layout {
    public init<L: Layout>(_ layout: L) {}
    public typealias Cache = Int
    public func makeCache(subviews: Subviews) -> Int { 0 }
    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Int) -> CGSize { .zero }
    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Int) {}
}

// MARK: - Shapes

public protocol Animatable {}
public struct Path: Equatable, Sendable {
    public init() {}
    public init(_ rect: CGRect) {}
    public init(roundedRect rect: CGRect, cornerRadius: CGFloat, style: RoundedCornerStyle = .continuous) {}
    public init(ellipseIn rect: CGRect) {}
    public init(_ callback: (inout Path) -> ()) {}
    public mutating func move(to end: CGPoint) {}
    public mutating func addLine(to end: CGPoint) {}
    public mutating func addLines(_ lines: [CGPoint]) {}
    public mutating func addRect(_ rect: CGRect) {}
    public mutating func addRoundedRect(in rect: CGRect, cornerSize: CGSize, style: RoundedCornerStyle = .continuous) {}
    public mutating func addEllipse(in rect: CGRect) {}
    public mutating func addQuadCurve(to end: CGPoint, control: CGPoint) {}
    public mutating func addCurve(to end: CGPoint, control1: CGPoint, control2: CGPoint) {}
    public mutating func addArc(center: CGPoint, radius: CGFloat, startAngle: Angle, endAngle: Angle, clockwise: Bool) {}
    public mutating func closeSubpath() {}
    public var isEmpty: Bool { true }
    public var boundingRect: CGRect { .zero }
}
extension Path: Shape {
    public func path(in rect: CGRect) -> Path { self }
}
public enum RoundedCornerStyle: Hashable, Sendable { case circular, continuous }

public protocol Shape: Sendable, Animatable, View {
    nonisolated func path(in rect: CGRect) -> Path
}
extension Shape {
    public var body: _ShapeView<Self, ForegroundStyle> { _ShapeView() }
}
public struct _ShapeView<Content: Shape, Style: ShapeStyle>: View { public var body: Never { fatalError() } }
public protocol InsettableShape: Shape {
    associatedtype InsetShape: InsettableShape
    func inset(by amount: CGFloat) -> InsetShape
}
public struct FillStyle: Equatable, Sendable { public init(eoFill: Bool = false, antialiased: Bool = true) {} }
public struct StrokeStyle: Equatable, Sendable {
    public var lineWidth: CGFloat
    public init(lineWidth: CGFloat = 1, lineCap: CGLineCap = .butt, lineJoin: CGLineJoin = .miter, miterLimit: CGFloat = 10, dash: [CGFloat] = [], dashPhase: CGFloat = 0) { self.lineWidth = lineWidth }
}
public enum CGLineCap: Int32, Sendable { case butt, round, square }
public enum CGLineJoin: Int32, Sendable { case miter, round, bevel }

extension Shape {
    public func fill<S: ShapeStyle>(_ content: S, style: FillStyle = FillStyle()) -> some View { _Modified(self) }
    public func fill(style: FillStyle = FillStyle()) -> some View { _Modified(self) }
    public func stroke<S: ShapeStyle>(_ content: S, style: StrokeStyle, antialiased: Bool = true) -> some View { _Modified(self) }
    public func stroke<S: ShapeStyle>(_ content: S, lineWidth: CGFloat = 1, antialiased: Bool = true) -> some View { _Modified(self) }
    public func stroke(style: StrokeStyle) -> some Shape { self }
    public func stroke(lineWidth: CGFloat = 1) -> some Shape { self }
    public func trim(from startFraction: CGFloat = 0, to endFraction: CGFloat = 1) -> some Shape { self }
    public func rotation(_ angle: Angle, anchor: UnitPoint = .center) -> some Shape { self }
    public func offset(x: CGFloat = 0, y: CGFloat = 0) -> some Shape { self }
}
extension InsettableShape {
    public func strokeBorder<S: ShapeStyle>(_ content: S, style: StrokeStyle, antialiased: Bool = true) -> some View { _Modified(self) }
    public func strokeBorder<S: ShapeStyle>(_ content: S, lineWidth: CGFloat = 1, antialiased: Bool = true) -> some View { _Modified(self) }
    public func strokeBorder(style: StrokeStyle, antialiased: Bool = true) -> some View { _Modified(self) }
    public func strokeBorder(lineWidth: CGFloat = 1, antialiased: Bool = true) -> some View { _Modified(self) }
}
public struct Rectangle: InsettableShape {
    public init() {}
    public func path(in rect: CGRect) -> Path { Path() }
    public func inset(by amount: CGFloat) -> Rectangle { self }
}
public struct RoundedRectangle: InsettableShape {
    public init(cornerRadius: CGFloat, style: RoundedCornerStyle = .continuous) {}
    public init(cornerSize: CGSize, style: RoundedCornerStyle = .continuous) {}
    public func path(in rect: CGRect) -> Path { Path() }
    public func inset(by amount: CGFloat) -> RoundedRectangle { self }
}
public struct RectangleCornerRadii: Equatable, Sendable {
    public init(topLeading: CGFloat = 0, bottomLeading: CGFloat = 0, bottomTrailing: CGFloat = 0, topTrailing: CGFloat = 0) {}
}
public struct UnevenRoundedRectangle: InsettableShape {
    public init(cornerRadii: RectangleCornerRadii, style: RoundedCornerStyle = .continuous) {}
    public init(topLeadingRadius: CGFloat = 0, bottomLeadingRadius: CGFloat = 0, bottomTrailingRadius: CGFloat = 0, topTrailingRadius: CGFloat = 0, style: RoundedCornerStyle = .continuous) {}
    public func path(in rect: CGRect) -> Path { Path() }
    public func inset(by amount: CGFloat) -> UnevenRoundedRectangle { self }
}
public struct Capsule: InsettableShape {
    public init(style: RoundedCornerStyle = .continuous) {}
    public func path(in rect: CGRect) -> Path { Path() }
    public func inset(by amount: CGFloat) -> Capsule { self }
}
public struct Circle: InsettableShape {
    public init() {}
    public func path(in rect: CGRect) -> Path { Path() }
    public func inset(by amount: CGFloat) -> Circle { self }
}
public struct Ellipse: InsettableShape {
    public init() {}
    public func path(in rect: CGRect) -> Path { Path() }
    public func inset(by amount: CGFloat) -> Ellipse { self }
}
public struct AnyShape: Shape {
    public init<S: Shape>(_ shape: S) {}
    public func path(in rect: CGRect) -> Path { Path() }
}
extension Shape where Self == Rectangle { public static var rect: Rectangle { Rectangle() } }
extension Shape where Self == Circle { public static var circle: Circle { Circle() } }
extension Shape where Self == Capsule {
    public static var capsule: Capsule { Capsule() }
    public static func capsule(style: RoundedCornerStyle) -> Capsule { Capsule(style: style) }
}
extension Shape where Self == RoundedRectangle {
    public static func rect(cornerRadius: CGFloat, style: RoundedCornerStyle = .continuous) -> RoundedRectangle { RoundedRectangle(cornerRadius: cornerRadius, style: style) }
}
extension Shape where Self == UnevenRoundedRectangle {
    public static func rect(topLeadingRadius: CGFloat = 0, bottomLeadingRadius: CGFloat = 0, bottomTrailingRadius: CGFloat = 0, topTrailingRadius: CGFloat = 0, style: RoundedCornerStyle = .continuous) -> UnevenRoundedRectangle { UnevenRoundedRectangle() }
}
public struct ContainerRelativeShape: InsettableShape {
    public init() {}
    public func path(in rect: CGRect) -> Path { Path() }
    public func inset(by amount: CGFloat) -> ContainerRelativeShape { self }
}

public struct Canvas<Symbols: View>: View {
    public var body: Never { fatalError() }
}
public struct GraphicsContext {
    public mutating func fill(_ path: Path, with shading: Shading, style: FillStyle = FillStyle()) {}
    public mutating func stroke(_ path: Path, with shading: Shading, style: StrokeStyle) {}
    public mutating func stroke(_ path: Path, with shading: Shading, lineWidth: CGFloat = 1) {}
    public struct Shading { public static func color(_ color: Color) -> Shading { Shading() } }
}
extension Canvas where Symbols == EmptyView {
    public init(opaque: Bool = false, colorMode: ColorRenderingMode = .nonLinear, rendersAsynchronously: Bool = false, renderer: @escaping (inout GraphicsContext, CGSize) -> Void) {}
}

// MARK: - Controls

public struct ButtonRole: Equatable, Sendable {
    public static let destructive = ButtonRole(), cancel = ButtonRole()
}
public struct Button<Label: View>: View {
    public init(action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) {}
    public init(role: ButtonRole?, action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension Button where Label == Text {
    public init(_ titleKey: LocalizedStringKey, action: @escaping @MainActor () -> Void) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, action: @escaping @MainActor () -> Void) {}
    public init(_ titleKey: LocalizedStringKey, role: ButtonRole?, action: @escaping @MainActor () -> Void) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, role: ButtonRole?, action: @escaping @MainActor () -> Void) {}
}
extension Button where Label == SwiftUI.Label<Text, Image> {
    public init(_ titleKey: LocalizedStringKey, systemImage: String, action: @escaping @MainActor () -> Void) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String, action: @escaping @MainActor () -> Void) {}
    public init(_ titleKey: LocalizedStringKey, systemImage: String, role: ButtonRole?, action: @escaping @MainActor () -> Void) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String, role: ButtonRole?, action: @escaping @MainActor () -> Void) {}
}

public struct ButtonStyleConfiguration {
    public struct Label: View { public var body: Never { fatalError() } }
    public let role: ButtonRole?
    public let label: Label
    public let isPressed: Bool
}
@MainActor @preconcurrency
public protocol ButtonStyle {
    associatedtype Body: View
    @ViewBuilder func makeBody(configuration: Configuration) -> Body
    typealias Configuration = ButtonStyleConfiguration
}
@MainActor @preconcurrency
public protocol PrimitiveButtonStyle {
    associatedtype Body: View
    @ViewBuilder func makeBody(configuration: Configuration) -> Body
    typealias Configuration = PrimitiveButtonStyleConfiguration
}
public struct PrimitiveButtonStyleConfiguration {
    public struct Label: View { public var body: Never { fatalError() } }
    public let label: Label
    public func trigger() {}
}
public struct PlainButtonStyle: PrimitiveButtonStyle { public init() {}; public func makeBody(configuration: Configuration) -> some View { configuration.label } }
public struct BorderlessButtonStyle: PrimitiveButtonStyle { public init() {}; public func makeBody(configuration: Configuration) -> some View { configuration.label } }
public struct BorderedButtonStyle: PrimitiveButtonStyle { public init() {}; public func makeBody(configuration: Configuration) -> some View { configuration.label } }
public struct BorderedProminentButtonStyle: PrimitiveButtonStyle { public init() {}; public func makeBody(configuration: Configuration) -> some View { configuration.label } }
public struct DefaultButtonStyle: PrimitiveButtonStyle { public init() {}; public func makeBody(configuration: Configuration) -> some View { configuration.label } }
extension PrimitiveButtonStyle where Self == PlainButtonStyle { public static var plain: PlainButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == BorderlessButtonStyle { public static var borderless: BorderlessButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == BorderedButtonStyle { public static var bordered: BorderedButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == BorderedProminentButtonStyle { public static var borderedProminent: BorderedProminentButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == DefaultButtonStyle { public static var automatic: DefaultButtonStyle { .init() } }
public struct ButtonBorderShape: Sendable {
    public static let automatic = ButtonBorderShape(), capsule = ButtonBorderShape(), roundedRectangle = ButtonBorderShape(), circle = ButtonBorderShape()
    public static func roundedRectangle(radius: CGFloat) -> ButtonBorderShape { ButtonBorderShape() }
}
public enum ControlSize: CaseIterable, Hashable, Sendable { case mini, small, regular, large, extraLarge }

public struct Toggle<Label: View>: View {
    public init(isOn: Binding<Bool>, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension Toggle where Label == Text {
    public init(_ titleKey: LocalizedStringKey, isOn: Binding<Bool>) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, isOn: Binding<Bool>) {}
}
public struct SwitchToggleStyle: ToggleStyle { public init() {} }
public protocol ToggleStyle {}
extension ToggleStyle where Self == SwitchToggleStyle { public static var `switch`: SwitchToggleStyle { .init() } }
public struct ButtonToggleStyle: ToggleStyle { public init() {} }
extension ToggleStyle where Self == ButtonToggleStyle { public static var button: ButtonToggleStyle { .init() } }

public struct Picker<Label: View, SelectionValue: Hashable, Content: View>: View {
    public init(selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension Picker where Label == Text {
    public init(_ titleKey: LocalizedStringKey, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) {}
}
public protocol PickerStyle {}
public struct SegmentedPickerStyle: PickerStyle { public init() {} }
public struct MenuPickerStyle: PickerStyle { public init() {} }
public struct WheelPickerStyle: PickerStyle { public init() {} }
public struct InlinePickerStyle: PickerStyle { public init() {} }
public struct NavigationLinkPickerStyle: PickerStyle { public init() {} }
public struct PalettePickerStyle: PickerStyle { public init() {} }
public struct DefaultPickerStyle: PickerStyle { public init() {} }
extension PickerStyle where Self == SegmentedPickerStyle { public static var segmented: SegmentedPickerStyle { .init() } }
extension PickerStyle where Self == MenuPickerStyle { public static var menu: MenuPickerStyle { .init() } }
extension PickerStyle where Self == WheelPickerStyle { public static var wheel: WheelPickerStyle { .init() } }
extension PickerStyle where Self == InlinePickerStyle { public static var inline: InlinePickerStyle { .init() } }
extension PickerStyle where Self == NavigationLinkPickerStyle { public static var navigationLink: NavigationLinkPickerStyle { .init() } }
extension PickerStyle where Self == PalettePickerStyle { public static var palette: PalettePickerStyle { .init() } }
extension PickerStyle where Self == DefaultPickerStyle { public static var automatic: DefaultPickerStyle { .init() } }

public struct DatePickerComponents: OptionSet, Sendable {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let date = DatePickerComponents(rawValue: 1), hourAndMinute = DatePickerComponents(rawValue: 2)
}
public struct DatePicker<Label: View>: View {
    public typealias Components = DatePickerComponents
    public init(selection: Binding<Date>, displayedComponents: Components = [.hourAndMinute, .date], @ViewBuilder label: () -> Label) {}
    public init(selection: Binding<Date>, in range: ClosedRange<Date>, displayedComponents: Components = [.hourAndMinute, .date], @ViewBuilder label: () -> Label) {}
    public init(selection: Binding<Date>, in range: PartialRangeFrom<Date>, displayedComponents: Components = [.hourAndMinute, .date], @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension DatePicker where Label == Text {
    public init(_ titleKey: LocalizedStringKey, selection: Binding<Date>, displayedComponents: Components = [.hourAndMinute, .date]) {}
    public init(_ titleKey: LocalizedStringKey, selection: Binding<Date>, in range: ClosedRange<Date>, displayedComponents: Components = [.hourAndMinute, .date]) {}
    public init(_ titleKey: LocalizedStringKey, selection: Binding<Date>, in range: PartialRangeFrom<Date>, displayedComponents: Components = [.hourAndMinute, .date]) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, selection: Binding<Date>, displayedComponents: Components = [.hourAndMinute, .date]) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, selection: Binding<Date>, in range: ClosedRange<Date>, displayedComponents: Components = [.hourAndMinute, .date]) {}
}
public protocol DatePickerStyle {}
public struct GraphicalDatePickerStyle: DatePickerStyle { public init() {} }
public struct CompactDatePickerStyle: DatePickerStyle { public init() {} }
public struct WheelDatePickerStyle: DatePickerStyle { public init() {} }
extension DatePickerStyle where Self == GraphicalDatePickerStyle { public static var graphical: GraphicalDatePickerStyle { .init() } }
extension DatePickerStyle where Self == CompactDatePickerStyle { public static var compact: CompactDatePickerStyle { .init() } }
extension DatePickerStyle where Self == WheelDatePickerStyle { public static var wheel: WheelDatePickerStyle { .init() } }

public struct Stepper<Label: View>: View {
    public init(@ViewBuilder label: () -> Label, onIncrement: (() -> Void)?, onDecrement: (() -> Void)?, onEditingChanged: @escaping (Bool) -> Void = { _ in }) {}
    public init<V: Strideable>(value: Binding<V>, in bounds: ClosedRange<V>, step: V.Stride = 1, onEditingChanged: @escaping (Bool) -> Void = { _ in }, @ViewBuilder label: () -> Label) {}
    public init<V: Strideable>(value: Binding<V>, step: V.Stride = 1, onEditingChanged: @escaping (Bool) -> Void = { _ in }, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension Stepper where Label == Text {
    public init<V: Strideable>(_ titleKey: LocalizedStringKey, value: Binding<V>, in bounds: ClosedRange<V>, step: V.Stride = 1, onEditingChanged: @escaping (Bool) -> Void = { _ in }) {}
    @_disfavoredOverload public init<S: StringProtocol, V: Strideable>(_ title: S, value: Binding<V>, in bounds: ClosedRange<V>, step: V.Stride = 1, onEditingChanged: @escaping (Bool) -> Void = { _ in }) {}
    public init(_ titleKey: LocalizedStringKey, onIncrement: (() -> Void)?, onDecrement: (() -> Void)?, onEditingChanged: @escaping (Bool) -> Void = { _ in }) {}
}

public struct Slider<Label: View, ValueLabel: View>: View {
    public var body: Never { fatalError() }
}
extension Slider where Label == EmptyView, ValueLabel == EmptyView {
    public init<V: BinaryFloatingPoint>(value: Binding<V>, in bounds: ClosedRange<V> = 0...1, step: V.Stride = 1, onEditingChanged: @escaping (Bool) -> Void = { _ in }) where V.Stride: BinaryFloatingPoint {}
}

public struct TextField<Label: View>: View {
    public var body: Never { fatalError() }
}
extension TextField where Label == Text {
    public init(_ titleKey: LocalizedStringKey, text: Binding<String>) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>) {}
    public init(_ titleKey: LocalizedStringKey, text: Binding<String>, axis: Axis) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>, axis: Axis) {}
    public init(_ titleKey: LocalizedStringKey, text: Binding<String>, prompt: Text?) {}
    public init(_ titleKey: LocalizedStringKey, text: Binding<String>, prompt: Text?, axis: Axis) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>, prompt: Text?) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>, prompt: Text?, axis: Axis) {}
    public init<F: ParseableFormatStyle>(_ titleKey: LocalizedStringKey, value: Binding<F.FormatInput>, format: F, prompt: Text? = nil) where F.FormatOutput == String {}
    public init<F: ParseableFormatStyle>(_ titleKey: LocalizedStringKey, value: Binding<F.FormatInput?>, format: F, prompt: Text? = nil) where F.FormatOutput == String {}
}
extension TextField {
    public init(text: Binding<String>, prompt: Text? = nil, @ViewBuilder label: () -> Label) {}
    public init(text: Binding<String>, prompt: Text? = nil, axis: Axis, @ViewBuilder label: () -> Label) {}
}
public struct SecureField<Label: View>: View {
    public var body: Never { fatalError() }
}
extension SecureField where Label == Text {
    public init(_ titleKey: LocalizedStringKey, text: Binding<String>) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>) {}
    public init(_ titleKey: LocalizedStringKey, text: Binding<String>, prompt: Text?) {}
}
public struct TextEditor: View {
    public init(text: Binding<String>) {}
    public var body: Never { fatalError() }
}
public protocol TextFieldStyle {}
public struct RoundedBorderTextFieldStyle: TextFieldStyle { public init() {} }
public struct PlainTextFieldStyle: TextFieldStyle { public init() {} }
extension TextFieldStyle where Self == RoundedBorderTextFieldStyle { public static var roundedBorder: RoundedBorderTextFieldStyle { .init() } }
extension TextFieldStyle where Self == PlainTextFieldStyle { public static var plain: PlainTextFieldStyle { .init() } }

public struct SubmitLabel: Sendable {
    public static let done = SubmitLabel(), go = SubmitLabel(), send = SubmitLabel(), join = SubmitLabel(), route = SubmitLabel()
    public static let search = SubmitLabel(), `return` = SubmitLabel(), next = SubmitLabel(), `continue` = SubmitLabel()
}
public struct SubmitTriggers: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let text = SubmitTriggers(rawValue: 1), search = SubmitTriggers(rawValue: 2)
}
public struct TextInputAutocapitalization: Sendable {
    public static let never = TextInputAutocapitalization(), words = TextInputAutocapitalization()
    public static let sentences = TextInputAutocapitalization(), characters = TextInputAutocapitalization()
}
public enum UIKeyboardType: Int, Sendable { case `default`, asciiCapable, numbersAndPunctuation, URL, numberPad, phonePad, namePhonePad, emailAddress, decimalPad, twitter, webSearch, asciiCapableNumberPad }
public struct UITextContentType: Hashable, Sendable, RawRepresentable {
    public var rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let URL = UITextContentType(rawValue: "url"), password = UITextContentType(rawValue: "password")
    public static let username = UITextContentType(rawValue: "username"), name = UITextContentType(rawValue: "name")
    public static let oneTimeCode = UITextContentType(rawValue: "otc"), emailAddress = UITextContentType(rawValue: "email")
    public static let newPassword = UITextContentType(rawValue: "newPassword")
}

public struct Menu<Label: View, Content: View>: View {
    public init(@ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) {}
    public init(@ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label, primaryAction: @escaping () -> Void) {}
    public var body: Never { fatalError() }
}
extension Menu where Label == Text {
    public init(_ titleKey: LocalizedStringKey, @ViewBuilder content: () -> Content) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) {}
}
extension Menu where Label == SwiftUI.Label<Text, Image> {
    public init(_ titleKey: LocalizedStringKey, systemImage: String, @ViewBuilder content: () -> Content) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String, @ViewBuilder content: () -> Content) {}
}
public struct ControlGroup<Content: View>: View {
    public init(@ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}

public struct ProgressView<Label: View, CurrentValueLabel: View>: View {
    public var body: Never { fatalError() }
}
extension ProgressView where Label == EmptyView, CurrentValueLabel == EmptyView {
    public init() {}
    public init<V: BinaryFloatingPoint>(value: V?, total: V = 1.0) {}
}
extension ProgressView where CurrentValueLabel == EmptyView {
    public init(@ViewBuilder label: () -> Label) {}
}
extension ProgressView where Label == Text, CurrentValueLabel == EmptyView {
    public init(_ titleKey: LocalizedStringKey) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S) {}
    public init<V: BinaryFloatingPoint>(_ titleKey: LocalizedStringKey, value: V?, total: V = 1.0) {}
}
public protocol ProgressViewStyle {}
public struct CircularProgressViewStyle: ProgressViewStyle { public init() {}; public init(tint: Color) {} }
public struct LinearProgressViewStyle: ProgressViewStyle { public init() {} }
extension ProgressViewStyle where Self == CircularProgressViewStyle { public static var circular: CircularProgressViewStyle { .init() } }
extension ProgressViewStyle where Self == LinearProgressViewStyle { public static var linear: LinearProgressViewStyle { .init() } }

public struct Gauge<Label: View, CurrentValueLabel: View, BoundsLabel: View, MarkedValueLabels: View>: View {
    public var body: Never { fatalError() }
}
extension Gauge where BoundsLabel == EmptyView, MarkedValueLabels == EmptyView {
    public init<V: BinaryFloatingPoint>(value: V, in bounds: ClosedRange<V> = 0...1, @ViewBuilder label: () -> Label, @ViewBuilder currentValueLabel: () -> CurrentValueLabel) {}
}
extension Gauge where CurrentValueLabel == EmptyView, BoundsLabel == EmptyView, MarkedValueLabels == EmptyView {
    public init<V: BinaryFloatingPoint>(value: V, in bounds: ClosedRange<V> = 0...1, @ViewBuilder label: () -> Label) {}
}
extension Gauge where MarkedValueLabels == EmptyView {
    public init<V: BinaryFloatingPoint>(value: V, in bounds: ClosedRange<V> = 0...1, @ViewBuilder label: () -> Label, @ViewBuilder currentValueLabel: () -> CurrentValueLabel, @ViewBuilder minimumValueLabel: () -> BoundsLabel, @ViewBuilder maximumValueLabel: () -> BoundsLabel) {}
}
public protocol GaugeStyle {}
public struct AccessoryCircularGaugeStyle: GaugeStyle { public init() {} }
public struct AccessoryCircularCapacityGaugeStyle: GaugeStyle { public init() {} }
public struct AccessoryLinearGaugeStyle: GaugeStyle { public init() {} }
public struct AccessoryLinearCapacityGaugeStyle: GaugeStyle { public init() {} }
public struct LinearCapacityGaugeStyle: GaugeStyle { public init() {} }
extension GaugeStyle where Self == AccessoryCircularGaugeStyle { public static var accessoryCircular: AccessoryCircularGaugeStyle { .init() } }
extension GaugeStyle where Self == AccessoryCircularCapacityGaugeStyle { public static var accessoryCircularCapacity: AccessoryCircularCapacityGaugeStyle { .init() } }
extension GaugeStyle where Self == AccessoryLinearGaugeStyle { public static var accessoryLinear: AccessoryLinearGaugeStyle { .init() } }
extension GaugeStyle where Self == AccessoryLinearCapacityGaugeStyle { public static var accessoryLinearCapacity: AccessoryLinearCapacityGaugeStyle { .init() } }
extension GaugeStyle where Self == LinearCapacityGaugeStyle { public static var linearCapacity: LinearCapacityGaugeStyle { .init() } }

public struct Link<Label: View>: View {
    public init(destination: URL, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension Link where Label == Text {
    public init(_ titleKey: LocalizedStringKey, destination: URL) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, destination: URL) {}
}
public struct ShareLink<Label: View>: View {
    public var body: Never { fatalError() }
}
extension ShareLink where Label == SwiftUI.Label<Text, Image> {
    public init(item: URL) {}
    public init(item: String) {}
    public init(_ titleKey: LocalizedStringKey, item: URL) {}
    public init(_ titleKey: LocalizedStringKey, item: String) {}
}

public struct ContentUnavailableView<Label: View, Description: View, Actions: View>: View {
    public init(@ViewBuilder label: () -> Label, @ViewBuilder description: () -> Description = { EmptyView() }, @ViewBuilder actions: () -> Actions = { EmptyView() }) {}
    public var body: Never { fatalError() }
}

public struct TimelineViewDefaultContext {
    public let date: Date
    public enum Cadence: Comparable, Sendable { case live, seconds, minutes }
    public let cadence: Cadence
}
public struct TimelineView<Schedule: TimelineSchedule, Content: View>: View {
    public typealias Context = TimelineViewDefaultContext
    public init(_ schedule: Schedule, @ViewBuilder content: @escaping (TimelineViewDefaultContext) -> Content) {}
    public var body: Never { fatalError() }
}
public protocol TimelineSchedule {}
public struct PeriodicTimelineSchedule: TimelineSchedule {}
public struct EveryMinuteTimelineSchedule: TimelineSchedule {}
public struct AnimationTimelineSchedule: TimelineSchedule {}
extension TimelineSchedule where Self == PeriodicTimelineSchedule {
    public static func periodic(from startDate: Date, by interval: TimeInterval) -> PeriodicTimelineSchedule { .init() }
}
extension TimelineSchedule where Self == EveryMinuteTimelineSchedule { public static var everyMinute: EveryMinuteTimelineSchedule { .init() } }
extension TimelineSchedule where Self == AnimationTimelineSchedule { public static var animation: AnimationTimelineSchedule { .init() } }

// MARK: - Navigation

public struct NavigationPath: Equatable {
    public init() {}
    public var count: Int { 0 }
    public var isEmpty: Bool { true }
    public mutating func append<V: Hashable>(_ value: V) {}
    public mutating func removeLast(_ k: Int = 1) {}
}
public struct NavigationStack<Data, Root: View>: View {
    public var body: Never { fatalError() }
}
extension NavigationStack where Data == NavigationPath {
    public init(@ViewBuilder root: () -> Root) {}
    public init(path: Binding<NavigationPath>, @ViewBuilder root: () -> Root) {}
}
extension NavigationStack where Data: MutableCollection & RandomAccessCollection & RangeReplaceableCollection, Data.Element: Hashable {
    public init(path: Binding<Data>, @ViewBuilder root: () -> Root) {}
}
public struct NavigationLink<Label: View, Destination: View>: View {
    public init(@ViewBuilder destination: () -> Destination, @ViewBuilder label: () -> Label) {}
    public init(destination: Destination, @ViewBuilder label: () -> Label) {}
    public var body: Never { fatalError() }
}
extension NavigationLink where Destination == Never {
    public init<P: Hashable>(value: P?, @ViewBuilder label: () -> Label) {}
}
extension NavigationLink where Label == Text, Destination == Never {
    public init<P: Hashable>(_ titleKey: LocalizedStringKey, value: P?) {}
    @_disfavoredOverload public init<S: StringProtocol, P: Hashable>(_ title: S, value: P?) {}
}
extension NavigationLink where Label == Text {
    public init(_ titleKey: LocalizedStringKey, @ViewBuilder destination: () -> Destination) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder destination: () -> Destination) {}
}

public struct TabView<SelectionValue: Hashable, Content: View>: View {
    public init(selection: Binding<SelectionValue>?, @ViewBuilder content: () -> Content) {}
    public var body: Never { fatalError() }
}
extension TabView where SelectionValue == Int {
    public init(@ViewBuilder content: () -> Content) {}
}
public protocol TabViewStyle {}
public struct PageTabViewStyle: TabViewStyle {
    public enum IndexDisplayMode: Sendable { case automatic, always, never }
    public init(indexDisplayMode: IndexDisplayMode = .automatic) {}
}
extension TabViewStyle where Self == PageTabViewStyle {
    public static var page: PageTabViewStyle { .init() }
    public static func page(indexDisplayMode: PageTabViewStyle.IndexDisplayMode) -> PageTabViewStyle { .init() }
}

public struct ToolbarItemPlacement: Sendable {
    public static let automatic = ToolbarItemPlacement(), principal = ToolbarItemPlacement(), status = ToolbarItemPlacement()
    public static let primaryAction = ToolbarItemPlacement(), secondaryAction = ToolbarItemPlacement()
    public static let confirmationAction = ToolbarItemPlacement(), cancellationAction = ToolbarItemPlacement(), destructiveAction = ToolbarItemPlacement()
    public static let navigation = ToolbarItemPlacement(), topBarLeading = ToolbarItemPlacement(), topBarTrailing = ToolbarItemPlacement()
    public static let navigationBarLeading = ToolbarItemPlacement(), navigationBarTrailing = ToolbarItemPlacement()
    public static let bottomBar = ToolbarItemPlacement(), keyboard = ToolbarItemPlacement()
}
public protocol ToolbarContent {}
public protocol CustomizableToolbarContent: ToolbarContent {}
public struct ToolbarItem<ID, Content: View>: CustomizableToolbarContent {
    public init(placement: ToolbarItemPlacement = .automatic, @ViewBuilder content: () -> Content) where ID == () {}
}
public struct ToolbarItemGroup<Content: View>: ToolbarContent {
    public init(placement: ToolbarItemPlacement = .automatic, @ViewBuilder content: () -> Content) {}
}
public struct ToolbarSpacer: ToolbarContent {}
@resultBuilder public struct ToolbarContentBuilder {
    public static func buildExpression<Content: ToolbarContent>(_ content: Content) -> Content { content }
    public static func buildBlock<Content: ToolbarContent>(_ content: Content) -> Content { content }
    public static func buildBlock<C0: ToolbarContent, C1: ToolbarContent>(_ c0: C0, _ c1: C1) -> _TupleToolbar { _TupleToolbar() }
    public static func buildBlock<C0: ToolbarContent, C1: ToolbarContent, C2: ToolbarContent>(_ c0: C0, _ c1: C1, _ c2: C2) -> _TupleToolbar { _TupleToolbar() }
    public static func buildBlock<C0: ToolbarContent, C1: ToolbarContent, C2: ToolbarContent, C3: ToolbarContent>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3) -> _TupleToolbar { _TupleToolbar() }
    public static func buildIf<Content: ToolbarContent>(_ content: Content?) -> Content? { content }
    public static func buildEither<T: ToolbarContent, F: ToolbarContent>(first: T) -> _CondToolbar<T, F> { .init() }
    public static func buildEither<T: ToolbarContent, F: ToolbarContent>(second: F) -> _CondToolbar<T, F> { .init() }
}
extension Optional: ToolbarContent where Wrapped: ToolbarContent {}
public struct _TupleToolbar: ToolbarContent {}
public struct _CondToolbar<T, F>: ToolbarContent {}
public enum Visibility: Hashable, CaseIterable, Sendable { case automatic, visible, hidden }
public struct ToolbarPlacement: Sendable {
    public static let automatic = ToolbarPlacement(), navigationBar = ToolbarPlacement(), tabBar = ToolbarPlacement(), bottomBar = ToolbarPlacement()
}
public struct ToolbarRole: Sendable { public static let automatic = ToolbarRole(), navigationStack = ToolbarRole(), editor = ToolbarRole(), browser = ToolbarRole() }

public enum NavigationBarItem {
    public enum TitleDisplayMode: Sendable { case automatic, inline, large }
}

public struct SearchFieldPlacement: Sendable {
    public static let automatic = SearchFieldPlacement(), toolbar = SearchFieldPlacement(), sidebar = SearchFieldPlacement()
    public static func navigationBarDrawer(displayMode: NavigationBarDrawerDisplayMode) -> SearchFieldPlacement { .init() }
    public static let navigationBarDrawer = SearchFieldPlacement()
    public enum NavigationBarDrawerDisplayMode: Sendable { case automatic, always }
}

public struct PresentationDetent: Hashable, Sendable {
    public static let medium = PresentationDetent(), large = PresentationDetent()
    public static func height(_ height: CGFloat) -> PresentationDetent { .init() }
    public static func fraction(_ fraction: CGFloat) -> PresentationDetent { .init() }
}

// MARK: - Property wrappers & data flow

@propertyWrapper @frozen
public struct State<Value>: DynamicProperty {
    public init(wrappedValue value: Value) {}
    public init(initialValue value: Value) {}
    public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
    public var projectedValue: Binding<Value> { fatalError() }
}
extension State where Value: ExpressibleByNilLiteral {
    public init() {}
}

@propertyWrapper @dynamicMemberLookup
public struct Binding<Value>: DynamicProperty {
    public init(get: @escaping () -> Value, set: @escaping (Value) -> Void) {}
    public init(get: @escaping () -> Value, set: @escaping (Value, Transaction) -> Void) {}
    public init(projectedValue: Binding<Value>) {}
    public init<V>(_ base: Binding<V>) where Value == V? {}
    public init?(_ base: Binding<Value?>) {}
    public init<V: Hashable>(_ base: Binding<V>) where Value == AnyHashable {}
    public static func constant(_ value: Value) -> Binding<Value> { fatalError() }
    public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
    public var projectedValue: Binding<Value> { self }
    public var transaction: Transaction { get { Transaction() } set {} }
    public subscript<Subject>(dynamicMember keyPath: WritableKeyPath<Value, Subject>) -> Binding<Subject> { fatalError() }
    public func animation(_ animation: Animation? = .default) -> Binding<Value> { self }
    public func transaction(_ transaction: Transaction) -> Binding<Value> { self }
}
extension Binding: @unchecked Sendable where Value: Sendable {}
extension Binding: Identifiable where Value: Identifiable {
    public var id: Value.ID { fatalError() }
}
extension Binding: Sequence where Value: MutableCollection {
    public typealias Element = Binding<Value.Element>
    public typealias Iterator = IndexingIterator<Binding<Value>>
    public typealias SubSequence = Slice<Binding<Value>>
}
extension Binding: Collection where Value: MutableCollection {
    public typealias Index = Value.Index
    public typealias Indices = Value.Indices
    public var startIndex: Index { fatalError() }
    public var endIndex: Index { fatalError() }
    public var indices: Value.Indices { fatalError() }
    public func index(after i: Index) -> Index { fatalError() }
    public subscript(position: Index) -> Binding<Value.Element> { fatalError() }
}
extension Binding: BidirectionalCollection where Value: BidirectionalCollection & MutableCollection {
    public func index(before i: Index) -> Index { fatalError() }
}
extension Binding: RandomAccessCollection where Value: MutableCollection & RandomAccessCollection {}

@propertyWrapper
public struct Environment<Value>: DynamicProperty {
    public init(_ keyPath: KeyPath<EnvironmentValues, Value>) {}
    public init(_ objectType: Value.Type) where Value: AnyObject & Observable {}
    public init<T: AnyObject & Observable>(_ objectType: T.Type) where Value == T? {}
    public var wrappedValue: Value { fatalError() }
}

@propertyWrapper @dynamicMemberLookup
public struct Bindable<Value>: DynamicProperty {
    public init(wrappedValue: Value) where Value: AnyObject & Observable {}
    public init(_ wrappedValue: Value) where Value: AnyObject & Observable {}
    public init(projectedValue: Bindable<Value>) {}
    public var wrappedValue: Value { get { fatalError() } set {} }
    public var projectedValue: Bindable<Value> { self }
    public subscript<Subject>(dynamicMember keyPath: ReferenceWritableKeyPath<Value, Subject>) -> Binding<Subject> where Value: AnyObject { fatalError() }
}

@propertyWrapper
public struct StateObject<ObjectType: ObservableObject>: DynamicProperty {
    public init(wrappedValue thunk: @autoclosure @escaping () -> ObjectType) {}
    public var wrappedValue: ObjectType { fatalError() }
    public var projectedValue: ObservedObject<ObjectType>.Wrapper { fatalError() }
}
@propertyWrapper
public struct ObservedObject<ObjectType: ObservableObject>: DynamicProperty {
    @dynamicMemberLookup public struct Wrapper {
        public subscript<Subject>(dynamicMember keyPath: ReferenceWritableKeyPath<ObjectType, Subject>) -> Binding<Subject> { fatalError() }
    }
    public init(wrappedValue: ObjectType) { self.wrappedValue = wrappedValue }
    public init(initialValue: ObjectType) { self.wrappedValue = initialValue }
    public var wrappedValue: ObjectType
    public var projectedValue: Wrapper { fatalError() }
}
@propertyWrapper
public struct EnvironmentObject<ObjectType: ObservableObject>: DynamicProperty {
    public init() {}
    public var wrappedValue: ObjectType { fatalError() }
}

@propertyWrapper
public struct AppStorage<Value>: DynamicProperty {
    public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == Bool {}
    public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == Int {}
    public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == Double {}
    public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == String {}
    public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value: RawRepresentable, Value.RawValue == String {}
    public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
    public var projectedValue: Binding<Value> { fatalError() }
}
@propertyWrapper
public struct SceneStorage<Value>: DynamicProperty {
    public init(wrappedValue: Value, _ key: String) where Value == String {}
    public init(wrappedValue: Value, _ key: String) where Value == Bool {}
    public init(wrappedValue: Value, _ key: String) where Value: RawRepresentable, Value.RawValue == String {}
    public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
    public var projectedValue: Binding<Value> { fatalError() }
}

@propertyWrapper
public struct FocusState<Value: Hashable>: DynamicProperty {
    @propertyWrapper public struct Binding {
        public init(wrappedValue: Value) {}
        public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
        public var projectedValue: Binding { self }
    }
    public init() where Value == Bool {}
    public init<T: Hashable>() where Value == T? {}
    public var wrappedValue: Value { get { fatalError() } nonmutating set {} }
    public var projectedValue: Binding { fatalError() }
}

@propertyWrapper
public struct Namespace: DynamicProperty {
    public init() {}
    public struct ID: Hashable, Sendable {}
    public var wrappedValue: ID { ID() }
}

@propertyWrapper
public struct ScaledMetric<Value: BinaryFloatingPoint>: DynamicProperty {
    public init(wrappedValue: Value) {}
    public init(wrappedValue: Value, relativeTo textStyle: Font.TextStyle) {}
    public var wrappedValue: Value { fatalError() }
}

@propertyWrapper
public struct GestureState<Value>: DynamicProperty {
    public init(wrappedValue: Value) {}
    public var wrappedValue: Value { fatalError() }
    public var projectedValue: GestureState<Value> { self }
}

// MARK: - Environment

public protocol EnvironmentKey {
    associatedtype Value
    static var defaultValue: Value { get }
}

public struct DismissAction { @MainActor public func callAsFunction() {} }
public struct DismissSearchAction { @MainActor public func callAsFunction() {} }
public struct OpenURLAction {
    public struct Result: Sendable {
        public static let handled = Result(), discarded = Result(), systemAction = Result()
        public static func systemAction(_ url: URL) -> Result { Result() }
    }
    public init(handler: @escaping (URL) -> Result) {}
    @MainActor public func callAsFunction(_ url: URL) {}
    @MainActor public func callAsFunction(_ url: URL, completion: @escaping (Bool) -> Void) {}
}
public struct RefreshAction { public func callAsFunction() async {} }
public enum UserInterfaceSizeClass: Hashable, Sendable { case compact, regular }
public struct RedactionReasons: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let placeholder = RedactionReasons(rawValue: 1), privacy = RedactionReasons(rawValue: 2), invalidated = RedactionReasons(rawValue: 4)
}
public enum EditMode: Hashable, Sendable { case inactive, transient, active }
public enum LayoutDirection: Hashable, CaseIterable, Sendable { case leftToRight, rightToLeft }

public struct EnvironmentValues: CustomStringConvertible {
    public init() {}
    public subscript<K: EnvironmentKey>(key: K.Type) -> K.Value { get { K.defaultValue } set {} }
    public var description: String { "" }
    public var colorScheme: ColorScheme { get { .light } set {} }
    public var colorSchemeContrast: ColorSchemeContrast { .standard }
    public var dismiss: DismissAction { DismissAction() }
    public var dismissSearch: DismissSearchAction { DismissSearchAction() }
    public var isSearching: Bool { false }
    public var openURL: OpenURLAction { get { OpenURLAction(handler: { _ in .handled }) } set {} }
    public var refresh: RefreshAction? { nil }
    public var accessibilityReduceMotion: Bool { false }
    public var accessibilityReduceTransparency: Bool { false }
    public var accessibilityDifferentiateWithoutColor: Bool { false }
    public var accessibilityVoiceOverEnabled: Bool { false }
    public var accessibilityEnabled: Bool { false }
    public var dynamicTypeSize: DynamicTypeSize { get { .large } set {} }
    public var horizontalSizeClass: UserInterfaceSizeClass? { get { nil } set {} }
    public var verticalSizeClass: UserInterfaceSizeClass? { get { nil } set {} }
    public var scenePhase: ScenePhase { get { .active } set {} }
    public var redactionReasons: RedactionReasons { get { [] } set {} }
    public var isLuminanceReduced: Bool { get { false } set {} }
    public var locale: Locale { get { Locale(identifier: "en") } set {} }
    public var calendar: Calendar { get { Calendar.current } set {} }
    public var timeZone: TimeZone { get { TimeZone.current } set {} }
    public var isEnabled: Bool { get { true } set {} }
    public var displayScale: CGFloat { get { 2 } set {} }
    public var editMode: Binding<EditMode>? { get { nil } set {} }
    public var layoutDirection: LayoutDirection { get { .leftToRight } set {} }
    public var font: Font? { get { nil } set {} }
    public var legibilityWeight: LegibilityWeight? { get { nil } set {} }
}

// MARK: - Gestures

public protocol Gesture<Value> {
    associatedtype Value
}
public struct TapGesture: Gesture {
    public typealias Value = Void
    public init(count: Int = 1) {}
}
public struct LongPressGesture: Gesture {
    public typealias Value = Bool
    public init(minimumDuration: Double = 0.5, maximumDistance: CGFloat = 10) {}
}
public struct DragGesture: Gesture {
    public struct Value: Equatable, Sendable {
        public var time: Date { Date() }
        public var location: CGPoint { .zero }
        public var startLocation: CGPoint { .zero }
        public var translation: CGSize { .zero }
        public var velocity: CGSize { .zero }
        public var predictedEndLocation: CGPoint { .zero }
        public var predictedEndTranslation: CGSize { .zero }
    }
    public init(minimumDistance: CGFloat = 10, coordinateSpace: CoordinateSpace = .local) {}
}
public struct _EndedGesture<G: Gesture>: Gesture { public typealias Value = G.Value }
public struct _ChangedGesture<G: Gesture>: Gesture { public typealias Value = G.Value }
extension Gesture {
    public func onEnded(_ action: @escaping (Value) -> Void) -> _EndedGesture<Self> { .init() }
    public func onChanged(_ action: @escaping (Value) -> Void) -> _ChangedGesture<Self> where Value: Equatable { .init() }
}
public struct GestureMask: OptionSet, Sendable {
    public let rawValue: UInt32
    public init(rawValue: UInt32) { self.rawValue = rawValue }
    public static let none = GestureMask([]), gesture = GestureMask(rawValue: 1), subviews = GestureMask(rawValue: 2), all = GestureMask(rawValue: 3)
}

// MARK: - Accessibility values

public struct AccessibilityTraits: SetAlgebra, Sendable {
    public init() {}
    public static let isButton = AccessibilityTraits(), isHeader = AccessibilityTraits(), isSelected = AccessibilityTraits()
    public static let isLink = AccessibilityTraits(), isSummaryElement = AccessibilityTraits(), isImage = AccessibilityTraits()
    public static let isStaticText = AccessibilityTraits(), updatesFrequently = AccessibilityTraits(), isToggle = AccessibilityTraits()
    public static let allowsDirectInteraction = AccessibilityTraits(), startsMediaSession = AccessibilityTraits(), isModal = AccessibilityTraits()
    public static let isSearchField = AccessibilityTraits(), playsSound = AccessibilityTraits(), isKeyboardKey = AccessibilityTraits(), causesPageTurn = AccessibilityTraits()
    public func union(_ other: Self) -> Self { self }
    public func intersection(_ other: Self) -> Self { self }
    public func symmetricDifference(_ other: Self) -> Self { self }
    public func contains(_ member: Self) -> Bool { false }
    public mutating func insert(_ newMember: Self) -> (inserted: Bool, memberAfterInsert: Self) { (true, newMember) }
    public mutating func remove(_ member: Self) -> Self? { nil }
    public mutating func update(with newMember: Self) -> Self? { nil }
    public mutating func formUnion(_ other: Self) {}
    public mutating func formIntersection(_ other: Self) {}
    public mutating func formSymmetricDifference(_ other: Self) {}
    public static func == (a: Self, b: Self) -> Bool { true }
}
public struct AccessibilityChildBehavior: Hashable, Sendable {
    public static let ignore = AccessibilityChildBehavior(), contain = AccessibilityChildBehavior(), combine = AccessibilityChildBehavior()
}
public enum AccessibilityAdjustmentDirection: Sendable { case increment, decrement }
public struct AccessibilityActionKind: Equatable, Sendable {
    public static let `default` = AccessibilityActionKind(), escape = AccessibilityActionKind(), magicTap = AccessibilityActionKind()
    public init(named name: Text) {}
    init() {}
}

public struct SensoryFeedback: Equatable, Sendable {
    public static let success = SensoryFeedback(), warning = SensoryFeedback(), error = SensoryFeedback(), selection = SensoryFeedback()
    public static let increase = SensoryFeedback(), decrease = SensoryFeedback(), start = SensoryFeedback(), stop = SensoryFeedback()
    public static let alignment = SensoryFeedback(), levelChange = SensoryFeedback(), impact = SensoryFeedback()
    public enum Weight: Sendable { case light, medium, heavy }
    public enum Flexibility: Sendable { case rigid, solid, soft }
    public static func impact(weight: Weight = .medium, intensity: Double = 1.0) -> SensoryFeedback { .init() }
    public static func impact(flexibility: Flexibility, intensity: Double = 1.0) -> SensoryFeedback { .init() }
}

// MARK: - Drag & drop (Transferable)

public protocol Transferable {}
extension String: Transferable {}
extension URL: Transferable {}
extension Data: Transferable {}

// MARK: - Symbol effects

public protocol SymbolEffect {}
public protocol DiscreteSymbolEffect: SymbolEffect {}
public protocol IndefiniteSymbolEffect: SymbolEffect {}
public struct BounceSymbolEffect: DiscreteSymbolEffect, IndefiniteSymbolEffect { public var up: BounceSymbolEffect { self }; public var down: BounceSymbolEffect { self }; public var byLayer: BounceSymbolEffect { self } }
public struct PulseSymbolEffect: DiscreteSymbolEffect, IndefiniteSymbolEffect { public var byLayer: PulseSymbolEffect { self } }
public struct VariableColorSymbolEffect: DiscreteSymbolEffect, IndefiniteSymbolEffect { public var iterative: VariableColorSymbolEffect { self } }
public struct ScaleSymbolEffect: IndefiniteSymbolEffect { public var up: ScaleSymbolEffect { self } }
public protocol ContentTransitionSymbolEffect {}
public struct ReplaceSymbolEffect: ContentTransitionSymbolEffect, SymbolEffect { public var downUp: ReplaceSymbolEffect { self }; public var upUp: ReplaceSymbolEffect { self }; public var offUp: ReplaceSymbolEffect { self }; public var byLayer: ReplaceSymbolEffect { self }; public var wholeSymbol: ReplaceSymbolEffect { self } }
extension SymbolEffect where Self == ReplaceSymbolEffect { public static var replace: ReplaceSymbolEffect { .init() } }
extension SymbolEffect where Self == BounceSymbolEffect { public static var bounce: BounceSymbolEffect { .init() } }
extension SymbolEffect where Self == PulseSymbolEffect { public static var pulse: PulseSymbolEffect { .init() } }
extension SymbolEffect where Self == VariableColorSymbolEffect { public static var variableColor: VariableColorSymbolEffect { .init() } }
extension SymbolEffect where Self == ScaleSymbolEffect { public static var scale: ScaleSymbolEffect { .init() } }
public struct SymbolEffectOptions: Sendable {
    public static let `default` = SymbolEffectOptions(), nonRepeating = SymbolEffectOptions()
    public static func `repeat`(_ count: Int) -> SymbolEffectOptions { .init() }
    public static func speed(_ speed: Double) -> SymbolEffectOptions { .init() }
}

// MARK: - iOS 18 navigation transitions (zoom)

@available(iOS 18.0, *)
public protocol NavigationTransition {}
@available(iOS 18.0, *)
public struct ZoomNavigationTransition: NavigationTransition {}
@available(iOS 18.0, *)
public struct AutomaticNavigationTransition: NavigationTransition {}
@available(iOS 18.0, *)
extension NavigationTransition where Self == ZoomNavigationTransition {
    public static func zoom<ID: Hashable>(sourceID: ID, in namespace: Namespace.ID) -> ZoomNavigationTransition { .init() }
}
@available(iOS 18.0, *)
extension NavigationTransition where Self == AutomaticNavigationTransition {
    public static var automatic: AutomaticNavigationTransition { .init() }
}

// MARK: - Previews (only used by the #Preview rewrite in typecheck-stubs.sh)

@MainActor public func __previewView<V: View>(_ name: String? = nil, @ViewBuilder body: () -> V) {}

// MARK: - View modifiers

extension View {
    // Text & font
    public func font(_ font: Font?) -> some View { _m }
    public func fontWeight(_ weight: Font.Weight?) -> some View { _m }
    public func fontDesign(_ design: Font.Design?) -> some View { _m }
    public func fontWidth(_ width: Font.Width?) -> some View { _m }
    public func bold(_ isActive: Bool = true) -> some View { _m }
    public func italic(_ isActive: Bool = true) -> some View { _m }
    public func monospacedDigit() -> some View { _m }
    public func monospaced(_ isActive: Bool = true) -> some View { _m }
    public func strikethrough(_ isActive: Bool = true, pattern: Text.LineStyle.Pattern = .solid, color: Color? = nil) -> some View { _m }
    public func underline(_ isActive: Bool = true, pattern: Text.LineStyle.Pattern = .solid, color: Color? = nil) -> some View { _m }
    public func kerning(_ kerning: CGFloat) -> some View { _m }
    public func tracking(_ tracking: CGFloat) -> some View { _m }
    public func baselineOffset(_ baselineOffset: CGFloat) -> some View { _m }
    public func lineLimit(_ number: Int?) -> some View { _m }
    public func lineLimit(_ limit: ClosedRange<Int>) -> some View { _m }
    public func lineLimit(_ limit: PartialRangeFrom<Int>) -> some View { _m }
    public func lineLimit(_ limit: PartialRangeThrough<Int>) -> some View { _m }
    public func lineLimit(_ limit: Int, reservesSpace: Bool) -> some View { _m }
    public func lineSpacing(_ lineSpacing: CGFloat) -> some View { _m }
    public func multilineTextAlignment(_ alignment: TextAlignment) -> some View { _m }
    public func minimumScaleFactor(_ factor: CGFloat) -> some View { _m }
    public func truncationMode(_ mode: Text.TruncationMode) -> some View { _m }
    public func textCase(_ textCase: Text.Case?) -> some View { _m }
    public func allowsTightening(_ flag: Bool) -> some View { _m }
    public func textSelection<S: TextSelectability>(_ selectability: S) -> some View { _m }
    public func dynamicTypeSize(_ size: DynamicTypeSize) -> some View { _m }
    public func dynamicTypeSize<T: RangeExpression>(_ range: T) -> some View where T.Bound == DynamicTypeSize { _m }
    public func privacySensitive(_ sensitive: Bool = true) -> some View { _m }
    public func redacted(reason: RedactionReasons) -> some View { _m }
    public func unredacted() -> some View { _m }

    // Colour & style
    public func foregroundStyle<S: ShapeStyle>(_ style: S) -> some View { _m }
    public func foregroundStyle<S1: ShapeStyle, S2: ShapeStyle>(_ primary: S1, _ secondary: S2) -> some View { _m }
    public func foregroundStyle<S1: ShapeStyle, S2: ShapeStyle, S3: ShapeStyle>(_ primary: S1, _ secondary: S2, _ tertiary: S3) -> some View { _m }
    public func foregroundColor(_ color: Color?) -> some View { _m }
    public func tint<S: ShapeStyle>(_ tint: S?) -> some View { _m }
    public func tint(_ tint: Color?) -> some View { _m }
    public func accentColor(_ accentColor: Color?) -> some View { _m }
    public func preferredColorScheme(_ colorScheme: ColorScheme?) -> some View { _m }
    public func symbolRenderingMode(_ mode: SymbolRenderingMode?) -> some View { _m }
    public func symbolVariant(_ variant: SymbolVariants) -> some View { _m }
    public func imageScale(_ scale: Image.Scale) -> some View { _m }
    public func opacity(_ opacity: Double) -> some View { _m }
    public func brightness(_ amount: Double) -> some View { _m }
    public func saturation(_ amount: Double) -> some View { _m }
    public func grayscale(_ amount: Double) -> some View { _m }
    public func blur(radius: CGFloat, opaque: Bool = false) -> some View { _m }
    public func shadow(color: Color = Color(.sRGBLinear, white: 0, opacity: 0.33), radius: CGFloat, x: CGFloat = 0, y: CGFloat = 0) -> some View { _m }
    public func colorMultiply(_ color: Color) -> some View { _m }
    public func blendMode(_ blendMode: BlendMode) -> some View { _m }
    public func compositingGroup() -> some View { _m }
    public func drawingGroup(opaque: Bool = false, colorMode: ColorRenderingMode = .nonLinear) -> some View { _m }

    // Background, overlay, clipping
    public func background<V: View>(alignment: Alignment = .center, @ViewBuilder content: () -> V) -> some View { _m }
    @_disfavoredOverload public func background<V: View>(_ background: V, alignment: Alignment = .center) -> some View { _m }  // soft-deprecated in the SDK
    public func background(ignoresSafeAreaEdges edges: Edge.Set = .all) -> some View { _m }
    public func background<S: ShapeStyle>(_ style: S, ignoresSafeAreaEdges edges: Edge.Set = .all) -> some View { _m }
    public func background<S: ShapeStyle, T: Shape>(_ style: S, in shape: T, fillStyle: FillStyle = FillStyle()) -> some View { _m }
    public func background<S: Shape>(in shape: S, fillStyle: FillStyle = FillStyle()) -> some View { _m }
    public func overlay<V: View>(alignment: Alignment = .center, @ViewBuilder content: () -> V) -> some View { _m }
    @_disfavoredOverload public func overlay<V: View>(_ overlay: V, alignment: Alignment = .center) -> some View { _m }  // soft-deprecated in the SDK
    public func overlay<S: ShapeStyle>(_ style: S, ignoresSafeAreaEdges edges: Edge.Set = .all) -> some View { _m }
    public func overlay<S: ShapeStyle, T: Shape>(_ style: S, in shape: T, fillStyle: FillStyle = FillStyle()) -> some View { _m }
    public func border<S: ShapeStyle>(_ content: S, width: CGFloat = 1) -> some View { _m }
    public func clipShape<S: Shape>(_ shape: S, style: FillStyle = FillStyle()) -> some View { _m }
    public func clipped(antialiased: Bool = false) -> some View { _m }
    public func cornerRadius(_ radius: CGFloat, antialiased: Bool = true) -> some View { _m }
    public func mask<Mask: View>(alignment: Alignment = .center, @ViewBuilder _ mask: () -> Mask) -> some View { _m }
    public func contentShape<S: Shape>(_ shape: S, eoFill: Bool = false) -> some View { _m }
    public func contentShape<S: Shape>(_ kind: ContentShapeKinds, _ shape: S, eoFill: Bool = false) -> some View { _m }
    public func containerShape<T: InsettableShape>(_ shape: T) -> some View { _m }
    public func hidden() -> some View { _m }

    // Layout
    public func frame(width: CGFloat? = nil, height: CGFloat? = nil, alignment: Alignment = .center) -> some View { _m }
    public func frame(minWidth: CGFloat? = nil, idealWidth: CGFloat? = nil, maxWidth: CGFloat? = nil, minHeight: CGFloat? = nil, idealHeight: CGFloat? = nil, maxHeight: CGFloat? = nil, alignment: Alignment = .center) -> some View { _m }
    public func padding(_ insets: EdgeInsets) -> some View { _m }
    public func padding(_ edges: Edge.Set = .all, _ length: CGFloat? = nil) -> some View { _m }
    public func padding(_ length: CGFloat) -> some View { _m }
    public func fixedSize() -> some View { _m }
    public func fixedSize(horizontal: Bool, vertical: Bool) -> some View { _m }
    public func layoutPriority(_ value: Double) -> some View { _m }
    public func offset(_ offset: CGSize) -> some View { _m }
    public func offset(x: CGFloat = 0, y: CGFloat = 0) -> some View { _m }
    public func position(x: CGFloat = 0, y: CGFloat = 0) -> some View { _m }
    public func position(_ position: CGPoint) -> some View { _m }
    public func scaleEffect(_ scale: CGFloat, anchor: UnitPoint = .center) -> some View { _m }
    public func scaleEffect(x: CGFloat = 1.0, y: CGFloat = 1.0, anchor: UnitPoint = .center) -> some View { _m }
    public func scaleEffect(_ scale: CGSize, anchor: UnitPoint = .center) -> some View { _m }
    public func rotationEffect(_ angle: Angle, anchor: UnitPoint = .center) -> some View { _m }
    public func aspectRatio(_ aspectRatio: CGFloat? = nil, contentMode: ContentMode) -> some View { _m }
    public func scaledToFit() -> some View { _m }
    public func scaledToFill() -> some View { _m }
    public func alignmentGuide(_ g: HorizontalAlignment, computeValue: @escaping (ViewDimensions) -> CGFloat) -> some View { _m }
    public func alignmentGuide(_ g: VerticalAlignment, computeValue: @escaping (ViewDimensions) -> CGFloat) -> some View { _m }
    public func ignoresSafeArea(_ regions: SafeAreaRegions = .all, edges: Edge.Set = .all) -> some View { _m }
    public func safeAreaInset<V: View>(edge: VerticalEdge, alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> V) -> some View { _m }
    public func safeAreaInset<V: View>(edge: HorizontalEdge, alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> V) -> some View { _m }
    public func safeAreaPadding(_ edges: Edge.Set = .all, _ length: CGFloat? = nil) -> some View { _m }
    public func containerRelativeFrame(_ axes: Axis.Set, alignment: Alignment = .center) -> some View { _m }
    public func containerRelativeFrame(_ axes: Axis.Set, count: Int, span: Int = 1, spacing: CGFloat, alignment: Alignment = .center) -> some View { _m }
    public func gridCellColumns(_ count: Int) -> some View { _m }
    public func zIndex(_ value: Double) -> some View { _m }
    public func id<ID: Hashable>(_ id: ID) -> some View { _m }
    public func tag<V: Hashable>(_ tag: V) -> some View { _m }
    public func tag<V: Hashable>(_ tag: V, includeOptional: Bool = true) -> some View { _m }
    public func equatable() -> some View { _m }

    // Interaction
    public func disabled(_ disabled: Bool) -> some View { _m }
    public func allowsHitTesting(_ enabled: Bool) -> some View { _m }
    public func onTapGesture(count: Int = 1, perform action: @escaping () -> Void) -> some View { _m }
    public func onLongPressGesture(minimumDuration: Double = 0.5, maximumDistance: CGFloat = 10, perform action: @escaping () -> Void, onPressingChanged: ((Bool) -> Void)? = nil) -> some View { _m }
    public func gesture<T: Gesture>(_ gesture: T, including mask: GestureMask = .all) -> some View { _m }
    public func simultaneousGesture<T: Gesture>(_ gesture: T, including mask: GestureMask = .all) -> some View { _m }
    public func highPriorityGesture<T: Gesture>(_ gesture: T, including mask: GestureMask = .all) -> some View { _m }
    public func buttonStyle<S: PrimitiveButtonStyle>(_ style: S) -> some View { _m }
    public func buttonStyle<S: ButtonStyle>(_ style: S) -> some View { _m }
    public func buttonBorderShape(_ shape: ButtonBorderShape) -> some View { _m }
    public func controlSize(_ controlSize: ControlSize) -> some View { _m }
    public func toggleStyle<S: ToggleStyle>(_ style: S) -> some View { _m }
    public func pickerStyle<S: PickerStyle>(_ style: S) -> some View { _m }
    public func datePickerStyle<S: DatePickerStyle>(_ style: S) -> some View { _m }
    public func progressViewStyle<S: ProgressViewStyle>(_ style: S) -> some View { _m }
    public func gaugeStyle<S: GaugeStyle>(_ style: S) -> some View { _m }
    public func textFieldStyle<S: TextFieldStyle>(_ style: S) -> some View { _m }
    public func tabViewStyle<S: TabViewStyle>(_ style: S) -> some View { _m }
    public func labelsHidden() -> some View { _m }
    public func labelStyle<S: LabelStyle>(_ style: S) -> some View { _m }
    public func menuStyle<S: MenuStyle>(_ style: S) -> some View { _m }
    public func menuOrder(_ order: MenuOrder) -> some View { _m }
    public func sensoryFeedback<T: Equatable>(_ feedback: SensoryFeedback, trigger: T) -> some View { _m }
    public func sensoryFeedback<T: Equatable>(_ feedback: SensoryFeedback, trigger: T, condition: @escaping (T, T) -> Bool) -> some View { _m }
    public func sensoryFeedback<T: Equatable>(trigger: T, _ feedback: @escaping (T, T) -> SensoryFeedback?) -> some View { _m }
    public func contextMenu<MenuItems: View>(@ViewBuilder menuItems: () -> MenuItems) -> some View { _m }
    public func contextMenu<M: View, P: View>(@ViewBuilder menuItems: () -> M, @ViewBuilder preview: () -> P) -> some View { _m }
    public func swipeActions<T: View>(edge: HorizontalEdge = .trailing, allowsFullSwipe: Bool = true, @ViewBuilder content: () -> T) -> some View { _m }
    public func draggable<T: Transferable>(_ payload: @autoclosure @escaping () -> T) -> some View { _m }
    public func draggable<V: View, T: Transferable>(_ payload: @autoclosure @escaping () -> T, @ViewBuilder preview: () -> V) -> some View { _m }
    public func dropDestination<T: Transferable>(for payloadType: T.Type = T.self, action: @escaping (_ items: [T], _ location: CGPoint) -> Bool, isTargeted: @escaping (Bool) -> Void = { _ in }) -> some View { _m }
    public func focused(_ condition: FocusState<Bool>.Binding) -> some View { _m }
    public func focused<Value: Hashable>(_ binding: FocusState<Value>.Binding, equals value: Value) -> some View { _m }
    public func submitLabel(_ submitLabel: SubmitLabel) -> some View { _m }
    public func onSubmit(of triggers: SubmitTriggers = .text, _ action: @escaping () -> Void) -> some View { _m }
    public func textInputAutocapitalization(_ autocapitalization: TextInputAutocapitalization?) -> some View { _m }
    public func autocorrectionDisabled(_ disable: Bool = true) -> some View { _m }
    public func keyboardType(_ type: UIKeyboardType) -> some View { _m }
    public func textContentType(_ textContentType: UITextContentType?) -> some View { _m }
    public func scrollDismissesKeyboard(_ mode: ScrollDismissesKeyboardMode) -> some View { _m }

    // Lifecycle & events
    public func onAppear(perform action: (() -> Void)? = nil) -> some View { _m }
    public func onDisappear(perform action: (() -> Void)? = nil) -> some View { _m }
    public func task(priority: TaskPriority = .userInitiated, @_inheritActorContext _ action: @escaping @Sendable () async -> Void) -> some View { _m }
    public func task<T: Equatable>(id value: T, priority: TaskPriority = .userInitiated, @_inheritActorContext _ action: @escaping @Sendable () async -> Void) -> some View { _m }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping (_ oldValue: V, _ newValue: V) -> Void) -> some View { _m }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping () -> Void) -> some View { _m }
    public func onReceive<P: Publisher>(_ publisher: P, perform action: @escaping (P.Output) -> Void) -> some View where P.Failure == Never { _m }
    public func onOpenURL(perform action: @escaping (URL) -> ()) -> some View { _m }
    public func refreshable(@_inheritActorContext action: @escaping @Sendable () async -> Void) -> some View { _m }
    public func environment<V>(_ keyPath: WritableKeyPath<EnvironmentValues, V>, _ value: V) -> some View { _m }
    public func environment<T: AnyObject & Observable>(_ object: T?) -> some View { _m }
    public func environmentObject<T: ObservableObject>(_ object: T) -> some View { _m }
    public func transaction(_ transform: @escaping (inout Transaction) -> Void) -> some View { _m }

    // Animation & transitions
    public func animation<V: Equatable>(_ animation: Animation?, value: V) -> some View { _m }
    public func transition(_ t: AnyTransition) -> some View { _m }
    public func contentTransition(_ transition: ContentTransition) -> some View { _m }
    public func matchedGeometryEffect<ID: Hashable>(id: ID, in namespace: Namespace.ID, properties: MatchedGeometryProperties = .frame, anchor: UnitPoint = .center, isSource: Bool = true) -> some View { _m }
    public func symbolEffect<T: IndefiniteSymbolEffect & SymbolEffect>(_ effect: T, options: SymbolEffectOptions = .default, isActive: Bool = true) -> some View { _m }
    public func symbolEffect<T: DiscreteSymbolEffect & SymbolEffect, U: Equatable>(_ effect: T, options: SymbolEffectOptions = .default, value: U) -> some View { _m }

    // Accessibility
    public func accessibilityLabel(_ label: Text) -> some View { _m }
    public func accessibilityLabel(_ labelKey: LocalizedStringKey) -> some View { _m }
    @_disfavoredOverload public func accessibilityLabel<S: StringProtocol>(_ label: S) -> some View { _m }
    public func accessibilityValue(_ valueDescription: Text) -> some View { _m }
    public func accessibilityValue(_ valueKey: LocalizedStringKey) -> some View { _m }
    @_disfavoredOverload public func accessibilityValue<S: StringProtocol>(_ value: S) -> some View { _m }
    public func accessibilityHint(_ hint: Text) -> some View { _m }
    public func accessibilityHint(_ hintKey: LocalizedStringKey) -> some View { _m }
    @_disfavoredOverload public func accessibilityHint<S: StringProtocol>(_ hint: S) -> some View { _m }
    public func accessibilityHidden(_ hidden: Bool) -> some View { _m }
    public func accessibilityElement(children: AccessibilityChildBehavior = .ignore) -> some View { _m }
    public func accessibilityAddTraits(_ traits: AccessibilityTraits) -> some View { _m }
    public func accessibilityRemoveTraits(_ traits: AccessibilityTraits) -> some View { _m }
    public func accessibilitySortPriority(_ sortPriority: Double) -> some View { _m }
    public func accessibilityIdentifier(_ identifier: String) -> some View { _m }
    public func accessibilityAction(_ actionKind: AccessibilityActionKind = .default, _ handler: @escaping () -> Void) -> some View { _m }
    public func accessibilityAction(named nameKey: LocalizedStringKey, _ handler: @escaping () -> Void) -> some View { _m }
    @_disfavoredOverload public func accessibilityAction<S: StringProtocol>(named name: S, _ handler: @escaping () -> Void) -> some View { _m }
    public func accessibilityAdjustableAction(_ handler: @escaping (AccessibilityAdjustmentDirection) -> Void) -> some View { _m }
    public func accessibilityRepresentation<V: View>(@ViewBuilder representation: () -> V) -> some View { _m }
    public func accessibilityShowsLargeContentViewer() -> some View { _m }

    // Navigation & lists
    public func navigationTitle(_ title: Text) -> some View { _m }
    public func navigationTitle(_ titleKey: LocalizedStringKey) -> some View { _m }
    @_disfavoredOverload public func navigationTitle<S: StringProtocol>(_ title: S) -> some View { _m }
    public func navigationBarTitleDisplayMode(_ displayMode: NavigationBarItem.TitleDisplayMode) -> some View { _m }
    public func navigationBarBackButtonHidden(_ hidesBackButton: Bool = true) -> some View { _m }
    public func navigationDestination<D: Hashable, C: View>(for data: D.Type, @ViewBuilder destination: @escaping (D) -> C) -> some View { _m }
    public func navigationDestination<V: View>(isPresented: Binding<Bool>, @ViewBuilder destination: () -> V) -> some View { _m }
    public func navigationDestination<D: Hashable, C: View>(item: Binding<D?>, @ViewBuilder destination: @escaping (D) -> C) -> some View { _m }
    @available(iOS 18.0, *)
    public func navigationTransition<T: NavigationTransition>(_ style: T) -> some View { _m }
    @available(iOS 18.0, *)
    public func matchedTransitionSource<ID: Hashable>(id: ID, in namespace: Namespace.ID) -> some View { _m }
    public func toolbar<Content: View>(@ViewBuilder content: () -> Content) -> some View { _m }
    public func toolbar<Content: ToolbarContent>(@ToolbarContentBuilder content: () -> Content) -> some View { _m }
    public func toolbar(_ visibility: Visibility, for bars: ToolbarPlacement...) -> some View { _m }
    public func toolbarBackground<S: ShapeStyle>(_ style: S, for bars: ToolbarPlacement...) -> some View { _m }
    public func toolbarBackground(_ visibility: Visibility, for bars: ToolbarPlacement...) -> some View { _m }
    public func toolbarRole(_ role: ToolbarRole) -> some View { _m }
    public func tabItem<V: View>(@ViewBuilder _ label: () -> V) -> some View { _m }
    public func badge(_ count: Int) -> some View { _m }
    public func listStyle<S: ListStyle>(_ style: S) -> some View { _m }
    public func listRowBackground<V: View>(_ view: V?) -> some View { _m }
    public func listRowInsets(_ insets: EdgeInsets?) -> some View { _m }
    public func listRowSeparator(_ visibility: Visibility, edges: VerticalEdge.Set = .all) -> some View { _m }
    public func listSectionSeparator(_ visibility: Visibility, edges: VerticalEdge.Set = .all) -> some View { _m }
    public func listRowSpacing(_ spacing: CGFloat?) -> some View { _m }
    public func listSectionSpacing(_ spacing: CGFloat) -> some View { _m }
    public func listSectionSpacing(_ spacing: ListSectionSpacing) -> some View { _m }
    public func scrollContentBackground(_ visibility: Visibility) -> some View { _m }
    public func scrollClipDisabled(_ disabled: Bool = true) -> some View { _m }
    public func scrollIndicators(_ visibility: ScrollIndicatorVisibility, axes: Axis.Set = [.vertical, .horizontal]) -> some View { _m }
    public func scrollBounceBehavior(_ behavior: ScrollBounceBehavior, axes: Axis.Set = [.vertical]) -> some View { _m }
    public func scrollDisabled(_ disabled: Bool) -> some View { _m }
    public func scrollTargetLayout(isEnabled: Bool = true) -> some View { _m }
    public func scrollTargetBehavior<T: ScrollTargetBehavior>(_ behavior: T) -> some View { _m }
    public func scrollPosition<ID: Hashable>(id: Binding<ID?>, anchor: UnitPoint? = nil) -> some View { _m }
    public func defaultScrollAnchor(_ anchor: UnitPoint?) -> some View { _m }
    public func contentMargins(_ edges: Edge.Set = .all, _ length: CGFloat?, for placement: ContentMarginPlacement = .automatic) -> some View { _m }
    public func searchable(text: Binding<String>, placement: SearchFieldPlacement = .automatic, prompt: Text? = nil) -> some View { _m }
    public func searchable(text: Binding<String>, placement: SearchFieldPlacement = .automatic, prompt: LocalizedStringKey) -> some View { _m }
    @_disfavoredOverload public func searchable<S: StringProtocol>(text: Binding<String>, placement: SearchFieldPlacement = .automatic, prompt: S) -> some View { _m }
    public func searchable(text: Binding<String>, isPresented: Binding<Bool>, placement: SearchFieldPlacement = .automatic, prompt: Text? = nil) -> some View { _m }
    public func searchable(text: Binding<String>, isPresented: Binding<Bool>, placement: SearchFieldPlacement = .automatic, prompt: LocalizedStringKey) -> some View { _m }
    public func searchSuggestions<S: View>(@ViewBuilder _ suggestions: () -> S) -> some View { _m }
    public func searchCompletion(_ completion: String) -> some View { _m }

    // Presentation
    public func sheet<Content: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) -> some View { _m }
    public func sheet<Item: Identifiable, Content: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping (Item) -> Content) -> some View { _m }
    public func fullScreenCover<Content: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) -> some View { _m }
    public func presentationDetents(_ detents: Set<PresentationDetent>) -> some View { _m }
    public func presentationDragIndicator(_ visibility: Visibility) -> some View { _m }
    public func interactiveDismissDisabled(_ isDisabled: Bool = true) -> some View { _m }
    public func alert<A: View>(_ titleKey: LocalizedStringKey, isPresented: Binding<Bool>, @ViewBuilder actions: () -> A) -> some View { _m }
    public func alert<A: View, M: View>(_ titleKey: LocalizedStringKey, isPresented: Binding<Bool>, @ViewBuilder actions: () -> A, @ViewBuilder message: () -> M) -> some View { _m }
    @_disfavoredOverload public func alert<S: StringProtocol, A: View, M: View>(_ title: S, isPresented: Binding<Bool>, @ViewBuilder actions: () -> A, @ViewBuilder message: () -> M) -> some View { _m }
    public func confirmationDialog<A: View>(_ titleKey: LocalizedStringKey, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, @ViewBuilder actions: () -> A) -> some View { _m }
    public func popover<Content: View>(isPresented: Binding<Bool>, attachmentAnchor: PopoverAttachmentAnchor = .rect(.bounds), arrowEdge: Edge = .top, @ViewBuilder content: @escaping () -> Content) -> some View { _m }
    public func presentationCompactAdaptation(_ adaptation: PresentationAdaptation) -> some View { _m }
}

public enum VerticalEdge: Int8, CaseIterable, Sendable {
    case top, bottom
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int8
        public init(rawValue: Int8) { self.rawValue = rawValue }
        public static let top = Set(rawValue: 1), bottom = Set(rawValue: 2), all = Set(rawValue: 3)
    }
}
public enum HorizontalEdge: Int8, CaseIterable, Sendable {
    case leading, trailing
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int8
        public init(rawValue: Int8) { self.rawValue = rawValue }
        public static let leading = Set(rawValue: 1), trailing = Set(rawValue: 2), all = Set(rawValue: 3)
    }
}
public enum BlendMode: Sendable { case normal, multiply, screen, overlay, darken, lighten, plusLighter, plusDarker }
public struct ContentShapeKinds: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let interaction = ContentShapeKinds(rawValue: 1), dragPreview = ContentShapeKinds(rawValue: 2)
    public static let contextMenuPreview = ContentShapeKinds(rawValue: 4), hoverEffect = ContentShapeKinds(rawValue: 8), accessibility = ContentShapeKinds(rawValue: 16)
}
public struct MatchedGeometryProperties: OptionSet, Sendable {
    public let rawValue: UInt32
    public init(rawValue: UInt32) { self.rawValue = rawValue }
    public static let position = MatchedGeometryProperties(rawValue: 1), size = MatchedGeometryProperties(rawValue: 2), frame = MatchedGeometryProperties(rawValue: 3)
}
public protocol TextSelectability {}
public struct EnabledTextSelectability: TextSelectability {}
public struct DisabledTextSelectability: TextSelectability {}
extension TextSelectability where Self == EnabledTextSelectability { public static var enabled: EnabledTextSelectability { .init() } }
extension TextSelectability where Self == DisabledTextSelectability { public static var disabled: DisabledTextSelectability { .init() } }
public protocol LabelStyle {}
public struct IconOnlyLabelStyle: LabelStyle { public init() {} }
public struct TitleOnlyLabelStyle: LabelStyle { public init() {} }
public struct TitleAndIconLabelStyle: LabelStyle { public init() {} }
extension LabelStyle where Self == IconOnlyLabelStyle { public static var iconOnly: IconOnlyLabelStyle { .init() } }
extension LabelStyle where Self == TitleOnlyLabelStyle { public static var titleOnly: TitleOnlyLabelStyle { .init() } }
extension LabelStyle where Self == TitleAndIconLabelStyle { public static var titleAndIcon: TitleAndIconLabelStyle { .init() } }
public protocol MenuStyle {}
public struct ButtonMenuStyle: MenuStyle { public init() {} }
extension MenuStyle where Self == ButtonMenuStyle { public static var button: ButtonMenuStyle { .init() } }
public struct MenuOrder: Sendable { public static let automatic = MenuOrder(), priority = MenuOrder(), fixed = MenuOrder() }
public protocol ListStyle {}
public struct PlainListStyle: ListStyle { public init() {} }
public struct InsetGroupedListStyle: ListStyle { public init() {} }
public struct GroupedListStyle: ListStyle { public init() {} }
public struct InsetListStyle: ListStyle { public init() {} }
public struct SidebarListStyle: ListStyle { public init() {} }
extension ListStyle where Self == PlainListStyle { public static var plain: PlainListStyle { .init() } }
extension ListStyle where Self == InsetGroupedListStyle { public static var insetGrouped: InsetGroupedListStyle { .init() } }
extension ListStyle where Self == GroupedListStyle { public static var grouped: GroupedListStyle { .init() } }
extension ListStyle where Self == InsetListStyle { public static var inset: InsetListStyle { .init() } }
extension ListStyle where Self == SidebarListStyle { public static var sidebar: SidebarListStyle { .init() } }
public struct ListSectionSpacing: Sendable { public static let `default` = ListSectionSpacing(), compact = ListSectionSpacing(); public static func custom(_ s: CGFloat) -> ListSectionSpacing { .init() } }
public protocol ScrollTargetBehavior {}
public struct PagingScrollTargetBehavior: ScrollTargetBehavior {}
public struct ViewAlignedScrollTargetBehavior: ScrollTargetBehavior {}
extension ScrollTargetBehavior where Self == PagingScrollTargetBehavior { public static var paging: PagingScrollTargetBehavior { .init() } }
extension ScrollTargetBehavior where Self == ViewAlignedScrollTargetBehavior { public static var viewAligned: ViewAlignedScrollTargetBehavior { .init() } }
public struct ContentMarginPlacement: Sendable { public static let automatic = ContentMarginPlacement(), scrollContent = ContentMarginPlacement(), scrollIndicators = ContentMarginPlacement() }
public enum PopoverAttachmentAnchor { case rect(Anchor<CGRect>.Source), point(UnitPoint) }
public struct Anchor<Value> { public struct Source { public static var bounds: Source { Source() } } }
public struct PresentationAdaptation: Sendable { public static let automatic = PresentationAdaptation(), none = PresentationAdaptation(), popover = PresentationAdaptation(), sheet = PresentationAdaptation() }
