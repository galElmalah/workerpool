import SwiftUI
import WidgetKit
import CadenceKit

// Widget extension entry. One placeholder widget (Today) proves the pipeline end to end:
// keychain token (shared access group) → GET /api/mobile/snapshot → SnapshotCache (App Group)
// → WidgetModels → trivial views. The widgets engineer adds Week, Form, Race and the interactive
// check-in on top of `SnapshotProvider` and `WidgetModels`.

@main
struct CadenceWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
    }
}

// MARK: - Timeline

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: MobileSnapshot?
    let fetchedAt: Date?
    let accent: Accent
    /// true for the gallery/placeholder (sample data)
    var isPreview = false
}

/// Shared by every widget: cache first, network when connected, schedule from `WidgetModels`.
struct SnapshotProvider: TimelineProvider {
    private let config = AppGroupConfig.fromInfoPlist()

    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: .preview, fetchedAt: Date(), accent: .blue, isPreview: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        let cached = SnapshotCache(directory: config.containerURL).load()
        let accent = SharedPreferences(defaults: config.defaults).accent
        if context.isPreview || cached == nil {
            completion(SnapshotEntry(date: Date(), snapshot: cached?.snapshot ?? .preview, fetchedAt: cached?.fetchedAt ?? Date(),
                                     accent: accent, isPreview: cached == nil))
        } else {
            completion(SnapshotEntry(date: Date(), snapshot: cached?.snapshot, fetchedAt: cached?.fetchedAt, accent: accent))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let config = self.config
        Task {
            let cache = SnapshotCache(directory: config.containerURL)
            let accent = SharedPreferences(defaults: config.defaults).accent
            var entry = cache.load()
            let store = KeychainTokenStore(accessGroup: config.keychainGroup)
            if let client = APIClient.restore(tokenStore: store,
                                              transport: URLSessionTransport(session: URLSessionTransport.defaultSession(timeout: 15))) {
                let now = Date()
                if let fresh = try? await client.refreshSnapshot(into: cache, now: now) {
                    entry = SnapshotCache.Entry(snapshot: fresh, fetchedAt: now)
                }
            } else {
                entry = nil // signed out: show the connect prompt, not stale data
            }
            let now = Date()
            let schedule = WidgetModels.schedule(for: entry?.snapshot, now: now)
            let entries = schedule.entryDates.map {
                SnapshotEntry(date: $0, snapshot: entry?.snapshot, fetchedAt: entry?.fetchedAt, accent: accent)
            }
            completion(Timeline(entries: entries, policy: .after(schedule.reloadAfter)))
        }
    }
}

// MARK: - Today widget (placeholder views)

struct TodayWidget: Widget {
    let kind = "CadenceToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Today's sessions and how you are tracking.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

struct TodayWidgetView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let c = Theme.colors(entry.accent)
        Group {
            if let s = entry.snapshot {
                let m = WidgetModels.today(s, fetchedAt: entry.fetchedAt, now: entry.date)
                switch family {
                case .accessoryInline:
                    Text(m.inlineText)
                case .accessoryRectangular:
                    VStack(alignment: .leading, spacing: 1) {
                        Text(m.heading).font(.headline)
                        if let p = m.primary {
                            Text(p.title).font(.body).lineLimit(1)
                            Text(p.detail).font(.caption).monospacedDigit()
                        } else {
                            Text(m.emptyText).font(.body)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                default:
                    VStack(alignment: .leading, spacing: Theme.Space.xs) {
                        HStack {
                            Text(m.heading).font(Theme.Typography.title3).foregroundStyle(c.fg1)
                            Spacer()
                            Text(m.dateText).font(Theme.Typography.caption).foregroundStyle(c.fg3)
                        }
                        if m.lines.isEmpty {
                            Spacer(minLength: 0)
                            Text(m.emptyText).font(Theme.Typography.body).foregroundStyle(c.fg2)
                        } else {
                            ForEach(m.lines.prefix(family == .systemSmall ? 1 : 3)) { line in
                                SessionRow(line: line, showsTime: family != .systemSmall)
                            }
                        }
                        Spacer(minLength: 0)
                        if let headline = m.headline, family != .systemSmall {
                            Text(headline).font(Theme.Typography.caption).foregroundStyle(c.fg3).lineLimit(1)
                        }
                    }
                    .widgetURL(m.deepLink.url)
                }
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    Text("cadence").font(Theme.Typography.title3).foregroundStyle(c.fg1)
                    Text("Open Cadence to connect.").font(Theme.Typography.bodySmall).foregroundStyle(c.fg3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .widgetURL(DeepLink.today.url)
            }
        }
        .environment(\.cadenceAccent, entry.accent)
        .containerBackground(c.canvas, for: .widget)
    }
}

#Preview(as: .systemMedium) {
    TodayWidget()
} timeline: {
    SnapshotEntry(date: Date(), snapshot: .preview, fetchedAt: Date(), accent: .blue, isPreview: true)
}
