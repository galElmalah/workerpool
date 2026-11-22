import SwiftUI
import CadenceKit

/// The workout page (`Route.workout`): title, sport and day, the plan's numbers (each once), key and
/// intensity, "Send to watch", the step profile (height = intensity, colour = zone) and the steps as
/// a clean list, notes that save as you type, and the paired activity once done.
@MainActor
struct WorkoutScreen: View {
    let id: String
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var remote = Remote<PlannedWorkout>()
    @State private var noteDraft = ""
    @State private var noteLoadedFor: String? = nil
    @State private var noteState: NoteSave = .idle
    @State private var sending = false
    @State private var keyTaps = 0

    enum NoteSave: Equatable { case idle, saving, saved, failed }

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                if let w = remote.value {
                    content(WorkoutScreenModel.build(w, units: model.units, today: model.today), c)
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
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .navigationTitle("Workout")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { actionsMenu }
        }
        .task(id: model.dataVersion) { await load() }
        .task(id: noteDraft) { await saveNote() }
        .sensoryFeedback(.impact(weight: .light), trigger: keyTaps)
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ m: WorkoutScreenModel, _ c: ThemeColors) -> some View {
        header(m, c)

        if !m.stats.isEmpty {
            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Space.m))
                : AnyLayout(HStackLayout(alignment: .top, spacing: Theme.Space.l))
            layout {
                ForEach(m.stats) { s in
                    LabelledStat(label: s.label, value: s.value, unit: s.unit, size: .medium)
                }
            }
        }

        controls(m, c)

        if m.canSendToWatch || m.garminText != nil || m.pairedActivityId != nil {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                if let activity = m.pairedActivityId {
                    NavigationLink(value: Route.activity(id: activity)) {
                        HStack {
                            Label("See the completed activity", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(c.fg1)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(c.fg3)
                        }
                        .font(Theme.Typography.body)
                        .padding(Theme.Space.m)
                        .background(DataColor.sportTint(m.sport), in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .zoomSource(.activity(id: activity))
                } else if m.canSendToWatch {
                    Button(action: send) {
                        if sending {
                            ProgressView().tint(c.onAccent)
                        } else {
                            Label(m.sendTitle, systemImage: "applewatch.radiowaves.left.and.right")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(sending)
                }
                if let g = m.garminText {
                    Text(g)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(c.fg3)
                }
            }
        }

        if !m.profile.isEmpty {
            ScreenSection("Profile") {
                StepProfileChart(profile: m.profile)
            }
        }

        if !m.steps.isEmpty {
            ScreenSection("Steps") {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(m.steps) { step in
                        StepRowView(step: step)
                        if step.id != m.steps.last?.id {
                            Divider().overlay(c.line1).padding(.leading, CGFloat(step.depth) * 16 + 20)
                        }
                    }
                }
            }
        }

        if let description = m.description {
            ScreenSection("About") {
                Text(description)
                    .font(Theme.Typography.body)
                    .foregroundStyle(c.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        ScreenSection("Notes") {
            TextField("Notes for this session \u{2014} cues, fuelling, route\u{2026}", text: $noteDraft, axis: .vertical)
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg1)
                .lineLimit(3...10)
                .padding(Theme.Space.s)
                .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .accessibilityLabel("Notes")
            Text(noteStatusText)
                .font(Theme.Typography.caption)
                .foregroundStyle(c.fg3)
                .animation(Theme.Motion.fast, value: noteState)
        }

        if let tags = m.tagsText {
            Text(tags)
                .font(Theme.Typography.caption)
                .foregroundStyle(c.fg3)
        }
    }

    private func header(_ m: WorkoutScreenModel, _ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(spacing: Theme.Space.xs) {
                SportMark(sport: m.sport, size: 22)
                Text(m.sportText)
                    .font(Theme.Typography.label)
                    .foregroundStyle(c.fg3)
                    .lineLimit(1)
            }
            Text(m.title)
                .font(Theme.Typography.title1)
                .foregroundStyle(m.isSkipped ? c.fg3 : c.fg1)
                .lineLimit(4)
                .minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(m.dateLine + Format.dot + m.relativeText)
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg2)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                Image(systemName: m.statusSymbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor(m, c))
                Text(m.statusText)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
            }
            .accessibilityElement(children: .combine)
            if remote.isOffline { OfflineNotice(storedAt: remote.storedAt) }
        }
    }

    private func statusColor(_ m: WorkoutScreenModel, _ c: ThemeColors) -> Color {
        guard let w = remote.value else { return c.fg3 }
        let state: ComplianceState = w.status == .skipped ? .excused : (w.compliance?.state ?? .planned)
        return DataColor.status(state) ?? c.fg3
    }

    private func controls(_ m: WorkoutScreenModel, _ c: ThemeColors) -> some View {
        HStack(spacing: Theme.Space.s) {
            Button(action: toggleKey) {
                HStack(spacing: 6) {
                    KeyStarMark(isKey: m.isKey, font: .subheadline)
                    Text(m.isKey ? "Key session" : "Mark as key")
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg1)
                }
                .padding(.horizontal, Theme.Space.s)
                .padding(.vertical, Theme.Space.xs)
                .background(m.isKey ? c.surfaceActive : c.surface2, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Key session")
            .accessibilityValue(m.isKey ? "On" : "Off")
            .accessibilityAddTraits(.isToggle)

            Menu {
                Picker("Intensity", selection: Binding(get: { m.intensity }, set: { setIntensity($0) })) {
                    ForEach(IntensityClass.knownCases, id: \.self) { i in
                        Text(i.label).tag(i)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    ZoneDot(intensity: m.intensity, diameter: 8)
                    Text(m.intensityText)
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2)
                        .foregroundStyle(c.fg3)
                }
                .padding(.horizontal, Theme.Space.s)
                .padding(.vertical, Theme.Space.xs)
                .background(c.surface2, in: Capsule())
            }
            .accessibilityLabel("Intensity, \(m.intensityText)")
            Spacer(minLength: 0)
        }
    }

    private var actionsMenu: some View {
        Menu {
            if let w = remote.value {
                Button { model.push(.editWorkout(id: w.id)) } label: { Label("Edit", systemImage: "pencil") }
                Button { model.push(.moveWorkout(id: w.id, from: w.date, copy: false)) } label: { Label("Move to\u{2026}", systemImage: "calendar") }
                Button { model.push(.moveWorkout(id: w.id, from: w.date, copy: true)) } label: { Label("Duplicate to\u{2026}", systemImage: "plus.square.on.square") }
                if w.status == .skipped {
                    Button {
                        Task { await model.skipWorkout(id: w.id, title: w.title, reason: nil, local: { applyLocal($0) }) }
                    } label: { Label("Unskip", systemImage: "arrow.uturn.backward") }
                } else if w.pairedActivityId == nil {
                    Menu {
                        ForEach(SkipReason.knownCases, id: \.self) { r in
                            Button(r.label) {
                                Task { await model.skipWorkout(id: w.id, title: w.title, reason: r, local: { applyLocal($0) }) }
                            }
                        }
                    } label: { Label("Skip", systemImage: "minus.circle") }
                }
                Divider()
                Button(role: .destructive) {
                    Task {
                        if await model.deleteWorkout(id: w.id, title: w.title) { dismiss() }
                    }
                } label: { Label("Delete", systemImage: "trash") }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Workout actions")
    }

    private var noteStatusText: String {
        switch noteState {
        case .idle: return "Saves as you type"
        case .saving: return "Saving\u{2026}"
        case .saved: return "Saved"
        case .failed: return "Not saved \u{2014} will retry when you edit"
        }
    }

    // MARK: Actions

    private func load() async {
        guard let client = model.client else { return }
        let id = self.id
        await remote.load(cached: { client.cached(Endpoints.workout(id: id)) }, fetch: { try await client.workout(id: id) })
        if let w = remote.value, noteLoadedFor != w.id || noteDraft == (w.preNote ?? "") {
            noteLoadedFor = w.id
            noteDraft = w.preNote ?? ""
        }
    }

    private func applyLocal(_ edit: LocalEdit) {
        withAnimation(Theme.Motion.smooth) {
            remote.update { w in
                var w = w
                switch edit {
                case .upserted(let fresh): if fresh.id == w.id { w = fresh }
                case .key(let id, let isKey): if id == w.id { w.isKey = isKey }
                case .skipped(let id, let reason): if id == w.id { w.applySkip(reason) }
                case .moved(let id, let date): if id == w.id { w.date = date }
                case .removed, .restored: break
                }
                return w
            }
        }
    }

    private func toggleKey() {
        guard let w = remote.value else { return }
        keyTaps += 1
        Task { await model.setWorkoutKey(id: w.id, !w.isKey, local: { applyLocal($0) }) }
    }

    private func setIntensity(_ i: IntensityClass) {
        guard let client = model.client, let w = remote.value, i != w.intensity else { return }
        withAnimation(Theme.Motion.snappy) { remote.update { var x = $0; x.intensity = i; return x } }
        Task {
            do {
                let fresh = try await client.setWorkoutIntensity(id: w.id, i)
                remote.set(fresh)
                await model.didWrite()
            } catch {
                withAnimation(Theme.Motion.snappy) { remote.update { var x = $0; x.intensity = w.intensity; return x } }
                model.showError(error, doing: "change the intensity")
            }
        }
    }

    private func send() {
        guard let w = remote.value, !sending else { return }
        sending = true
        Task {
            if let link = await model.sendToWatch(id: w.id, title: w.title) {
                remote.update { var x = $0; x.garmin = link; return x }
            }
            sending = false
        }
    }

    private func saveNote() async {
        guard let client = model.client, let w = remote.value, noteLoadedFor == w.id else { return }
        let text = noteDraft
        guard text != (w.preNote ?? "") else { return }
        try? await Task.sleep(for: .milliseconds(900))
        guard !Task.isCancelled else { return }
        noteState = .saving
        do {
            let fresh = try await client.setWorkoutNote(id: w.id, text.trimmingCharacters(in: .whitespacesAndNewlines))
            remote.update { var x = $0; x.preNote = fresh.preNote; return x }
            noteState = .saved
            await model.didWriteQuietly()
        } catch {
            noteState = .failed
        }
    }
}

/// One step: a zone-coloured dot, the step name, its amount on the right; target and notes below.
/// Repeat headers ("2 ×") group the indented steps that follow.
@MainActor
struct StepRowView: View {
    let step: StepRowModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                if let ramp = step.rampIndex {
                    Circle()
                        .fill(DataColor.zone(ramp))
                        .frame(width: 8, height: 8)
                        .alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 1 }
                } else if step.kind == .repeatHeader {
                    Image(systemName: "repeat")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(c.fg3)
                } else {
                    Color.clear.frame(width: 8, height: 8)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(step.title)
                        .font(step.kind == .repeatHeader ? Theme.Typography.body.weight(.semibold) : Theme.Typography.body)
                        .foregroundStyle(c.fg1)
                        .lineLimit(2)
                    if let role = step.roleText {
                        Text(role)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(c.fg3)
                            .lineLimit(1)
                    }
                }
                .layoutPriority(1)
                Spacer(minLength: Theme.Space.xs)
                Text(step.amountText)
                    .font(Theme.Typography.numeric)
                    .foregroundStyle(step.kind == .repeatHeader ? c.fg3 : c.fg1)
                    .fixedSize()
            }
            let extra = [step.targetText, step.note].compactMap { $0 }
            if !extra.isEmpty {
                Text(extra.joined(separator: Format.dot))
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 8 + Theme.Space.s)
            }
        }
        .padding(.vertical, Theme.Space.s)
        .padding(.leading, CGFloat(step.depth) * 16)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(step.accessibilityLabel)
    }
}

/// Step profile: one bar per step (ramps as a staircase), height = intensity, colour = zone.
/// Grows in on appear (skipped with Reduce Motion).
@MainActor
struct StepProfileChart: View {
    let profile: StepProfile
    var height: CGFloat = 96
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grown = false

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            GeometryReader { geo in
                ZStack(alignment: .bottomLeading) {
                    Rectangle()
                        .fill(c.line1)
                        .frame(height: 1)
                    ForEach(profile.bars) { bar in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(DataColor.zone(bar.rampIndex))
                            .frame(width: max(1, geo.size.width * bar.width - 1),
                                   height: max(2, geo.size.height * bar.height * (grown ? 1 : 0.05)))
                            .offset(x: geo.size.width * bar.start)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height, alignment: .bottomLeading)
            }
            .frame(height: height)
            HStack {
                Text("0:00")
                Spacer()
                Text(Format.duration(profile.totalSec, style: .clock))
            }
            .font(Theme.Typography.caption.monospacedDigit())
            .foregroundStyle(c.fg3)
        }
        .onAppear {
            if reduceMotion { grown = true } else { withAnimation(Theme.Motion.gentle.delay(0.1)) { grown = true } }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step profile, about \(Format.duration(profile.totalSec, style: .short))")
    }
}
