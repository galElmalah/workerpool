// Type-checking stub of Swift Charts (iOS 17 SDK) for the marks, scales, axes and selection Cadence uses.
@_exported import SwiftUI

public protocol Plottable: Equatable {}
extension Double: Plottable {}
extension Float: Plottable {}
extension CGFloat: Plottable {}
extension Int: Plottable {}
extension String: Plottable {}
extension Date: Plottable {}

public struct PlottableValue<Value: Plottable> {
    public static func value(_ label: Text, _ value: Value) -> PlottableValue<Value> { .init() }
    public static func value(_ labelKey: LocalizedStringKey, _ value: Value) -> PlottableValue<Value> { .init() }
    @_disfavoredOverload public static func value<S: StringProtocol>(_ label: S, _ value: Value) -> PlottableValue<Value> { .init() }
    public static func value(_ labelKey: LocalizedStringKey, _ value: Value, unit: Calendar.Component) -> PlottableValue<Value> where Value == Date { .init() }
    @_disfavoredOverload public static func value<S: StringProtocol>(_ label: S, _ value: Value, unit: Calendar.Component) -> PlottableValue<Value> where Value == Date { .init() }
}

public protocol ChartContent {
    associatedtype Body: ChartContent
    @ChartContentBuilder var body: Body { get }
}
extension Never: ChartContent {}
extension Optional: ChartContent where Wrapped: ChartContent { public var body: Never { fatalError() } }

@resultBuilder public struct ChartContentBuilder {
    public static func buildExpression<C: ChartContent>(_ content: C) -> C { content }
    public static func buildBlock() -> _EmptyChart { _EmptyChart() }
    public static func buildBlock<C: ChartContent>(_ content: C) -> C { content }
    public static func buildBlock<C0: ChartContent, C1: ChartContent>(_ c0: C0, _ c1: C1) -> _TupleChart { _TupleChart() }
    public static func buildBlock<C0: ChartContent, C1: ChartContent, C2: ChartContent>(_ c0: C0, _ c1: C1, _ c2: C2) -> _TupleChart { _TupleChart() }
    public static func buildBlock<C0: ChartContent, C1: ChartContent, C2: ChartContent, C3: ChartContent>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3) -> _TupleChart { _TupleChart() }
    public static func buildBlock<C0: ChartContent, C1: ChartContent, C2: ChartContent, C3: ChartContent, C4: ChartContent>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4) -> _TupleChart { _TupleChart() }
    public static func buildBlock<C0: ChartContent, C1: ChartContent, C2: ChartContent, C3: ChartContent, C4: ChartContent, C5: ChartContent>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5) -> _TupleChart { _TupleChart() }
    public static func buildIf<C: ChartContent>(_ content: C?) -> C? { content }
    public static func buildEither<T: ChartContent, F: ChartContent>(first: T) -> _CondChart<T, F> { .init() }
    public static func buildEither<T: ChartContent, F: ChartContent>(second: F) -> _CondChart<T, F> { .init() }
    public static func buildLimitedAvailability<C: ChartContent>(_ content: C) -> _TupleChart { _TupleChart() }
}
public struct _EmptyChart: ChartContent { public var body: Never { fatalError() } }
public struct _TupleChart: ChartContent { public var body: Never { fatalError() } }
public struct _CondChart<T, F>: ChartContent { init() {}; public var body: Never { fatalError() } }

extension ForEach: ChartContent where Content: ChartContent {
    public var body: Never { fatalError() }
}
extension ForEach where Content: ChartContent {
    public init(_ data: Data, @ChartContentBuilder content: @escaping (Data.Element) -> Content) where ID == Data.Element.ID, Data.Element: Identifiable { fatalError() }
    public init(_ data: Data, id: KeyPath<Data.Element, ID>, @ChartContentBuilder content: @escaping (Data.Element) -> Content) { fatalError() }
}

public struct MarkDimension: Sendable {
    public static let automatic = MarkDimension()
    public static func ratio(_ ratio: CGFloat) -> MarkDimension { .init() }
    public static func fixed(_ value: CGFloat) -> MarkDimension { .init() }
    public static func inset(_ value: CGFloat) -> MarkDimension { .init() }
}
extension MarkDimension: ExpressibleByFloatLiteral, ExpressibleByIntegerLiteral {
    public init(floatLiteral value: Double) {}
    public init(integerLiteral value: Int) {}
}
public struct MarkStackingMethod: Equatable, Sendable {
    public static let standard = MarkStackingMethod(), normalized = MarkStackingMethod(), center = MarkStackingMethod(), unstacked = MarkStackingMethod()
}
public struct InterpolationMethod: Sendable {
    public static let linear = InterpolationMethod(), monotone = InterpolationMethod(), catmullRom = InterpolationMethod()
    public static let cardinal = InterpolationMethod(), stepStart = InterpolationMethod(), stepCenter = InterpolationMethod(), stepEnd = InterpolationMethod()
}
public struct AnnotationPosition: Sendable {
    public static let automatic = AnnotationPosition(), overlay = AnnotationPosition(), top = AnnotationPosition(), bottom = AnnotationPosition()
    public static let leading = AnnotationPosition(), trailing = AnnotationPosition(), topLeading = AnnotationPosition(), topTrailing = AnnotationPosition()
    public static let bottomLeading = AnnotationPosition(), bottomTrailing = AnnotationPosition()
}
public struct AnnotationOverflowResolution: Sendable {
    public struct Strategy: Sendable {
        public static let automatic = Strategy(), fit = Strategy(), padScale = Strategy(), disabled = Strategy()
        public static func fit(to boundary: Boundary) -> Strategy { .init() }
    }
    public struct Boundary: Sendable { public static let automatic = Boundary(), plot = Boundary(), chart = Boundary() }
    public init(x: Strategy = .automatic, y: Strategy = .automatic) {}
    public static let automatic = AnnotationOverflowResolution()
}

public protocol _Mark: ChartContent {}
public struct _ModifiedMark<M>: ChartContent { public var body: Never { fatalError() } }
extension ChartContent {
    public func foregroundStyle<S: ShapeStyle>(_ style: S) -> some ChartContent { _ModifiedMark<Self>() }
    public func foregroundStyle<D: Plottable>(by value: PlottableValue<D>) -> some ChartContent { _ModifiedMark<Self>() }
    public func lineStyle(_ style: StrokeStyle) -> some ChartContent { _ModifiedMark<Self>() }
    public func interpolationMethod(_ method: InterpolationMethod) -> some ChartContent { _ModifiedMark<Self>() }
    public func opacity(_ value: Double) -> some ChartContent { _ModifiedMark<Self>() }
    public func cornerRadius(_ radius: CGFloat, style: RoundedCornerStyle = .continuous) -> some ChartContent { _ModifiedMark<Self>() }
    public func symbol<S: ChartSymbolShape>(_ symbol: S) -> some ChartContent { _ModifiedMark<Self>() }
    public func symbolSize(_ size: CGFloat) -> some ChartContent { _ModifiedMark<Self>() }
    public func position<P: Plottable>(by value: PlottableValue<P>, axis: Axis? = nil, span: MarkDimension = .automatic) -> some ChartContent { _ModifiedMark<Self>() }
    public func offset(x: CGFloat = 0, y: CGFloat = 0) -> some ChartContent { _ModifiedMark<Self>() }
    public func zIndex(_ value: Double) -> some ChartContent { _ModifiedMark<Self>() }
    public func accessibilityLabel(_ label: Text) -> some ChartContent { _ModifiedMark<Self>() }
    @_disfavoredOverload public func accessibilityLabel<S: StringProtocol>(_ label: S) -> some ChartContent { _ModifiedMark<Self>() }
    public func accessibilityValue(_ value: Text) -> some ChartContent { _ModifiedMark<Self>() }
    @_disfavoredOverload public func accessibilityValue<S: StringProtocol>(_ value: S) -> some ChartContent { _ModifiedMark<Self>() }
    public func accessibilityHidden(_ hidden: Bool) -> some ChartContent { _ModifiedMark<Self>() }
    public func annotation<C: View>(position: AnnotationPosition = .automatic, alignment: Alignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> C) -> some ChartContent { _ModifiedMark<Self>() }
    public func annotation<C: View>(position: AnnotationPosition = .automatic, alignment: Alignment = .center, spacing: CGFloat? = nil, overflowResolution: AnnotationOverflowResolution, @ViewBuilder content: () -> C) -> some ChartContent { _ModifiedMark<Self>() }
}
public protocol ChartSymbolShape: Shape {}
public struct BasicChartSymbolShape: ChartSymbolShape { public func path(in rect: CGRect) -> Path { Path() } }
extension ChartSymbolShape where Self == BasicChartSymbolShape {
    public static var circle: BasicChartSymbolShape { .init() }
    public static var square: BasicChartSymbolShape { .init() }
}

public struct LineMark: ChartContent {
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, y: PlottableValue<Y>) {}
    public init<X: Plottable, Y: Plottable, S: Plottable>(x: PlottableValue<X>, y: PlottableValue<Y>, series: PlottableValue<S>) {}
    public var body: Never { fatalError() }
}
public struct AreaMark: ChartContent {
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, y: PlottableValue<Y>, stacking: MarkStackingMethod = .standard) {}
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, yStart: PlottableValue<Y>, yEnd: PlottableValue<Y>) {}
    public init<X: Plottable, Y: Plottable, S: Plottable>(x: PlottableValue<X>, yStart: PlottableValue<Y>, yEnd: PlottableValue<Y>, series: PlottableValue<S>) {}
    public init<X: Plottable, Y: Plottable, S: Plottable>(x: PlottableValue<X>, y: PlottableValue<Y>, series: PlottableValue<S>, stacking: MarkStackingMethod = .standard) {}
    public var body: Never { fatalError() }
}
public struct BarMark: ChartContent {
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, y: PlottableValue<Y>, width: MarkDimension = .automatic, height: MarkDimension = .automatic, stacking: MarkStackingMethod = .standard) {}
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, yStart: PlottableValue<Y>, yEnd: PlottableValue<Y>, width: MarkDimension = .automatic) {}
    public init<X: Plottable, Y: Plottable>(xStart: PlottableValue<X>, xEnd: PlottableValue<X>, y: PlottableValue<Y>, height: MarkDimension = .automatic) {}
    public init<X: Plottable>(xStart: PlottableValue<X>, xEnd: PlottableValue<X>, yStart: CGFloat? = nil, yEnd: CGFloat? = nil) {}
    public init<X: Plottable>(x: PlottableValue<X>, yStart: CGFloat? = nil, yEnd: CGFloat? = nil, width: MarkDimension = .automatic, stacking: MarkStackingMethod = .standard) {}
    public var body: Never { fatalError() }
}
public struct PointMark: ChartContent {
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, y: PlottableValue<Y>) {}
    public var body: Never { fatalError() }
}
public struct RuleMark: ChartContent {
    public init<X: Plottable>(x: PlottableValue<X>, yStart: CGFloat? = nil, yEnd: CGFloat? = nil) {}
    public init<Y: Plottable>(xStart: CGFloat? = nil, xEnd: CGFloat? = nil, y: PlottableValue<Y>) {}
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, yStart: PlottableValue<Y>, yEnd: PlottableValue<Y>) {}
    public init<X: Plottable, Y: Plottable>(xStart: PlottableValue<X>, xEnd: PlottableValue<X>, y: PlottableValue<Y>) {}
    public var body: Never { fatalError() }
}
public struct RectangleMark: ChartContent {
    public init<X: Plottable, Y: Plottable>(x: PlottableValue<X>, y: PlottableValue<Y>, width: MarkDimension = .automatic, height: MarkDimension = .automatic) {}
    public init<X: Plottable, Y: Plottable>(xStart: PlottableValue<X>, xEnd: PlottableValue<X>, yStart: PlottableValue<Y>, yEnd: PlottableValue<Y>) {}
    public init<X: Plottable>(xStart: PlottableValue<X>, xEnd: PlottableValue<X>, yStart: CGFloat? = nil, yEnd: CGFloat? = nil) {}
    public var body: Never { fatalError() }
}
public struct SectorMark: ChartContent {
    public init<V: Plottable>(angle: PlottableValue<V>, innerRadius: MarkDimension = .automatic, outerRadius: MarkDimension = .automatic, angularInset: CGFloat? = nil) {}
    public var body: Never { fatalError() }
}

public struct Chart<Content: View>: View {
    public var body: Never { fatalError() }
}
public struct _ChartContentView<C: ChartContent>: View { public var body: Never { fatalError() } }
extension Chart {
    public init<C: ChartContent>(@ChartContentBuilder content: () -> C) where Content == _ChartContentView<C> {}
    public init<Data: RandomAccessCollection, C: ChartContent>(_ data: Data, @ChartContentBuilder content: @escaping (Data.Element) -> C) where Content == _ChartContentView<ForEach<Data, Data.Element.ID, C>>, Data.Element: Identifiable {}
    public init<Data: RandomAccessCollection, ID: Hashable, C: ChartContent>(_ data: Data, id: KeyPath<Data.Element, ID>, @ChartContentBuilder content: @escaping (Data.Element) -> C) where Content == _ChartContentView<ForEach<Data, ID, C>> {}
}

// Axes
public struct AxisValue {
    public var index: Int { 0 }
    public var count: Int { 0 }
    public func `as`<P: Plottable>(_ type: P.Type) -> P? { nil }
}
public protocol AxisContent {}
public protocol AxisMark: AxisContent {}
@resultBuilder public struct AxisContentBuilder {
    public static func buildExpression<C: AxisContent>(_ content: C) -> C { content }
    public static func buildBlock() -> _EmptyAxis { _EmptyAxis() }
    public static func buildBlock<C: AxisContent>(_ content: C) -> C { content }
    public static func buildBlock<C0: AxisContent, C1: AxisContent>(_ c0: C0, _ c1: C1) -> _TupleAxis { _TupleAxis() }
    public static func buildBlock<C0: AxisContent, C1: AxisContent, C2: AxisContent>(_ c0: C0, _ c1: C1, _ c2: C2) -> _TupleAxis { _TupleAxis() }
    public static func buildBlock<C0: AxisContent, C1: AxisContent, C2: AxisContent, C3: AxisContent>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3) -> _TupleAxis { _TupleAxis() }
    public static func buildIf<C: AxisContent>(_ content: C?) -> _TupleAxis { _TupleAxis() }
    public static func buildEither<T: AxisContent>(first: T) -> _TupleAxis { _TupleAxis() }
    public static func buildEither<F: AxisContent>(second: F) -> _TupleAxis { _TupleAxis() }
}
public struct _EmptyAxis: AxisContent {}
public struct _TupleAxis: AxisContent {}
public struct _ModifiedAxisMark: AxisMark {}
extension AxisMark {
    public func foregroundStyle<S: ShapeStyle>(_ style: S) -> some AxisMark { _ModifiedAxisMark() }
    public func font(_ font: Font?) -> some AxisMark { _ModifiedAxisMark() }
    public func offset(x: CGFloat = 0, y: CGFloat = 0) -> some AxisMark { _ModifiedAxisMark() }
}
public struct AxisMarkPosition: Sendable { public static let automatic = AxisMarkPosition(), leading = AxisMarkPosition(), trailing = AxisMarkPosition(), top = AxisMarkPosition(), bottom = AxisMarkPosition() }
public struct AxisMarkPreset: Sendable { public static let automatic = AxisMarkPreset(), extended = AxisMarkPreset(), aligned = AxisMarkPreset(), inset = AxisMarkPreset() }
public struct AxisMarkValues {
    public static let automatic = AxisMarkValues()
    public static func automatic(desiredCount: Int? = nil, roundLowerBound: Bool? = nil, roundUpperBound: Bool? = nil) -> AxisMarkValues { .init() }
    public static func stride(by stepSize: Double) -> AxisMarkValues { .init() }
    public static func stride(by component: Calendar.Component, count: Int = 1) -> AxisMarkValues { .init() }
}
public struct AxisMarks<Content: AxisContent>: AxisContent {
    public init(preset: AxisMarkPreset = .automatic, position: AxisMarkPosition = .automatic, values: AxisMarkValues = .automatic, @AxisContentBuilder content: @escaping (AxisValue) -> Content) {}
    public init<Values: Plottable>(preset: AxisMarkPreset = .automatic, position: AxisMarkPosition = .automatic, values: [Values], @AxisContentBuilder content: @escaping (AxisValue) -> Content) {}
}
extension AxisMarks where Content == _TupleAxis {
    public init(preset: AxisMarkPreset = .automatic, position: AxisMarkPosition = .automatic, values: AxisMarkValues = .automatic, stroke: StrokeStyle? = nil) {}
    public init<Values: Plottable>(preset: AxisMarkPreset = .automatic, position: AxisMarkPosition = .automatic, values: [Values], stroke: StrokeStyle? = nil) {}
}
public struct AxisGridLine: AxisMark {
    public init(centered: Bool? = nil, stroke: StrokeStyle? = nil) {}
}
public struct AxisTick: AxisMark {
    public init(centered: Bool? = nil, length: CGFloat? = nil, stroke: StrokeStyle? = nil) {}
}
public struct AxisValueLabelCollisionResolution: Sendable { public static let automatic = AxisValueLabelCollisionResolution(), truncate = AxisValueLabelCollisionResolution(), disabled = AxisValueLabelCollisionResolution() }
public struct AxisValueLabelOrientation: Sendable { public static let automatic = AxisValueLabelOrientation(), horizontal = AxisValueLabelOrientation(), vertical = AxisValueLabelOrientation() }
public struct AxisValueLabel: AxisMark {
    public init<Content: View>(centered: Bool? = nil, anchor: UnitPoint? = nil, multiLabelAlignment: Alignment? = nil, collisionResolution: AxisValueLabelCollisionResolution = .automatic, offsetsMarks: Bool? = nil, orientation: AxisValueLabelOrientation = .automatic, horizontalSpacing: CGFloat? = nil, verticalSpacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {}
    public init(centered: Bool? = nil, anchor: UnitPoint? = nil, multiLabelAlignment: Alignment? = nil, collisionResolution: AxisValueLabelCollisionResolution = .automatic, offsetsMarks: Bool? = nil, orientation: AxisValueLabelOrientation = .automatic, horizontalSpacing: CGFloat? = nil, verticalSpacing: CGFloat? = nil) {}
    public init<F: FormatStyle>(format: F, centered: Bool? = nil, anchor: UnitPoint? = nil, multiLabelAlignment: Alignment? = nil, collisionResolution: AxisValueLabelCollisionResolution = .automatic, offsetsMarks: Bool? = nil, orientation: AxisValueLabelOrientation = .automatic, horizontalSpacing: CGFloat? = nil, verticalSpacing: CGFloat? = nil) where F.FormatOutput == String {}
}

public struct ScaleType: Sendable { public static let linear = ScaleType(), log = ScaleType(), date = ScaleType(), category = ScaleType() }
public struct PlotDimensionScaleRange: Sendable {
    public static func plotDimension(startPadding: CGFloat = 0, endPadding: CGFloat = 0) -> PlotDimensionScaleRange { .init() }
    public static func plotDimension(padding: CGFloat) -> PlotDimensionScaleRange { .init() }
}
public struct AutomaticScaleDomain: Sendable { public static let automatic = AutomaticScaleDomain() }
public struct ChartProxy {
    public func value<P: Plottable>(atX x: CGFloat, as type: P.Type = P.self) -> P? { nil }
    public func position<P: Plottable>(forX value: P) -> CGFloat? { nil }
    public var plotFrame: Anchor<CGRect>? { nil }
    public var plotSize: CGSize { .zero }
}

extension View {
    public func chartXAxis<C: AxisContent>(@AxisContentBuilder content: () -> C) -> some View { _m }
    public func chartYAxis<C: AxisContent>(@AxisContentBuilder content: () -> C) -> some View { _m }
    public func chartXAxis(_ visibility: Visibility) -> some View { _m }
    public func chartYAxis(_ visibility: Visibility) -> some View { _m }
    public func chartXScale<Domain: ScaleDomain>(domain: Domain, type: ScaleType? = nil) -> some View { _m }
    public func chartYScale<Domain: ScaleDomain>(domain: Domain, type: ScaleType? = nil) -> some View { _m }
    public func chartXScale<Domain: ScaleDomain>(domain: Domain, range: PlotDimensionScaleRange, type: ScaleType? = nil) -> some View { _m }
    public func chartYScale<Domain: ScaleDomain>(domain: Domain, range: PlotDimensionScaleRange, type: ScaleType? = nil) -> some View { _m }
    public func chartXScale(range: PlotDimensionScaleRange, type: ScaleType? = nil) -> some View { _m }
    public func chartYScale(range: PlotDimensionScaleRange, type: ScaleType? = nil) -> some View { _m }
    public func chartLegend(_ visibility: Visibility) -> some View { _m }
    public func chartLegend<C: View>(position: AnnotationPosition = .automatic, alignment: Alignment? = nil, spacing: CGFloat? = nil, @ViewBuilder content: () -> C) -> some View { _m }
    public func chartForegroundStyleScale<Domain: Collection, Range: Collection>(domain: Domain, range: Range, type: ScaleType? = nil) -> some View where Domain.Element: Plottable, Range.Element: ShapeStyle { _m }
    public func chartForegroundStyleScale<DataValue: Plottable, S: ShapeStyle>(_ mapping: KeyValuePairs<DataValue, S>) -> some View { _m }
    public func chartXSelection<P: Plottable>(value: Binding<P?>) -> some View { _m }
    public func chartYSelection<P: Plottable>(value: Binding<P?>) -> some View { _m }
    public func chartXSelection<P: Plottable>(range: Binding<ClosedRange<P>?>) -> some View where P: Comparable { _m }
    public func chartOverlay<V: View>(alignment: Alignment = .center, @ViewBuilder content: @escaping (ChartProxy) -> V) -> some View { _m }
    public func chartBackground<V: View>(alignment: Alignment = .center, @ViewBuilder content: @escaping (ChartProxy) -> V) -> some View { _m }
    public func chartPlotStyle<C: View>(@ViewBuilder content: @escaping (_ChartPlotContent) -> C) -> some View { _m }
    public func chartScrollableAxes(_ axes: Axis.Set) -> some View { _m }
    public func chartXVisibleDomain<P: Plottable>(length: P) -> some View { _m }
    public func chartGesture(_ gesture: @escaping (ChartProxy) -> _EndedGesture<DragGesture>) -> some View { _m }
}
public struct _ChartPlotContent: View { public var body: Never { fatalError() } }

public protocol ScaleDomain {}
extension ClosedRange: ScaleDomain where Bound: Plottable {}
extension Range: ScaleDomain where Bound: Plottable {}
extension Array: ScaleDomain where Element: Plottable {}
extension AutomaticScaleDomain: ScaleDomain {}
