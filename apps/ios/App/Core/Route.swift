import SwiftUI
import CadenceKit

/// Every pushed screen in the app. Each tab has its own `[Route]` path on `AppModel`.
enum Route: Hashable {
    case day(LocalDate)
    case workout(id: String)
    case newWorkout(date: LocalDate)
    case editWorkout(id: String)
    /// pick a day to move (or, with `copy`, duplicate) a workout to
    case moveWorkout(id: String, from: LocalDate, copy: Bool)
    case activity(id: String)
    case week(IsoWeek)
    case event(id: String)
    case journal
    case settings
    case devices
    case garmin

    /// The id a zoom transition (iOS 18) morphs from: the tapped row carries `.zoomSource(route)`.
    var zoomID: String {
        switch self {
        case .day(let d): return "day-" + d
        case .workout(let id): return "workout-" + id
        case .newWorkout(let d): return "new-" + d
        case .editWorkout(let id): return "edit-" + id
        case .moveWorkout(let id, _, let copy): return (copy ? "copy-" : "move-") + id
        case .activity(let id): return "activity-" + id
        case .week(let w): return "week-" + w
        case .event(let id): return "event-" + id
        case .journal: return "journal"
        case .settings: return "settings"
        case .devices: return "devices"
        case .garmin: return "garmin"
        }
    }

    /// The route for a session row.
    init(_ target: SessionTarget) {
        switch target {
        case .workout(let id): self = .workout(id: id)
        case .activity(let id): self = .activity(id: id)
        }
    }

    /// The route for a deep link that names one screen (nil for tab-level links).
    init?(_ link: DeepLink) {
        switch link {
        case .workout(let id): self = .workout(id: id)
        case .activity(let id): self = .activity(id: id)
        case .event(let id): self = .event(id: id)
        case .week(let w): self = .week(w)
        case .calendar(let d?): self = .day(d)
        case .newWorkout(let d?): self = .newWorkout(date: d)
        default: return nil
        }
    }
}

/// Maps a route to its screen. Used by every tab's `NavigationStack` (`.cadenceDestinations()`).
@MainActor
@ViewBuilder
func routeDestination(_ route: Route) -> some View {
    switch route {
    case .day(let date): DayScreen(date: date)
    case .workout(let id): WorkoutScreen(id: id)
    case .newWorkout(let date): NewWorkoutScreen(date: date)
    case .editWorkout(let id): EditWorkoutScreen(id: id)
    case .moveWorkout(let id, let from, let copy): MoveWorkoutScreen(workoutId: id, from: from, copy: copy)
    case .activity(let id): ActivityScreen(id: id)
    case .week(let week): WeekReviewScreen(week: week)
    case .event(let id): EventScreen(id: id)
    case .journal: JournalScreen()
    case .settings: SettingsScreen()
    case .devices: DevicesScreen()
    case .garmin: GarminScreen()
    }
}

extension View {
    /// Registers `routeDestination` for `Route` values and applies the zoom transition (iOS 18).
    @MainActor
    func cadenceDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            routeDestination(route)
                .zoomDestination(route.zoomID)
        }
    }
}
