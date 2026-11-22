import SwiftUI
import WidgetKit
import CadenceKit

// Widget extension entry. Data flow (see Widgets/README.md):
// keychain token (shared access group) → GET /api/mobile/snapshot when the App Group cache is older
// than 15 min → SnapshotCache → WidgetModels (CadenceKit, tested) → trivial views.

@main
struct CadenceWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        WeekWidget()
        FormWidget()
        RaceWidget()
        CheckInWidget()
        #if compiler(>=6.0)
        if #available(iOSApplicationExtension 18.0, *) {
            QuickAddControl()
        }
        #endif
    }
}
