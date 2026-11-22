import SwiftUI
import WidgetKit
import AppIntents
import CadenceKit

#if compiler(>=6.0)
/// iOS 18 Control Center / Lock Screen / Action button control: opens quick add in the app
/// (`OpenQuickAddIntent` → OpenURLIntent(cadence://new) → the app's `.onOpenURL`).
/// Guarded by `#if compiler(>=6.0)` (Xcode 16 / iOS 18 SDK) so an Xcode 15 build still compiles.
@available(iOS 18.0, *)
struct QuickAddControl: ControlWidget {
    static let kind = "CadenceQuickAddControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenQuickAddIntent()) {
                Label("Add workout", systemImage: "plus")
            }
        }
        .displayName("Add workout")
        .description("Opens quick add in Cadence.")
    }
}
#endif
