import AppIntents

// App Shortcuts (Siri phrases, Spotlight, the Shortcuts app). APP TARGET ONLY: project.yml excludes
// Shared/Intents/AppOnly from the widget extension — an app has exactly one AppShortcutsProvider.
// Every phrase must contain \(.applicationName); parameters in phrases must be AppEnums (FeelLevel).

struct CadenceShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TodayWorkoutIntent(),
            phrases: [
                "What's my workout today in \(.applicationName)",
                "What's my \(.applicationName) workout today",
                "What's on today in \(.applicationName)",
            ],
            shortTitle: "Today's workout",
            systemImageName: "figure.run"
        )
        AppShortcut(
            intent: LogFeelIntent(),
            phrases: [
                "Log how I feel in \(.applicationName)",
                "Morning check-in in \(.applicationName)",
                "Log feeling \(\.$feel) in \(.applicationName)",
            ],
            shortTitle: "Log how I feel",
            systemImageName: "sun.horizon"
        )
        AppShortcut(
            intent: QuickAddWorkoutIntent(),
            phrases: [
                "Add a workout in \(.applicationName)",
                "Add a workout to \(.applicationName)",
                "Plan a workout in \(.applicationName)",
            ],
            shortTitle: "Add a workout",
            systemImageName: "plus"
        )
        AppShortcut(
            intent: SyncGarminIntent(),
            phrases: [
                "Sync Garmin in \(.applicationName)",
                "Sync \(.applicationName) now",
            ],
            shortTitle: "Sync Garmin",
            systemImageName: "arrow.triangle.2.circlepath"
        )
        AppShortcut(
            intent: OpenCadenceIntent(destination: .today),
            phrases: ["Open today in \(.applicationName)", "Show today in \(.applicationName)"],
            shortTitle: "Open today",
            systemImageName: "sun.max"
        )
        AppShortcut(
            intent: OpenCadenceIntent(destination: .calendar),
            phrases: ["Open the calendar in \(.applicationName)", "Show my \(.applicationName) calendar"],
            shortTitle: "Open calendar",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: OpenCadenceIntent(destination: .trends),
            phrases: ["Open trends in \(.applicationName)", "Show my \(.applicationName) trends"],
            shortTitle: "Open trends",
            systemImageName: "chart.xyaxis.line"
        )
    }
}
