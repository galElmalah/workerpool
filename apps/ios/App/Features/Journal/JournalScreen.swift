import SwiftUI
import CadenceKit

/// Journal: today's note composer, then everything you wrote (day notes, intentions, reflections,
/// weekly reflections) by month, with search and a type filter. Comfortable reading typography.
@MainActor
struct JournalScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var store = JournalStore()
    @State private var searchText = ""
    @State private var filter: JournalFilter = .everything

    private struct LoadKey: Hashable {
        var text: String
        var filter: JournalFilter
        var version: Int
    }

    var body: some View {
        let c = Theme.colors(accent)
        let sections = JournalModel.sections(store.items)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Theme.Space.l, pinnedViews: []) {
                if store.isOffline {
                    OfflineNotice(storedAt: store.storedAt)
                }
                if searchText.isEmpty {
                    TodayNoteComposer(store: store)
                        .padding(.bottom, Theme.Space.s)
                }
                if sections.isEmpty {
                    if store.isFirstLoad {
                        LoadingBlock()
                    } else if let error = store.error {
                        FailedBlock(error: error) { Task { await reload() } }
                    } else {
                        EmptyState(symbol: "book.closed", title: "Nothing here yet",
                                   message: JournalModel.emptyText(filter: filter, query: searchText))
                    }
                }
                ForEach(sections) { section in
                    Text(section.title)
                        .font(Theme.Typography.label)
                        .foregroundStyle(c.fg3)
                        .padding(.top, Theme.Space.s)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(section.entries) { entry in
                        JournalEntryRow(entry: entry)
                            .onAppear {
                                if entry.id == sections.last?.entries.last?.id { loadMore() }
                            }
                    }
                }
                if store.isLoadingMore {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Theme.Space.m)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle("Journal")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $searchText, prompt: "Search everything you wrote")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Show", selection: $filter) {
                        ForEach(JournalFilter.allCases) { f in Text(f.label).tag(f) }
                    }
                } label: {
                    Label(filter.label, systemImage: filter == .everything ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(Text("Show, \(filter.label)"))
            }
        }
        .refreshable { await reload() }
        .task(id: LoadKey(text: searchText, filter: filter, version: model.dataVersion)) {
            if !searchText.isEmpty {
                try? await Task.sleep(for: .milliseconds(300))
                if Task.isCancelled { return }
            }
            await reload()
        }
        .task {
            guard let client = model.client else { return }
            await store.loadTodayNote(client: client, today: model.today)
        }
        .onDisappear {
            guard let client = model.client else { return }
            Task { await store.flushTodayNote(client: client, model: model) }
        }
        .animation(Theme.Motion.smooth, value: filter)
    }

    private func reload() async {
        guard let client = model.client else { return }
        await store.load(client: client, filter: filter, query: searchText)
    }

    private func loadMore() {
        guard let client = model.client else { return }
        Task { await store.loadMore(client: client) }
    }
}

@MainActor
private struct JournalEntryRow: View {
    let entry: JournalEntryModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        if let route = route {
            NavigationLink(value: route) { content }
                .buttonStyle(.plain)
        } else {
            content
        }
    }

    private var route: Route? {
        switch entry.target {
        case .day(let d): return .day(d)
        case .week(let w): return .week(w)
        case .workout(let id): return .workout(id: id)
        case .activity(let id): return .activity(id: id)
        case .none: return nil
        }
    }

    private var content: some View {
        let c = Theme.colors(accent)
        return VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                if let sport = entry.sport {
                    SportMark(sport: sport, size: 16)
                } else {
                    Image(systemName: entry.symbol)
                        .font(.caption)
                        .foregroundStyle(c.fg3)
                        .accessibilityHidden(true)
                }
                Text(entry.dayText)
                    .font(Theme.Typography.label.monospacedDigit())
                    .foregroundStyle(c.fg2)
                Text(entry.metaText)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
                    .lineLimit(1)
            }
            Text(entry.body)
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg1)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Theme.Space.xxs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(entry.accessibilityLabel))
    }
}

/// Today's day note, written in place (autosaves; an empty note deletes it).
@MainActor
private struct TodayNoteComposer: View {
    let store: JournalStore
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack {
                Text(JournalModel.composeTitle(today: model.today))
                    .font(Theme.Typography.label)
                    .foregroundStyle(c.fg3)
                Spacer()
                if let t = store.todayState.text {
                    Text(t)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(c.fg3)
                        .transition(.opacity)
                }
            }
            TextField(JournalModel.composePrompt, text: Binding(get: { store.todayNote }, set: { store.todayNote = $0 }), axis: .vertical)
                .lineLimit(3...12)
                .font(Theme.Typography.body)
                .padding(Theme.Space.s)
                .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .animation(Theme.Motion.fast, value: store.todayState)
        .task(id: store.todayNote) {
            guard store.todayNote != store.savedTodayNote else { return }
            try? await Task.sleep(for: .milliseconds(900))
            if Task.isCancelled { return }
            if let client = model.client { await store.saveTodayNote(client: client, model: model) }
        }
    }
}

@MainActor
@Observable
final class JournalStore {
    private(set) var items: [JournalItem] = []
    private(set) var nextCursor: String? = nil
    private(set) var isLoadingMore = false
    private(set) var isFirstLoad = true
    private(set) var error: APIError? = nil
    private(set) var storedAt: Date? = nil
    private var types: [JournalType] = []
    private var query: String? = nil

    var todayNote: String = ""
    private(set) var savedTodayNote: String = ""
    private(set) var todayState: NoteSaveState = .idle
    private var todayDate: LocalDate? = nil

    var isOffline: Bool { error?.isOffline ?? false }

    func load(client: APIClient, filter: JournalFilter, query text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let q: String? = trimmed.isEmpty ? nil : trimmed
        let t = filter.types
        let changed = t != types || q != query
        types = t
        query = q
        if let hit = client.cached(Endpoints.journal(types: t, query: q)), changed || items.isEmpty {
            items = hit.value.items
            nextCursor = hit.value.nextCursor
            storedAt = hit.storedAt
        } else if changed {
            items = []
            nextCursor = nil
        }
        defer { isFirstLoad = false }
        do {
            let page = try await client.journal(types: t, query: q)
            guard t == types, q == query else { return }
            items = page.items
            nextCursor = page.nextCursor
            storedAt = nil
            error = nil
        } catch let e as APIError {
            if t == types && q == query { error = e }
        } catch {}
    }

    func loadMore(client: APIClient) async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let t = types, q = query
        do {
            let page = try await client.journal(cursor: cursor, types: t, query: q)
            guard t == types, q == query else { return }
            items += page.items
            nextCursor = page.nextCursor
        } catch let e as APIError {
            error = e
        } catch {}
    }

    func loadTodayNote(client: APIClient, today: LocalDate) async {
        todayDate = today
        if let hit = client.cached(Endpoints.dayNote(date: today)), todayNote == savedTodayNote {
            todayNote = hit.value?.body ?? ""
            savedTodayNote = todayNote
        }
        do {
            let note: DayNote? = try await client.dayNote(date: today)
            if todayNote == savedTodayNote {
                todayNote = note?.body ?? ""
                savedTodayNote = todayNote
            }
        } catch {
            // offline: keep the cached note (or an empty composer)
        }
    }

    func saveTodayNote(client: APIClient, model: AppModel) async {
        guard let date = todayDate, todayNote != savedTodayNote else { return }
        let text = todayNote
        todayState = .saving
        do {
            _ = try await client.setDayNote(date: date, body: text.trimmingCharacters(in: .whitespacesAndNewlines))
            savedTodayNote = text
            todayState = .saved
            await model.didWrite()
        } catch let e as APIError {
            todayState = .failed(e.isOffline ? "You\u{2019}re offline." : e.message)
        } catch {
            todayState = .idle
        }
    }

    func flushTodayNote(client: APIClient, model: AppModel) async {
        if todayNote != savedTodayNote { await saveTodayNote(client: client, model: model) }
    }
}
