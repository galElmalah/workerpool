import SwiftUI
import CadenceKit

/// Activities: searchable, sport filter in a menu, infinite scroll by cursor, totals as one quiet line.
@MainActor
struct ActivitiesScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var store = ActivitiesStore()
    @State private var searchText = ""
    @State private var sport: Sport? = nil

    private struct LoadKey: Hashable {
        var text: String
        var sport: Sport?
        var version: Int
    }

    var body: some View {
        let c = Theme.colors(accent)
        let sections = ActivityListModel.sections(store.items, units: model.units, today: model.today)
        List {
            if store.isOffline {
                OfflineNotice(storedAt: store.storedAt)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
            if let totals = ActivityListModel.totalsLine(store.totals, sport: sport, units: model.units) {
                Text(totals)
                    .font(Theme.Typography.bodySmall.monospacedDigit())
                    .foregroundStyle(c.fg3)
                    .contentTransition(.numericText())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
            if sections.isEmpty {
                emptyContent
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
            ForEach(sections) { section in
                Section {
                    ForEach(section.rows) { row in
                        NavigationLink(value: Route.activity(id: row.id)) {
                            ActivityRow(row: row)
                        }
                        .zoomSource(Route.activity(id: row.id))
                        .listRowBackground(c.canvas)
                        .onAppear {
                            if row.id == store.items.last?.id { loadMore() }
                        }
                    }
                } header: {
                    Text(section.title)
                        .font(Theme.Typography.label)
                        .foregroundStyle(c.fg3)
                        .textCase(nil)
                }
            }
            if store.isLoadingMore {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .screenBackground()
        .navigationTitle("Activities")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search activities")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sport", selection: $sport) {
                        Text("All sports").tag(Sport?.none)
                        ForEach(ActivityListModel.filterSports, id: \.self) { s in
                            Label(s.label, systemImage: s.symbolName).tag(Sport?.some(s))
                        }
                    }
                } label: {
                    Label(ActivityListModel.filterTitle(sport), systemImage: sport == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(Text("Filter by sport, \(ActivityListModel.filterTitle(sport))"))
            }
        }
        .refreshable { await reload() }
        .task(id: LoadKey(text: searchText, sport: sport, version: model.dataVersion)) {
            // debounce typing; filter and refresh changes land immediately after
            if !searchText.isEmpty {
                try? await Task.sleep(for: .milliseconds(300))
                if Task.isCancelled { return }
            }
            await reload()
        }
        .animation(Theme.Motion.smooth, value: sport)
    }

    @ViewBuilder
    private var emptyContent: some View {
        if store.isFirstLoad {
            LoadingBlock()
        } else if store.items.isEmpty, let error = store.error {
            FailedBlock(error: error) { Task { await reload() } }
        } else if sport != nil {
            EmptyState(symbol: "magnifyingglass", title: "No matching activities",
                       message: "Try another search or sport.", actionTitle: "Show all sports",
                       action: { sport = nil })
        } else if !searchText.isEmpty {
            EmptyState(symbol: "magnifyingglass", title: "No matching activities", message: "Try another search.")
        } else {
            EmptyState(symbol: "figure.run", title: "No activities yet",
                       message: "Activities you record on your Garmin appear here after a sync.")
        }
    }

    private func reload() async {
        guard let client = model.client else { return }
        await store.load(client: client, text: searchText, sport: sport)
    }

    private func loadMore() {
        guard let client = model.client else { return }
        Task { await store.loadMore(client: client) }
    }
}

/// glyph · title / date · duration · distance · load
@MainActor
struct ActivityRow: View {
    let row: ActivityRowModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(alignment: .center, spacing: Theme.Space.s) {
            SportMark(sport: row.sport, size: 24)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Theme.Space.xxs) {
                    Text(row.title)
                        .font(row.isKey ? Theme.Typography.body.weight(.semibold) : Theme.Typography.body)
                        .foregroundStyle(c.fg1)
                        .lineLimit(2)
                    if row.isKey {
                        Image(systemName: "star.fill")
                            .font(.caption2)
                            .foregroundStyle(c.fg3)
                            .accessibilityHidden(true)
                    }
                }
                HStack(spacing: 6) {
                    if row.showsIntensityDot { ZoneDot(intensity: row.intensity) }
                    Text(row.dateText + Format.dot + row.detail)
                        .font(Theme.Typography.numeric)
                        .foregroundStyle(c.fg3)
                        .lineLimit(1)
                }
            }
            .layoutPriority(1)
            Spacer(minLength: Theme.Space.xs)
            VStack(alignment: .trailing, spacing: 0) {
                Text(row.loadText)
                    .font(Theme.Typography.statSmall)
                    .foregroundStyle(c.fg1)
                Text("load")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
            }
            .fixedSize()
        }
        .padding(.vertical, Theme.Space.xxs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(row.accessibilityLabel))
    }
}

/// The list's paging state: cached first page first (offline), then the network; cursor paging.
@MainActor
@Observable
final class ActivitiesStore {
    private(set) var items: [Activity] = []
    private(set) var totals: ActivityTotals? = nil
    private(set) var nextCursor: String? = nil
    private(set) var isLoadingMore = false
    private(set) var isFirstLoad = true
    private(set) var error: APIError? = nil
    private(set) var storedAt: Date? = nil
    private var query = ActivityQuery()

    var isOffline: Bool { error?.isOffline ?? false }

    func load(client: APIClient, text: String, sport: Sport?) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let q = ActivityQuery(sport: sport, text: trimmed.isEmpty ? nil : trimmed, limit: 40)
        let changed = q != query
        query = q
        if let hit = client.cached(Endpoints.activities(q)), changed || items.isEmpty {
            apply(hit.value)
            storedAt = hit.storedAt
        } else if changed {
            items = []
            totals = nil
            nextCursor = nil
        }
        defer { isFirstLoad = false }
        do {
            let page = try await client.activities(q)
            guard q == query else { return }
            apply(page)
            storedAt = nil
            error = nil
        } catch let e as APIError {
            if q == query { error = e }
        } catch {
            // cancelled: a newer query replaced this one
        }
    }

    func loadMore(client: APIClient) async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        var q = query
        q.cursor = cursor
        do {
            let page = try await client.activities(q)
            guard q.text == query.text, q.sport == query.sport else { return }
            let known = Set(items.map(\.id))
            items += page.items.filter { !known.contains($0.id) }
            nextCursor = page.nextCursor
        } catch let e as APIError {
            error = e
        } catch {}
    }

    private func apply(_ page: ActivityPage) {
        items = page.items
        totals = page.totals
        nextCursor = page.nextCursor
    }
}
