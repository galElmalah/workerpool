import SwiftUI
import CadenceKit

/// The day page (`Route.day`): every session as a full card (long-press for move / copy / skip /
/// delete), races, markers and phase, the day note, wellness, quick add and the week summary.
@MainActor
struct DayScreen: View {
    let date: LocalDate
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var remote = Remote<CalendarResponse>()

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                if let cal = remote.value {
                    content(CalendarModels.day(date, calendar: cal, today: cal.today, units: model.units), c)
                } else if remote.failedEmpty {
                    FailedBlock(error: remote.error) { Task { await load() } }
                } else {
                    LoadingBlock()
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.bottom, Theme.Space.xxl)
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .refreshable { await load() }
        .navigationTitle(Format.dateLong(date))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.newWorkout(date: date)) {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New workout on this day")
            }
        }
        .task(id: model.dataVersion) { await load() }
    }

    @ViewBuilder
    private func content(_ d: DayScreenModel, _ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(d.subtitle)
                .font(Theme.Typography.label)
                .foregroundStyle(d.isToday ? c.accentInk : c.fg3)
            let furniture = [d.phaseText, d.markersText].compactMap { $0 }
            if !furniture.isEmpty {
                Text(furniture.joined(separator: Format.dot))
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
            }
            if remote.isOffline { OfflineNotice(storedAt: remote.storedAt) }
        }

        if !d.events.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ForEach(d.events) { e in
                    NavigationLink(value: Route.event(id: e.id)) {
                        HStack(alignment: .top, spacing: Theme.Space.s) {
                            Image(systemName: "flag.fill")
                                .foregroundStyle(c.fg2)
                                .frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.name)
                                    .font(Theme.Typography.body.weight(.semibold))
                                    .foregroundStyle(c.fg1)
                                    .lineLimit(2)
                                Text(e.detail)
                                    .font(Theme.Typography.bodySmall)
                                    .foregroundStyle(c.fg3)
                            }
                            Spacer(minLength: 0)
                        }
                        .cadenceCard(padding: Theme.Space.m)
                    }
                    .buttonStyle(.plain)
                    .zoomSource(.event(id: e.id))
                }
            }
        }

        ScreenSection("Sessions") {
            if d.sessions.isEmpty {
                Text(d.isPast ? "Nothing done or planned." : "Nothing planned.")
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg3)
            } else {
                VStack(spacing: Theme.Space.m) {
                    ForEach(d.sessions) { card in
                        SessionCardView(card: card, showsLog: true) { change in
                            if let id = card.activityId { log(id, change) }
                        }
                        .contextMenu { SessionMenuItems(card: card, local: { apply($0) }) }
                    }
                }
                .animation(Theme.Motion.smooth, value: d.sessions)
            }
            QuickAddField(date: date, local: { apply($0) })
                .padding(.top, Theme.Space.xs)
            NavigationLink(value: Route.newWorkout(date: date)) {
                Label("New workout", systemImage: "plus")
                    .font(Theme.Typography.bodySmall)
            }
            .foregroundStyle(c.fg2)
            .zoomSource(.newWorkout(date: date))
        }

        ScreenSection("Note") {
            DayNoteEditor(date: date, initial: d.note) { body in
                remote.update { $0.settingDayNote(date: date, body: body) }
            }
        }

        if let w = d.wellnessText {
            ScreenSection("Wellness") {
                Text(w)
                    .font(Theme.Typography.numeric)
                    .foregroundStyle(c.fg2)
            }
        }

        if let week = d.week {
            WeekSummaryCard(line: week)
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        let d = date
        await remote.load(cached: { client.cached(Endpoints.calendar(from: d, to: d)) },
                          fetch: { try await client.calendar(from: d, to: d) })
    }

    private func apply(_ edit: LocalEdit) {
        withAnimation(Theme.Motion.smooth) { remote.update { edit.apply(to: $0) } }
    }

    private func log(_ activityId: String, _ change: QuickLogChange) {
        withAnimation(Theme.Motion.snappy) {
            remote.update { cal in
                cal.updatingActivity(id: activityId) { a in
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
