// Type-checking stub of CoreLocation value types.
@_exported import Foundation

public typealias CLLocationDegrees = Double
public typealias CLLocationDistance = Double
public struct CLLocationCoordinate2D: Sendable {
    public var latitude: CLLocationDegrees
    public var longitude: CLLocationDegrees
    public init() { latitude = 0; longitude = 0 }
    public init(latitude: CLLocationDegrees, longitude: CLLocationDegrees) { self.latitude = latitude; self.longitude = longitude }
}
public func CLLocationCoordinate2DIsValid(_ coord: CLLocationCoordinate2D) -> Bool { true }
