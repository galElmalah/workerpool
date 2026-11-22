import Foundation

/// App routes reachable from widgets, notifications and search results.
/// URL form: `cadence://<host>/<arg>` — e.g. cadence://workout/wk_123, cadence://week/2026-W47.
/// The app registers the `cadence` scheme (project.yml → CFBundleURLTypes) and handles it with
/// `.onOpenURL { DeepLink(url: $0) }`; widgets attach `.widgetURL(link.url)` / `Link(destination:)`.
public enum DeepLink: Hashable, Sendable {
    case today
    case calendar(date: LocalDate?)
    case month(String) // "YYYY-MM"
    case week(IsoWeek)
    case workout(id: String)
    case activity(id: String)
    case event(id: String)
    case template(id: String)
    case checkIn(date: LocalDate?)
    case newWorkout(date: LocalDate?)
    case trends

    public static let scheme = "cadence"

    public var url: URL {
        func make(_ host: String, _ arg: String? = nil) -> URL {
            var c = URLComponents()
            c.scheme = DeepLink.scheme
            c.host = host
            if let arg { c.path = "/" + arg }
            return c.url ?? URL(string: "\(DeepLink.scheme)://\(host)")!
        }
        switch self {
        case .today: return make("today")
        case .calendar(let date): return make("calendar", date)
        case .month(let m): return make("month", m)
        case .week(let w): return make("week", w)
        case .workout(let id): return make("workout", id)
        case .activity(let id): return make("activity", id)
        case .event(let id): return make("event", id)
        case .template(let id): return make("template", id)
        case .checkIn(let date): return make("checkin", date)
        case .newWorkout(let date): return make("new", date)
        case .trends: return make("trends")
        }
    }

    public init?(url: URL) {
        guard url.scheme?.lowercased() == DeepLink.scheme, let host = url.host?.lowercased() else { return nil }
        let arg = url.path.split(separator: "/").first.map(String.init)
        switch host {
        case "today": self = .today
        case "calendar": self = .calendar(date: arg)
        case "month": guard let arg else { return nil }; self = .month(arg)
        case "week": guard let arg else { return nil }; self = .week(arg)
        case "workout": guard let arg else { return nil }; self = .workout(id: arg)
        case "activity": guard let arg else { return nil }; self = .activity(id: arg)
        case "event": guard let arg else { return nil }; self = .event(id: arg)
        case "template": guard let arg else { return nil }; self = .template(id: arg)
        case "checkin": self = .checkIn(date: arg)
        case "new": self = .newWorkout(date: arg)
        case "trends": self = .trends
        default: return nil
        }
    }

    /// Maps a web route (e.g. `SearchItem.href`) to an app route.
    public init?(webPath: String) {
        let parts = webPath.split(separator: "?").first.map { $0.split(separator: "/").map(String.init) } ?? []
        let head = parts.first ?? ""
        switch (head, parts.count) {
        case ("today", _): self = .today
        case ("workouts", 2): self = .workout(id: parts[1])
        case ("activities", 2): self = .activity(id: parts[1])
        case ("events", 2): self = .event(id: parts[1])
        case ("library", 2): self = .template(id: parts[1])
        case ("trends", _): self = .trends
        case ("calendar", 3) where parts[1] == "day": self = .calendar(date: parts[2])
        case ("calendar", 3) where parts[1] == "week": self = .week(parts[2])
        case ("calendar", 3) where parts[1] == "month": self = .month(parts[2])
        case ("calendar", _): self = .calendar(date: nil)
        default: return nil
        }
    }
}
