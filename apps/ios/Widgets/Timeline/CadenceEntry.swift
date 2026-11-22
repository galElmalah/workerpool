import Foundation
import WidgetKit
import CadenceKit

/// One timeline entry for every Cadence widget. Views build their view-model from it with
/// `WidgetModels` at `date` (so the midnight entry renders tomorrow from the same snapshot).
struct CadenceEntry: TimelineEntry {
    enum Content {
        /// no device token on this phone (and nothing cached): "Connect in the app"
        case signedOut
        /// connected, but no snapshot yet (first fetch failed / offline)
        case empty
        case data(MobileSnapshot, fetchedAt: Date?)
    }

    let date: Date
    let content: Content
    let accent: Accent
    /// this week's calendar (Week widget, large family only)
    var calendar: CalendarResponse? = nil
    /// last morning check-in known to this phone (check-in widget)
    var checkIn: CheckInRecord? = nil
    /// Week widget configuration
    var metric: WeekWidgetMetric = .hours
    /// Smart Stack hint
    var relevance: TimelineEntryRelevance? = nil
    /// gallery / placeholder (sample data)
    var isPreview = false

    var snapshot: MobileSnapshot? {
        if case .data(let s, _) = content { return s }
        return nil
    }

    var fetchedAt: Date? {
        if case .data(_, let at) = content { return at }
        return nil
    }

    /// Sample entry for `placeholder(in:)` and the widget gallery — never touches the network.
    static func preview(date: Date = Date(), accent: Accent = .blue, metric: WeekWidgetMetric = .hours) -> CadenceEntry {
        // MobileSnapshot.preview is Saturday 21 Nov 2026; render it as "now" so it never looks stale.
        let s = MobileSnapshot.preview
        let day = Day(s.today) ?? Day(date)
        let noon = day.startDate().addingTimeInterval(10 * 3600)
        return CadenceEntry(date: noon, content: .data(s, fetchedAt: noon), accent: accent,
                            checkIn: nil, metric: metric, isPreview: true)
    }
}
