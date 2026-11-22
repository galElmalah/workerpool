import SwiftUI
import CadenceKit

/// Pick the day to move (or copy) a workout to (`Route.moveWorkout`): the system calendar picker,
/// a few one-tap choices, then one primary button. A page rather than a sheet.
@MainActor
struct MoveWorkoutScreen: View {
    let workoutId: String
    let from: LocalDate
    let copy: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dismiss) private var dismiss
    @State private var target: LocalDate
    @State private var title = ""
    @State private var busy = false

    init(workoutId: String, from: LocalDate, copy: Bool) {
        self.workoutId = workoutId
        self.from = from
        self.copy = copy
        _target = State(initialValue: Day(from)?.adding(days: 1).string ?? from)
    }

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                    Text(title.isEmpty ? "Workout" : title)
                        .font(Theme.Typography.title3)
                        .foregroundStyle(c.fg1)
                        .lineLimit(2)
                    Text("Now on \(Format.dateMedium(from))")
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg3)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Space.xs) {
                        ForEach(CalendarModels.quickMoveTargets(from: from)) { t in
                            Button(t.label) {
                                withAnimation(Theme.Motion.snappy) { target = t.date }
                            }
                            .buttonStyle(.bordered)
                            .tint(target == t.date ? c.fg1 : c.fg3)
                        }
                    }
                }

                DatePicker("Day", selection: Binding(get: { PickerDate.date(target) }, set: { target = PickerDate.local($0) }),
                           displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .padding(Theme.Space.s)
                    .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))

                Button(action: commit) {
                    if busy {
                        ProgressView().tint(c.onAccent)
                    } else {
                        Text("\(copy ? "Copy" : "Move") to \(Format.dateMedium(target))")
                            .contentTransition(.numericText())
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || (!copy && target == from))
                .animation(Theme.Motion.snappy, value: target)
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.bottom, Theme.Space.xxl)
            .frame(maxWidth: 600)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .navigationTitle(copy ? "Duplicate to" : "Move to")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard title.isEmpty, let client = model.client else { return }
            if let cached = client.cached(Endpoints.workout(id: workoutId)) { title = cached.value.title }
            if let w = try? await client.workout(id: workoutId) { title = w.title }
        }
    }

    private func commit() {
        guard !busy else { return }
        busy = true
        let name = title.isEmpty ? "workout" : title
        Task {
            let ok: Bool
            if copy {
                ok = await model.duplicateWorkout(id: workoutId, title: name, to: target) != nil
            } else {
                ok = await model.moveWorkout(id: workoutId, title: name, from: from, to: target)
            }
            busy = false
            if ok { dismiss() }
        }
    }
}

/// A race / event (`Route.event`): name, date and countdown, priority, sport and distance, goal,
/// location and note.
@MainActor
struct EventScreen: View {
    let id: String
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var remote = Remote<[Event]>()

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                if let e = remote.value?.first(where: { $0.id == id }) {
                    content(e, c)
                } else if remote.failedEmpty || (remote.value != nil && !remote.isLoading) {
                    EmptyState(symbol: "flag", title: "Event not found", message: remote.error?.message)
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
        .navigationTitle("Race")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.dataVersion) { await load() }
    }

    @ViewBuilder
    private func content(_ e: Event, _ c: ThemeColors) -> some View {
        let daysTo = Day(model.today).flatMap { t in Day(e.date).map { t.days(until: $0) } } ?? 0
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(e.priority.label)
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
            Text(e.name)
                .font(Theme.Typography.title1)
                .foregroundStyle(c.fg1)
                .fixedSize(horizontal: false, vertical: true)
            Text(Format.dateLong(e.date, withYear: true))
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg2)
            if remote.isOffline { OfflineNotice(storedAt: remote.storedAt) }
        }
        if daysTo >= 0 {
            LabelledStat(label: "Countdown", value: Format.countdown(daysTo: daysTo), size: .display)
                .contentTransition(.numericText(value: Double(daysTo)))
        }
        HStack(alignment: .top, spacing: Theme.Space.l) {
            if let s = e.sport, s != .unknown {
                VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                    Text("Sport").font(Theme.Typography.label).foregroundStyle(c.fg3)
                    HStack(spacing: 6) {
                        SportMark(sport: s, size: 18)
                        Text(s.label).font(Theme.Typography.statSmall).foregroundStyle(c.fg1)
                    }
                }
                if let d = e.distanceM, d > 0 {
                    let p = Format.distanceParts(d, sport: s, units: model.units)
                    LabelledStat(label: "Distance", value: p.value, unit: p.unit, size: .small)
                }
            }
        }
        if let goal = e.goal, !goal.isEmpty { detail("Goal", goal, c) }
        if let loc = e.location, !loc.isEmpty { detail("Location", loc, c) }
        if let note = e.note, !note.isEmpty { detail("Note", note, c) }
        if let a = e.resultActivityId {
            NavigationLink(value: Route.activity(id: a)) {
                Label("Race result", systemImage: "flag.checkered")
            }
            .zoomSource(.activity(id: a))
        }
    }

    private func detail(_ label: String, _ text: String, _ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            Text(label).font(Theme.Typography.label).foregroundStyle(c.fg3)
            Text(text)
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg1)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        await remote.load(cached: { client.cached(Endpoints.events()) }, fetch: { try await client.events() })
    }
}
