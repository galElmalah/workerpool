import SwiftUI
import CadenceKit

// The quieter parts of Today: freshness, wellness + morning check-in, the week strip, up next,
// pending logs, the day note and quick add. Each takes a CadenceKit model and draws it.

/// Form with its word, then Fitness and Fatigue — each number once.
@MainActor
struct FreshnessView: View {
    let model: FreshnessModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text("Form")
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                Text(model.formText)
                    .font(Theme.Typography.statLarge)
                    .foregroundStyle(c.fg1)
                    .contentTransition(.numericText(value: model.formValue ?? 0))
                if let word = model.zoneWord {
                    Text(word)
                        .font(Theme.Typography.title3.weight(.medium))
                        .foregroundStyle(c.fg2)
                }
            }
            HStack(spacing: Theme.Space.m) {
                stat("Fitness", model.fitnessText, model.fitnessValue, c)
                stat("Fatigue", model.fatigueText, model.fatigueValue, c)
            }
            if let summary = model.zoneSummary {
                Text(summary)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .animation(Theme.Motion.smooth, value: model.formValue)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityLabel)
    }

    private func stat(_ label: String, _ value: String, _ raw: Double?, _ c: ThemeColors) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label).foregroundStyle(c.fg3)
            Text(value)
                .foregroundStyle(c.fg1)
                .contentTransition(.numericText(value: raw ?? 0))
        }
        .font(Theme.Typography.numeric)
        .animation(Theme.Motion.smooth, value: raw)
    }
}

/// HRV · Resting HR · Sleep, readiness warnings, and the morning check-in.
@MainActor
struct WellnessView: View {
    let model: WellnessModel
    let onFeel: (Int?) -> Void
    let onSoreness: (Int?) -> Void
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Space.s))
                : AnyLayout(HStackLayout(alignment: .top, spacing: Theme.Space.m))
            layout {
                ForEach(model.metrics) { m in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.label)
                            .font(Theme.Typography.label)
                            .foregroundStyle(c.fg3)
                        HStack(alignment: .firstTextBaseline, spacing: 3) {
                            Text(m.valueText)
                                .font(Theme.Typography.statSmall)
                                .foregroundStyle(m.value == nil ? c.fg4 : c.fg1)
                                .contentTransition(.numericText(value: m.value ?? 0))
                            if m.value != nil {
                                Text(m.unit)
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(c.fg3)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(m.label) \(m.valueText) \(m.value == nil ? "" : m.unit)")
                    .accessibilityHint(m.context ?? "")
                }
            }
            if let reasons = model.reasonsText {
                Label {
                    Text(reasons).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(DataColor.warn)
                }
                .font(Theme.Typography.bodySmall)
                .foregroundStyle(c.fg1)
            }
            CheckInView(model: model, onFeel: onFeel, onSoreness: onSoreness)
                .id("check-in")
        }
    }
}

/// "How do you feel this morning?" five dots; soreness unfolds once feel is in.
@MainActor
struct CheckInView: View {
    let model: WellnessModel
    let onFeel: (Int?) -> Void
    let onSoreness: (Int?) -> Void
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            scale("How do you feel this morning?", labels: model.feelLabels, value: model.feel, onSelect: onFeel, c)
            if model.showsSoreness {
                scale("Soreness", labels: model.sorenessLabels, value: model.soreness, onSelect: onSoreness, c)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(Theme.Motion.smooth, value: model.showsSoreness)
    }

    private func scale(_ title: String, labels: [String], value: Int?, onSelect: @escaping (Int?) -> Void, _ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(title)
                .font(Theme.Typography.bodySmall)
                .foregroundStyle(c.fg2)
            HStack(spacing: Theme.Space.s) {
                ForEach(1...labels.count, id: \.self) { n in
                    let on = (value ?? 0) >= n
                    Button {
                        onSelect(value == n ? nil : n)
                    } label: {
                        Circle()
                            .fill(on ? c.fg2 : Color.clear)
                            .overlay(Circle().strokeBorder(on ? c.fg2 : c.line2, lineWidth: 1.5))
                            .frame(width: 22, height: 22)
                            .scaleEffect(value == n ? 1.15 : 1)
                            .frame(width: 44, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(n), \(labels[n - 1])")
                    .accessibilityAddTraits(value == n ? .isSelected : [])
                }
            }
            Text(LogScales.label(labels, value) ?? "Tap to rate")
                .font(Theme.Typography.caption)
                .foregroundStyle(value == nil ? c.fg4 : c.fg2)
                .contentTransition(.opacity)
        }
        .animation(Theme.Motion.snappy, value: value)
        .sensoryFeedback(.success, trigger: value) { old, new in new != nil && old != new }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

/// This week: seven days with their marks (status colours) and the key star, then hours done of plan.
@MainActor
struct WeekStripSection: View {
    let model: WeekStripModel
    @Environment(AppModel.self) private var app
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            HStack(alignment: .firstTextBaseline) {
                Text("This week")
                    .font(Theme.Typography.title3)
                    .foregroundStyle(c.fg1)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                NavigationLink(value: Route.week(model.isoWeek)) {
                    HStack(spacing: 2) {
                        Text(model.weekLabel)
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                }
                .accessibilityLabel("Week review \(model.weekLabel)")
            }
            HStack(spacing: 0) {
                ForEach(model.days) { day in
                    NavigationLink(value: Route.day(day.date)) {
                        dayCell(day, c)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(day.accessibilityLabel)
                }
            }
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Text("Hours")
                    .font(Theme.Typography.label)
                    .foregroundStyle(c.fg3)
                Text(model.hoursText)
                    .font(Theme.Typography.statMedium)
                    .foregroundStyle(c.fg1)
                    .contentTransition(.numericText(value: model.doneSec))
                    .animation(Theme.Motion.smooth, value: model.doneSec)
                ThinProgressBar(fraction: model.fraction)
                    .animation(Theme.Motion.gentle, value: model.fraction)
                Text(model.plannedText)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(model.accessibilityLabel)
        }
    }

    private func dayCell(_ day: StripDay, _ c: ThemeColors) -> some View {
        VStack(spacing: 6) {
            Text(day.label)
                .font(Theme.Typography.label)
                .foregroundStyle(day.isToday ? c.accentInk : c.fg3)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            HStack(spacing: 1) {
                if day.marks.isEmpty {
                    Circle().fill(c.fg4).frame(width: 4, height: 4)
                } else {
                    ForEach(Array(day.marks.enumerated()), id: \.offset) { _, m in
                        Image(systemName: m.symbol)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(DataColor.status(m.state) ?? (m.isDim ? c.fg4 : c.fg3))
                    }
                }
            }
            .frame(height: 12)
            Image(systemName: "star.fill")
                .font(.system(size: 8))
                .foregroundStyle(c.fg3)
                .opacity(day.hasKey ? 1 : 0)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Space.xs)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous)
                .fill(day.isToday ? c.surface2 : Color.clear)
        )
        .contentShape(Rectangle())
    }
}

/// Up next: tomorrow's sessions and the next race(s), as plain rows.
@MainActor
struct UpNextSection: View {
    let items: [UpNextItem]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Up next") {
            VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                ForEach(items) { item in
                    if let link = item.link, let route = route(for: link, item: item) {
                        NavigationLink(value: route) { row(item, c) }
                            .buttonStyle(.plain)
                            .zoomSource(route)
                    } else {
                        row(item, c)
                    }
                }
            }
        }
    }

    private func route(for link: DeepLink, item: UpNextItem) -> Route? {
        if case .nothingPlanned = item.kind, case .calendar(let d?) = link { return .day(d) }
        return Route(link)
    }

    private func row(_ item: UpNextItem, _ c: ThemeColors) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s) {
            switch item.kind {
            case .session(let sport):
                SportMark(sport: sport, size: 20)
            case .event(let priority):
                Image(systemName: priority == .a ? "flag.fill" : "flag")
                    .font(.subheadline)
                    .foregroundStyle(c.fg2)
                    .frame(width: 20, height: 20)
            case .nothingPlanned:
                Image(systemName: "moon.zzz")
                    .font(.subheadline)
                    .foregroundStyle(c.fg3)
                    .frame(width: 20, height: 20)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(item.isKey ? Theme.Typography.body.weight(.semibold) : Theme.Typography.body)
                    .foregroundStyle(item.kind == .nothingPlanned ? c.fg3 : c.fg1)
                    .lineLimit(2)
                if !item.detail.isEmpty {
                    Text(item.detail)
                        .font(Theme.Typography.numeric)
                        .foregroundStyle(c.fg3)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if item.isKey { KeyStarMark(isKey: true, font: .caption) }
        }
        .padding(.vertical, Theme.Space.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// An unlogged session from an earlier day: one line until "Log it" opens the logger.
@MainActor
struct PendingLogRow: View {
    let item: PendingLogItem
    let onLog: (QuickLogChange) -> Void
    @Environment(\.cadenceAccent) private var accent
    @State private var open = false

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(spacing: Theme.Space.s) {
                SportMark(sport: item.sport, size: 18)
                NavigationLink(value: Route.activity(id: item.activityId)) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.title)
                            .font(Theme.Typography.body.weight(.medium))
                            .foregroundStyle(c.fg1)
                            .lineLimit(2)
                        Text(item.dayText)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(c.fg3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                Button(open ? "Close" : "Log it") {
                    withAnimation(Theme.Motion.smooth) { open.toggle() }
                }
                .buttonStyle(.bordered)
                .tint(c.fg2)
                .font(Theme.Typography.bodySmall)
            }
            if open {
                QuickLogView(activityId: item.activityId, rpe: item.rpe, feel: item.feel, note: item.note ?? "", onChange: onLog)
                    .padding(.leading, 30)
                    .padding(.bottom, Theme.Space.s)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

/// The day note: saves as you type (debounced), shows in the journal.
@MainActor
struct DayNoteEditor: View {
    let date: LocalDate
    let initial: String
    var onSaved: ((String) -> Void)? = nil
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var draft = ""
    @State private var saved: String? = nil
    @State private var state: SaveState = .idle

    enum SaveState: Equatable { case idle, saving, saved, failed }

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            TextField("How did today go? Sleep, legs, life\u{2026}", text: $draft, axis: .vertical)
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg1)
                .lineLimit(3...10)
                .padding(Theme.Space.s)
                .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .accessibilityLabel("Day note")
            Text(stateText)
                .font(Theme.Typography.caption)
                .foregroundStyle(c.fg3)
                .contentTransition(.opacity)
                .animation(Theme.Motion.fast, value: state)
        }
        .onAppear { syncFromServer() }
        .onChange(of: initial) { _, _ in syncFromServer() }
        .task(id: draft) { await autosave() }
    }

    private var stateText: String {
        switch state {
        case .idle: return "Saves as you type \u{00B7} shows in the journal"
        case .saving: return "Saving\u{2026}"
        case .saved: return "Saved"
        case .failed: return "Not saved \u{2014} will retry when you edit"
        }
    }

    private func syncFromServer() {
        // never overwrite text the person is typing
        if saved == nil || draft == saved {
            draft = initial
            saved = initial
        }
    }

    private func autosave() async {
        guard let saved, draft != saved, let client = model.client else { return }
        try? await Task.sleep(for: .milliseconds(900))
        guard !Task.isCancelled else { return }
        state = .saving
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await client.setDayNote(date: date, body: body)
            self.saved = draft
            state = .saved
            onSaved?(body)
            await model.didWriteQuietly()
        } catch {
            state = .failed
        }
    }
}

/// Quick add with the server grammar: "run 45m easy", "bike 1h30 z2", "swim 2500m css".
@MainActor
struct QuickAddField: View {
    let date: LocalDate
    var local: ((LocalEdit) -> Void)? = nil
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var text = ""
    @State private var busy = false
    @State private var issues: [String] = []
    @State private var added = 0
    @FocusState private var focused: Bool

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(spacing: Theme.Space.s) {
                Image(systemName: "plus")
                    .font(.subheadline)
                    .foregroundStyle(c.fg3)
                TextField("Quick add \u{00B7} run 45m easy", text: $text)
                    .font(Theme.Typography.body)
                    .foregroundStyle(c.fg1)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($focused)
                    .onSubmit(add)
                if busy {
                    ProgressView()
                } else if !text.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button("Add", action: add)
                        .font(Theme.Typography.bodySmall.weight(.semibold))
                        .foregroundStyle(c.fg1)
                        .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, Theme.Space.s)
            .frame(minHeight: 44)
            .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            ForEach(issues, id: \.self) { issue in
                Label(issue, systemImage: "info.circle")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg2)
            }
        }
        .sensoryFeedback(.success, trigger: added)
        .animation(Theme.Motion.snappy, value: issues)
    }

    private func add() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !busy else { return }
        busy = true
        Task {
            if let res = await model.quickAdd(date: date, text: t, local: local) {
                text = ""
                added += 1
                issues = res.issues.filter { $0.severity != "info" }.map(\.message)
            }
            busy = false
        }
    }
}
