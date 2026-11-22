import SwiftUI
import MapKit
import CadenceKit

extension GeoPoint {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

extension RouteShape {
    /// The camera that fits the whole route (with a margin).
    var fittedCamera: MapCameraPosition {
        guard let r = region else { return .automatic }
        return .region(MKCoordinateRegion(center: r.center.coordinate,
                                          span: MKCoordinateSpan(latitudeDelta: r.latitudeDelta, longitudeDelta: r.longitudeDelta)))
    }
}

/// The route on a MapKit map: the line in the sport colour, start and finish marks, and the
/// scrubbing position from the charts. Non-interactive inline; fully interactive when pushed.
@MainActor
struct RouteMap: View {
    let route: RouteShape
    let sport: Sport
    var marker: GeoPoint? = nil
    var interactive: Bool = false
    @State private var position: MapCameraPosition = .automatic
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        let line = DataColor.sport(sport)
        Map(position: $position, interactionModes: interactive ? .all : []) {
            MapPolyline(coordinates: route.coordinates.map(\.coordinate))
                .stroke(line, lineWidth: 4)
            if let start = route.coordinates.first {
                Annotation("Start", coordinate: start.coordinate, anchor: .center) {
                    Circle()
                        .fill(Color.white)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(line, lineWidth: 3))
                        .accessibilityHidden(true)
                }
            }
            if let end = route.coordinates.last {
                Annotation("Finish", coordinate: end.coordinate, anchor: .bottomLeading) {
                    Image(systemName: "flag.checkered")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(c.fg1)
                        .padding(4)
                        .background(c.surface1, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                        .accessibilityHidden(true)
                }
            }
            if let marker {
                Annotation("", coordinate: marker.coordinate, anchor: .center) {
                    Circle()
                        .fill(c.fg1)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                        .accessibilityHidden(true)
                }
            }
        }
        .mapStyle(.standard)
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .onAppear { position = route.fittedCamera }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Route map, \(sport.label)"))
    }
}

/// Inline route preview (fixed height) with a push to the full-screen map.
@MainActor
struct ActivityRouteSection: View {
    let store: ActivityStore
    let route: RouteShape
    let sport: Sport
    let title: String
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Route") {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                RouteMap(route: route, sport: sport, marker: store.readout?.routeCoordinate)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                    .allowsHitTesting(false)
                NavigationLink {
                    ActivityMapScreen(route: route, sport: sport, title: title)
                } label: {
                    HStack(spacing: Theme.Space.xxs) {
                        Text("Explore the map")
                            .font(Theme.Typography.bodySmall)
                            .foregroundStyle(c.fg2)
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(c.fg3)
                            .accessibilityHidden(true)
                    }
                    .padding(.vertical, Theme.Space.xxs)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Full-screen, interactive route map (pushed).
@MainActor
struct ActivityMapScreen: View {
    let route: RouteShape
    let sport: Sport
    let title: String

    var body: some View {
        RouteMap(route: route, sport: sport, interactive: true)
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}
