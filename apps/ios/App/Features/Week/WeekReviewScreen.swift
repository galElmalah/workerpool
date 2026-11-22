import SwiftUI
import CadenceKit

/// The week review: headline sentence → planned vs done → by sport → key sessions → intensity →
/// week note (autosave) → previous / next week (switched in place).
@MainActor
struct WeekReviewScreen: View {
    let week: IsoWeek
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: IsoWeek
    @State private var store = WeekStore()

    init(week: IsoWeek) {
        self.week = week
        _shown = State(initialValue: week)
    }

    var body: some View {
        let vm = store.review.value.map { WeekReviewModel(review: $0, today: model.today, units: model.units) }
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                if store.review.isOffline {
                    OfflineNotice(storedAt: store.review.storedAt)
                }
                if let vm, vm.isoWeek == shown {
                    WeekHeadline(vm: vm)
                    WeekDaysSection(days: vm.days)
                    if !vm.bySport.isEmpty { WeekBySportSection(rows: vm.bySport) }
                    if !vm.keySessions.isEmpty { WeekKeySessionsSection(rows: vm.keySessions) }
                    if !vm.intensity.isEmpty { WeekIntensitySection(rows: vm.intensity) }
                    if !vm.highlights.isEmpty { WeekHighlightsSection(lines: vm.highlights) }
                    WeekNoteSection(store: store, week: shown)
                    WeekNavigation(vm: vm, go: go)
                } else if store.review.failedEmpty {
                    FailedBlock(error: store.review.error) { Task { await load() } }
                } else {
                    LoadingBlock()
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Theme.Space.m)
            .id(shown)
            .transition(.opacity)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle(vm?.title ?? "Week \(Format.weekLabel(shown).dropFirst())")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { go(vm?.previousWeek ?? previous(shown)) } label: {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel("Previous week")
                Button { go(vm?.nextWeek ?? next(shown)) } label: {
                    Image(systemName: "chevron.right")
                }
                .accessibilityLabel("Next week")
            }
        }
        .refreshable { await load() }
        .task(id: LoadKey(week: shown, version: model.dataVersion)) { await load() }
        .onDisappear {
            guard let client = model.client else { return }
            Task { await store.flushNote(client: client, model: model) }
        }
    }

    private struct LoadKey: Hashable {
        var week: IsoWeek
        var version: Int
    }

    private func previous(_ w: IsoWeek) -> IsoWeek { Day.isoWeekStart(w)?.adding(days: -7).isoWeek ?? w }
    private func next(_ w: IsoWeek) -> IsoWeek { Day.isoWeekStart(w)?.adding(days: 7).isoWeek ?? w }

    private func go(_ target: IsoWeek) {
        if let client = model.client {
            Task { await store.flushNote(client: client, model: model) }
        }
        withAnimation(Theme.Motion.resolved(Theme.Motion.smooth, reduceMotion: reduceMotion)) { shown = target }
    }

    private func load() async {
        guard let client = model.client else { return }
        await store.load(week: shown, client: client)
    }
}

@MainActor
@Observable
final class WeekStore {
    private(set) var review = Remote<WeekReview>()
    private(set) var week: IsoWeek? = nil
    var note: String = ""
    private(set) var savedNote: String = ""
    private(set) var noteState: NoteSaveState = .idle

    func load(week w: IsoWeek, client: APIClient) async {
        if week != w {
            // a different week: start from that week's cache, not the previous week's data
            review = Remote<WeekReview>()
            week = w
            noteState = .idle
            note = ""
            savedNote = ""
        }
        await review.load(cached: { client.cached(Endpoints.week(w)) }, fetch: { try await client.week(w) })
        if let r = review.value, r.isoWeek == w, note == savedNote {
            note = r.note?.body ?? ""
            savedNote = note
        }
    }

    func saveNote(client: APIClient, model: AppModel) async {
        guard let w = week, note != savedNote else { return }
        let text = note
        noteState = .saving
        do {
            _ = try await client.setWeekNote(w, WeekNoteInput(body: text.trimmingCharacters(in: .whitespacesAndNewlines)))
            savedNote = text
            noteState = .saved
            await model.didWrite()
        } catch let e as APIError {
            noteState = .failed(e.isOffline ? "You\u{2019}re offline." : e.message)
        } catch {
            noteState = .idle
        }
    }

    func flushNote(client: APIClient, model: AppModel) async {
        if note != savedNote { await saveNote(client: client, model: model) }
    }
}

// MARK: - Sections

@MainActor
private struct WeekHeadline: View {
    let vm: WeekReviewModel
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Text("\(vm.rangeText)\(Format.dot)\(vm.statusText)")
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg3)
                Text(vm.headline)
                    .font(Theme.Typography.title2)
                    .foregroundStyle(c.fg1)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Theme.Space.m, alignment: .topLeading),
                                     count: typeSize.isAccessibilitySize ? 1 : 2),
                      alignment: .leading, spacing: Theme.Space.l) {
                ForEach(vm.figures) { f in
                    LabelledStat(label: f.label, value: f.value, unit: f.unit, context: f.context, size: .large)
                        .contentTransition(.numericText())
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(Text(f.accessibilityText))
                }
            }
            if let wow = vm.wowLine {
                Text(wow)
                    .font(Theme.Typography.bodySmall.monospacedDigit())
                    .foregroundStyle(c.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let caution = vm.cautionText {
                Label {
                    Text(caution).foregroundStyle(c.fg1)
                } icon: {
                    Image(systemName: AnalysisTone.warn.symbol).foregroundStyle(DataColor.warn)
                }
                .font(Theme.Typography.bodySmall)
            }
        }
    }
}

/// Navigable session row: the shared `SessionRow` wrapped in a link to its workout / activity.
@MainActor
private struct LinkedSessionRow: View {
    let line: SessionLine

    var body: some View {
        if let link = line.deepLink, let route = Route(link) {
            NavigationLink(value: route) {
                SessionRow(line: line, showsTime: false)
            }
            .buttonStyle(.plain)
            .zoomSource(route)
        } else {
            SessionRow(line: line, showsTime: false)
        }
    }
}

@MainActor
private struct WeekDaysSection: View {
    let days: [WeekDayRowModel]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Planned vs done") {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(days) { day in
                    VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                            Text(day.weekday)
                                .font(Theme.Typography.body.weight(.semibold))
                                .foregroundStyle(day.isToday ? c.accentInk : c.fg1)
                            Text(day.dateText)
                                .font(Theme.Typography.bodySmall)
                                .foregroundStyle(c.fg3)
                            if let marker = day.markerText {
                                Text(marker)
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(c.fg2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(c.surface2, in: Capsule())
                            }
                            Spacer(minLength: Theme.Space.xs)
                            Text(day.totalsText)
                                .font(Theme.Typography.numeric)
                                .foregroundStyle(c.fg2)
                                .lineLimit(1)
                        }
                        if let f = day.fraction {
                            ThinProgressBar(fraction: f)
                                .padding(.vertical, 2)
                        }
                        if day.lines.isEmpty && day.markerText == nil {
                            Text("Rest")
                                .font(Theme.Typography.bodySmall)
                                .foregroundStyle(c.fg4)
                        }
                        ForEach(day.lines) { line in
                            LinkedSessionRow(line: line)
                        }
                    }
                    .padding(.vertical, Theme.Space.s)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text(day.accessibilityLabel))
                    if day.id != days.last?.id {
                        Rectangle().fill(c.line1).frame(height: 0.5)
                    }
                }
            }
        }
    }
}

@MainActor
private struct WeekBySportSection: View {
    let rows: [SportRowModel]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("By sport") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                            SportMark(sport: row.sport, size: 20)
                            Text(row.sport.label)
                                .font(Theme.Typography.body)
                                .foregroundStyle(c.fg1)
                            Spacer(minLength: Theme.Space.xs)
                            Text(row.doneText)
                                .font(Theme.Typography.statSmall)
                                .foregroundStyle(c.fg1)
                            if let planned = row.plannedText {
                                Text(planned)
                                    .font(Theme.Typography.numeric)
                                    .foregroundStyle(c.fg3)
                            }
                        }
                        if let f = row.fraction {
                            ThinProgressBar(fraction: f, tint: DataColor.sport(row.sport))
                        }
                        Text([row.distanceText, row.sessionsText].compactMap { $0 }.joined(separator: Format.dot))
                            .font(Theme.Typography.caption.monospacedDigit())
                            .foregroundStyle(c.fg3)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

@MainActor
private struct WeekKeySessionsSection: View {
    let rows: [KeySessionRowModel]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Key sessions") {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 0) {
                        Label {
                            Text(row.statusText)
                                .font(Theme.Typography.label)
                                .foregroundStyle(c.fg2)
                        } icon: {
                            Image(systemName: row.tone.symbol)
                                .font(.caption)
                                .foregroundStyle(toneColor(row.tone, c))
                        }
                        LinkedSessionRow(line: row.line)
                    }
                }
            }
        }
    }
}

@MainActor
private struct WeekIntensitySection: View {
    let rows: [IntensitySplitRow]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Intensity") {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                        HStack {
                            Text(row.label)
                                .font(Theme.Typography.bodySmall)
                                .foregroundStyle(row.isDim ? c.fg3 : c.fg1)
                            Spacer()
                            Text(row.share.text)
                                .font(Theme.Typography.caption.monospacedDigit())
                                .foregroundStyle(c.fg3)
                        }
                        IntensityShareBar(share: row.share, height: row.isDim ? 6 : 10, dim: row.isDim)
                    }
                }
                if let first = rows.first {
                    IntensityShareLegend(share: first.share)
                }
            }
        }
    }
}

@MainActor
private struct WeekHighlightsSection: View {
    let lines: [String]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Highlights") {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ForEach(lines, id: \.self) { line in
                    Text(line)
                        .font(Theme.Typography.bodySmall.monospacedDigit())
                        .foregroundStyle(c.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

@MainActor
private struct WeekNoteSection: View {
    let store: WeekStore
    let week: IsoWeek
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Week note") {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                TextField("How did the week go? What will you change next week?",
                          text: Binding(get: { store.note }, set: { store.note = $0 }), axis: .vertical)
                    .lineLimit(4...16)
                    .font(Theme.Typography.body)
                    .padding(Theme.Space.s)
                    .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                Text(store.noteState.text ?? "Saves as you type.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
                    .animation(Theme.Motion.fast, value: store.noteState)
            }
        }
        .task(id: store.note) {
            guard store.note != store.savedNote else { return }
            try? await Task.sleep(for: .milliseconds(900))
            if Task.isCancelled { return }
            if let client = model.client { await store.saveNote(client: client, model: model) }
        }
    }
}

@MainActor
private struct WeekNavigation: View {
    let vm: WeekReviewModel
    let go: @MainActor (IsoWeek) -> Void
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            if let next = vm.nextText {
                Text(next)
                    .font(Theme.Typography.bodySmall.monospacedDigit())
                    .foregroundStyle(c.fg2)
            }
            HStack {
                Button { go(vm.previousWeek) } label: {
                    Label("Week \(Format.weekLabel(vm.previousWeek).dropFirst())", systemImage: "chevron.left")
                }
                Spacer()
                Button { go(vm.nextWeek) } label: {
                    HStack(spacing: Theme.Space.xxs) {
                        Text("Week \(Format.weekLabel(vm.nextWeek).dropFirst())")
                        Image(systemName: "chevron.right")
                    }
                }
            }
            .buttonStyle(.bordered)
            .tint(c.fg2)
            .font(Theme.Typography.bodySmall)
        }
    }
}
