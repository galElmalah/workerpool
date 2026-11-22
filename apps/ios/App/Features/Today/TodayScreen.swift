import SwiftUI
import CadenceKit

/// Today — "what do I do today, and am I fresh?" A one-sentence status, today's session(s) as the
/// hero (with the quick log once done, "Send to watch" while planned), freshness, wellness and the
/// morning check-in, the week so far, up next, unlogged sessions, the day note and quick add.
/// Cached data paints first; pull to refresh.
@MainActor
struct TodayScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var remote = Remote<TodayResponse>()
    @State private var checkIns = 0

    var body: some View {
        let c = Theme.colors(accent)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    if let t = remote.value {
                        content(TodayScreenModel.build(t, units: model.units, tomorrow: model.tomorrowSessions(after: t.date)), c)
                    } else if remote.failedEmpty {
                        FailedBlock(error: remote.error) { Task { await load() } }
                    } else {
                        LoadingBlock()
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.top, Theme.Space.xs)
                .padding(.bottom, Theme.Space.xxl)
                .frame(maxWidth: 700)
                .frame(maxWidth: .infinity)
            }
            // cadence://checkin/<date> (Check-in widget): may arrive before this screen exists or
            // before its content loaded, so check on appear and again once content is there.
            .onChange(of: model.focusCheckIn, initial: true) { _, _ in focusCheckInIfNeeded(proxy) }
            .onChange(of: remote.value == nil) { _, _ in focusCheckInIfNeeded(proxy) }
        }
        .screenBackground()
        .refreshable {
            await load()
            await model.refresh()
        }
        .navigationTitle("Today")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.newWorkout(date: remote.value?.date ?? model.today)) {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New workout")
            }
        }
        .task(id: model.dataVersion) { await load() }
        .sensoryFeedback(.success, trigger: checkIns)
    }

    private func focusCheckInIfNeeded(_ proxy: ScrollViewProxy) {
        guard model.focusCheckIn, remote.value != nil else { return }
        model.focusCheckIn = false
        Task { @MainActor in
            // one runloop later, so the check-in card is laid out before scrolling to it
            withAnimation(Theme.Motion.smooth) { proxy.scrollTo("check-in", anchor: .center) }
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ m: TodayScreenModel, _ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(m.eyebrow)
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
            Text(m.statusSentence)
                .font(.title3)
                .foregroundStyle(c.fg2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHint(m.readinessNote ?? "")
            if remote.isOffline {
                OfflineNotice(storedAt: remote.storedAt)
                    .padding(.top, Theme.Space.xxs)
            }
        }

        sessions(m, c)

        FreshnessView(model: m.freshness)

        WellnessView(model: m.wellness,
                     onFeel: { v in checkIn(feel: v, soreness: nil, date: m.date) },
                     onSoreness: { v in checkIn(feel: nil, soreness: v, date: m.date) })

        WeekStripSection(model: m.week)

        if !m.upNext.isEmpty {
            UpNextSection(items: m.upNext)
        }

        if !m.pendingLogs.isEmpty {
            ScreenSection("Log how it went") {
                Text("Two taps for each: how hard, how it felt.")
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg3)
                ForEach(m.pendingLogs) { item in
                    PendingLogRow(item: item) { change in log(item.activityId, change) }
                }
            }
        }

        ScreenSection("Note") {
            DayNoteEditor(date: m.date, initial: m.dayNote)
            QuickAddField(date: m.date, local: { apply($0) })
                .padding(.top, Theme.Space.xs)
        }
    }

    @ViewBuilder
    private func sessions(_ m: TodayScreenModel, _ c: ThemeColors) -> some View {
        ScreenSection(m.markersText == nil ? "Sessions" : "Sessions \u{00B7} \(m.markersText ?? "")") {
            if m.isRestDay {
                RestDayCard(date: m.date, planned: m.restIsPlanned, local: { apply($0) })
            } else {
                VStack(spacing: Theme.Space.m) {
                    ForEach(m.sessions) { card in
                        SessionCardView(card: card, showsLog: true) { change in
                            if let id = card.activityId { log(id, change) }
                        }
                        .contextMenu { SessionMenuItems(card: card, local: { apply($0) }) }
                    }
                }
                .animation(Theme.Motion.smooth, value: m.sessions)
            }
        }
    }

    // MARK: Actions

    private func load() async {
        guard let client = model.client else { return }
        await remote.load(cached: { client.cached(Endpoints.today()) }, fetch: { try await client.today() })
    }

    private func apply(_ edit: LocalEdit) {
        withAnimation(Theme.Motion.smooth) { remote.update { edit.apply(to: $0) } }
    }

    private func checkIn(feel: Int?, soreness: Int?, date: LocalDate) {
        guard let client = model.client else { return }
        var input = WellnessCheckIn()
        if let feel { input.feel = Nullable(feel) }
        if let soreness { input.soreness = Nullable(soreness) }
        // nil from a tap on the selected dot clears it
        if feel == nil && soreness == nil { return }
        withAnimation(Theme.Motion.smooth) {
            remote.update { $0.checkingIn(feel: feel.map { Optional($0) }, soreness: soreness.map { Optional($0) }) }
        }
        checkIns += 1
        Task {
            do {
                _ = try await client.checkIn(date: date, input)
                await model.didWrite()
            } catch {
                model.showError(error, doing: "save the check-in")
            }
        }
    }

    private func log(_ activityId: String, _ change: QuickLogChange) {
        withAnimation(Theme.Motion.snappy) {
            remote.update { t in
                t.updatingActivity(id: activityId) { a in
                    switch change {
                    case .rpe(let v): a.rpe = v
                    case .feel(let v): a.feel = v
                    case .note(let n): a.postNote = n.isEmpty ? nil : n
                    }
                }
            }
        }
        Task {
            switch change {
            case .rpe(let v): await model.logActivity(id: activityId, rpe: .some(v))
            case .feel(let v): await model.logActivity(id: activityId, feel: .some(v))
            case .note(let n): await model.logActivity(id: activityId, note: .some(n))
            }
        }
    }
}

/// Rest day: a quiet card; "Add something anyway" opens quick add in place.
@MainActor
private struct RestDayCard: View {
    let date: LocalDate
    let planned: Bool
    let local: (LocalEdit) -> Void
    @Environment(\.cadenceAccent) private var accent
    @State private var adding = false

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Image(systemName: "moon.zzz")
                .font(.title3)
                .foregroundStyle(c.fg3)
            VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                Text("Rest day. Nothing planned.")
                    .font(Theme.Typography.title2)
                    .foregroundStyle(c.fg1)
                Text(planned ? "A planned rest day \u{2014} recovery is where the training lands."
                     : "Recovery is where the training lands. Easy walk, early night.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(c.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if adding {
                QuickAddField(date: date, local: local)
                    .transition(.opacity)
            } else {
                Button {
                    withAnimation(Theme.Motion.smooth) { adding = true }
                } label: {
                    Label("Add something anyway", systemImage: "plus")
                        .font(Theme.Typography.bodySmall)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(c.fg2)
            }
        }
        .cadenceCard()
    }
}
