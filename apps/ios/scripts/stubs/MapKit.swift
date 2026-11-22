// Type-checking stub of the SwiftUI MapKit API (iOS 17: Map with MapContentBuilder).
@_exported import SwiftUI
@_exported import CoreLocation

public struct MKCoordinateSpan: Sendable {
    public var latitudeDelta: CLLocationDegrees
    public var longitudeDelta: CLLocationDegrees
    public init() { latitudeDelta = 0; longitudeDelta = 0 }
    public init(latitudeDelta: CLLocationDegrees, longitudeDelta: CLLocationDegrees) { self.latitudeDelta = latitudeDelta; self.longitudeDelta = longitudeDelta }
}
public struct MKCoordinateRegion: Sendable {
    public var center: CLLocationCoordinate2D
    public var span: MKCoordinateSpan
    public init() { center = .init(); span = .init() }
    public init(center: CLLocationCoordinate2D, span: MKCoordinateSpan) { self.center = center; self.span = span }
    public init(center: CLLocationCoordinate2D, latitudinalMeters: CLLocationDistance, longitudinalMeters: CLLocationDistance) { self.center = center; self.span = .init() }
}
public struct MKMapRect: Sendable { public init() {} }

public struct MapCamera: Equatable, Sendable {
    public init(centerCoordinate: CLLocationCoordinate2D, distance: Double, heading: Double = 0, pitch: Double = 0) {}
    public static func == (a: MapCamera, b: MapCamera) -> Bool { true }
}
public struct MapCameraPosition: Equatable, Sendable {
    public static let automatic = MapCameraPosition()
    public static func region(_ region: MKCoordinateRegion) -> MapCameraPosition { .init() }
    public static func rect(_ rect: MKMapRect) -> MapCameraPosition { .init() }
    public static func camera(_ camera: MapCamera) -> MapCameraPosition { .init() }
    public static func userLocation(fallback: MapCameraPosition) -> MapCameraPosition { .init() }
    public var region: MKCoordinateRegion? { nil }
    public var positionedByUser: Bool { false }
}
public struct MapCameraBounds: Sendable {
    public init(centerCoordinateBounds: MKCoordinateRegion, minimumDistance: Double? = nil, maximumDistance: Double? = nil) {}
}
public struct MapInteractionModes: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let pan = MapInteractionModes(rawValue: 1), zoom = MapInteractionModes(rawValue: 2)
    public static let rotate = MapInteractionModes(rawValue: 4), pitch = MapInteractionModes(rawValue: 8)
    public static let all = MapInteractionModes(rawValue: 15)
}

public protocol MapContent {
    associatedtype Body: MapContent
    @MapContentBuilder @MainActor var body: Body { get }
}
extension Never: MapContent {}
extension Optional: MapContent where Wrapped: MapContent { public var body: Never { fatalError() } }
@resultBuilder public struct MapContentBuilder {
    public static func buildExpression<C: MapContent>(_ content: C) -> C { content }
    public static func buildBlock() -> _EmptyMapContent { _EmptyMapContent() }
    public static func buildBlock<C: MapContent>(_ content: C) -> C { content }
    public static func buildBlock<C0: MapContent, C1: MapContent>(_ c0: C0, _ c1: C1) -> _TupleMapContent { _TupleMapContent() }
    public static func buildBlock<C0: MapContent, C1: MapContent, C2: MapContent>(_ c0: C0, _ c1: C1, _ c2: C2) -> _TupleMapContent { _TupleMapContent() }
    public static func buildBlock<C0: MapContent, C1: MapContent, C2: MapContent, C3: MapContent>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3) -> _TupleMapContent { _TupleMapContent() }
    public static func buildBlock<C0: MapContent, C1: MapContent, C2: MapContent, C3: MapContent, C4: MapContent>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4) -> _TupleMapContent { _TupleMapContent() }
    public static func buildIf<C: MapContent>(_ content: C?) -> C? { content }
    public static func buildEither<T: MapContent>(first: T) -> _TupleMapContent { _TupleMapContent() }
    public static func buildEither<F: MapContent>(second: F) -> _TupleMapContent { _TupleMapContent() }
}
public struct _EmptyMapContent: MapContent { public var body: Never { fatalError() } }
public struct _TupleMapContent: MapContent { public var body: Never { fatalError() } }

public struct MapPolyline: MapContent {
    public enum ContourStyle: Sendable { case straight, geodesic }
    public init(coordinates: [CLLocationCoordinate2D], contourStyle: ContourStyle = .straight) {}
    public func stroke<S: ShapeStyle>(_ style: S, lineWidth: CGFloat) -> MapPolyline { self }
    public func stroke<S: ShapeStyle>(_ style: S, style strokeStyle: StrokeStyle) -> MapPolyline { self }
    public func mapOverlayLevel(level: MKOverlayLevel) -> MapPolyline { self }
    public var body: Never { fatalError() }
}
public enum MKOverlayLevel: Int, Sendable { case aboveRoads, aboveLabels }
public struct Annotation<Label: View, Content: View>: MapContent {
    public var body: Never { fatalError() }
}
extension Annotation where Label == Text {
    public init(_ titleKey: LocalizedStringKey, coordinate: CLLocationCoordinate2D, anchor: UnitPoint = .bottom, @ViewBuilder content: () -> Content) {}
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, coordinate: CLLocationCoordinate2D, anchor: UnitPoint = .bottom, @ViewBuilder content: () -> Content) {}
}
extension Annotation {
    public init(coordinate: CLLocationCoordinate2D, anchor: UnitPoint = .bottom, @ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) {}
}
public struct Marker<Label: View>: MapContent {
    public var body: Never { fatalError() }
}
extension Marker where Label == Text {
    public init(_ titleKey: LocalizedStringKey, coordinate: CLLocationCoordinate2D) {}
    public init(_ titleKey: LocalizedStringKey, systemImage: String, coordinate: CLLocationCoordinate2D) {}
}
extension MapContent {
    public func annotationTitles(_ visibility: Visibility) -> some MapContent { self }
    public func tint(_ tint: Color) -> some MapContent { self }
    public func tag<V: Hashable>(_ tag: V) -> some MapContent { self }
}

public struct MapContentView<Label: View, C: MapContent>: View { public var body: Never { fatalError() } }
public struct Map<Content: View>: View {
    public var body: Never { fatalError() }
}
extension Map {
    public init<C: MapContent>(position: Binding<MapCameraPosition>, bounds: MapCameraBounds? = nil, interactionModes: MapInteractionModes = .all, scope: Namespace.ID? = nil, @MapContentBuilder content: () -> C) where Content == MapContentView<Never, C> {}
    public init<C: MapContent>(initialPosition: MapCameraPosition = .automatic, bounds: MapCameraBounds? = nil, interactionModes: MapInteractionModes = .all, scope: Namespace.ID? = nil, @MapContentBuilder content: () -> C) where Content == MapContentView<Never, C> {}
    public init(position: Binding<MapCameraPosition>, bounds: MapCameraBounds? = nil, interactionModes: MapInteractionModes = .all, scope: Namespace.ID? = nil) where Content == MapContentView<Never, _EmptyMapContent> {}
}

public struct MapStyle: Sendable {
    public enum Elevation: Sendable { case automatic, flat, realistic }
    public enum PointsOfInterest: Sendable { case all, excludingAll }
    public static var standard: MapStyle { .init() }
    public static var imagery: MapStyle { .init() }
    public static var hybrid: MapStyle { .init() }
    public static func standard(elevation: Elevation = .automatic, emphasis: Emphasis = .automatic, pointsOfInterest: PointsOfInterest = .all, showsTraffic: Bool = false) -> MapStyle { .init() }
    public static func hybrid(elevation: Elevation = .automatic, pointsOfInterest: PointsOfInterest = .all, showsTraffic: Bool = false) -> MapStyle { .init() }
    public enum Emphasis: Sendable { case automatic, muted }
}

public protocol MapControlsContent {}
@resultBuilder public struct MapControlsBuilder {
    public static func buildExpression<C: View>(_ content: C) -> C { content }
    public static func buildBlock<C: View>(_ content: C) -> C { content }
    public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> TupleView<(C0, C1)> { TupleView((c0, c1)) }
    public static func buildBlock<C0: View, C1: View, C2: View>(_ c0: C0, _ c1: C1, _ c2: C2) -> TupleView<(C0, C1, C2)> { TupleView((c0, c1, c2)) }
}
public struct MapCompass: View { public init(scope: Namespace.ID? = nil) {}; public var body: Never { fatalError() } }
public struct MapScaleView: View {
    public enum AxisVisibility: Sendable { case automatic, visible }
    public init(anchorEdge: HorizontalEdge = .leading, scope: Namespace.ID? = nil) {}
    public var body: Never { fatalError() }
}
public struct MapUserLocationButton: View { public init(scope: Namespace.ID? = nil) {}; public var body: Never { fatalError() } }
public struct MapPitchToggle: View { public init(scope: Namespace.ID? = nil) {}; public var body: Never { fatalError() } }

extension View {
    public func mapStyle(_ mapStyle: MapStyle) -> some View { _m }
    public func mapControls<Content: View>(@MapControlsBuilder _ content: () -> Content) -> some View { _m }
    public func mapControlVisibility(_ visibility: Visibility) -> some View { _m }
    public func onMapCameraChange(frequency: MapCameraUpdateFrequency = .onEnd, _ action: @escaping () -> Void) -> some View { _m }
}
public enum MapCameraUpdateFrequency: Sendable { case continuous, onEnd }
