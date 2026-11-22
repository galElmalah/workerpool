import SwiftUI
import Charts
import CadenceKit

// The sections of the activity page. Each one only lays out strings and series from
// `ActivityDetailModel` / `StreamChartModel` (CadenceKit).

// MARK: - Hero

@MainActor
struct ActivityHero: View {
    let vm: ActivityDetailModel
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack(spacing: Theme.Space.xs) {
                    SportMark(sport: vm.sport, size: 20)
                    Text(vm.kindText)
                        .font(Theme.Typography.label)
                        .foregroundStyle(c.fg3)
                        .lineLimit(1)
                    if vm.isKey {
                        Image(systemName: "star.fill")
                            .font(.caption2)
                            .foregroundStyle(c.fg3)
                            .accessibilityLabel("Key session")
                    }
                }
                Text(vm.title)
                    .font(Theme.Typography.title1)
                    .foregroundStyle(c.fg1)
                    .lineLimit(3)
                    .accessibilityAddTraits(.isHeader)
                Text(vm.whenText)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                if let place = vm.locationText {
                    Label(place, systemImage: "mappin.and.ellipse")
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg2)
                        .lineLimit(1)
                }
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Space.l) {
                ForEach(vm.figures) { f in
                    LabelledStat(label: f.label, value: f.value, unit: f.unit, context: f.context, size: .large)
                        .contentTransition(.numericText())
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(Text(f.accessibilityText))
                }
            }
        }
    }

    private var columns: [GridItem] {
        let n = typeSize.isAccessibilitySize ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: Theme.Space.m, alignment: .topLeading), count: n)
    }
}

// MARK: - Plan vs actual

@MainActor
struct PlanVersusActual: View {
    let plan: PlanComparisonModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        NavigationLink(value: Route.workout(id: plan.workoutId)) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                    Image(systemName: plan.tone.symbol)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(toneColor(plan.tone, c))
                        .accessibilityHidden(true)
                    Text(plan.stateLabel)
                        .font(Theme.Typography.body.weight(.semibold))
                        .foregroundStyle(c.fg1)
                    Text(plan.detail)
                        .font(Theme.Typography.bodySmall.monospacedDigit())
                        .foregroundStyle(c.fg2)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                ThinProgressBar(fraction: plan.fraction)
                HStack(spacing: Theme.Space.xxs) {
                    Text("Planned: \(plan.workoutTitle)")
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg2)
                        .lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(c.fg3)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(plan.accessibilityText))
        .accessibilityHint("Opens the planned workout")
    }
}

/// Status colour for a tone (always next to a symbol or word).
func toneColor(_ tone: AnalysisTone, _ c: ThemeColors) -> Color {
    switch tone {
    case .good: return DataColor.good
    case .warn: return DataColor.warn
    case .serious: return DataColor.serious
    case .critical: return DataColor.critical
    case .neutral: return c.fg3
    }
}

// MARK: - Charts

@MainActor
struct ActivityChartsSection: View {
    let store: ActivityStore
    let chart: StreamChartModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Charts") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                readoutLine(c)
                ForEach(chart.tracks) { track in
                    VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                            ChartKey(color: StreamColor.color(track.metric, accent: accent), label: track.label)
                            if let s = track.summary {
                                Text(s)
                                    .font(Theme.Typography.caption.monospacedDigit())
                                    .foregroundStyle(c.fg3)
                            }
                            Spacer(minLength: 0)
                        }
                        TrackChart(model: chart, track: track,
                                   height: track.isPrimary ? 180 : 96,
                                   showsXAxis: track.id == chart.tracks.last?.id,
                                   showsElevation: track.isPrimary && chart.elevation != nil,
                                   selection: Binding(get: { store.selection }, set: { store.selection = $0 }))
                    }
                }
                if let e = chart.elevation, let s = e.summary {
                    HStack(spacing: Theme.Space.xs) {
                        ChartKey(color: Theme.colors(accent).fg4, label: "Elevation (shaded)")
                        Text(s)
                            .font(Theme.Typography.caption.monospacedDigit())
                            .foregroundStyle(c.fg3)
                    }
                }
            }
        }
    }

    /// Fixed-height readout: the hint until the athlete scrubs, then the values at that point.
    @ViewBuilder
    private func readoutLine(_ c: ThemeColors) -> some View {
        Group {
            if let r = store.readout {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(r.timeText).font(Theme.Typography.statSmall).foregroundStyle(c.fg1)
                            Text(r.distanceText ?? " ").font(Theme.Typography.caption.monospacedDigit()).foregroundStyle(c.fg3)
                        }
                        ForEach(r.items) { item in
                            VStack(alignment: .leading, spacing: 0) {
                                HStack(alignment: .firstTextBaseline, spacing: 2) {
                                    Text(item.value).font(Theme.Typography.statSmall).foregroundStyle(c.fg1)
                                    Text(item.unit).font(Theme.Typography.caption).foregroundStyle(c.fg3)
                                }
                                Text(item.label).font(Theme.Typography.caption).foregroundStyle(c.fg3)
                            }
                        }
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(r.accessibilityText))
            } else {
                Text("Drag across a chart to read the values.")
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minHeight: 44, alignment: .leading)
        .animation(nil, value: store.selection)
    }
}

// MARK: - Metrics

@MainActor
struct ActivityMetricsSection: View {
    let groups: [MetricGroup]
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    Text(group.title)
                        .font(Theme.Typography.title3)
                        .foregroundStyle(c.fg1)
                        .accessibilityAddTraits(.isHeader)
                    LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Space.m) {
                        ForEach(group.items) { item in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.label)
                                    .font(Theme.Typography.label)
                                    .foregroundStyle(c.fg3)
                                    .lineLimit(2)
                                HStack(alignment: .firstTextBaseline, spacing: 3) {
                                    Text(item.value)
                                        .font(Theme.Typography.statSmall)
                                        .foregroundStyle(c.fg1)
                                    if !item.unit.isEmpty {
                                        Text(item.unit)
                                            .font(Theme.Typography.caption)
                                            .foregroundStyle(c.fg3)
                                            .lineLimit(1)
                                    }
                                }
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(Text(item.accessibilityText))
                        }
                    }
                }
            }
        }
    }

    private var columns: [GridItem] {
        let n = typeSize.isAccessibilitySize ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: Theme.Space.m, alignment: .topLeading), count: n)
    }
}

// MARK: - Laps (pinned first column, horizontal scroll, capped height)

@MainActor
struct LapsTableView: View {
    let table: LapTableModel
    @ScaledMetric(relativeTo: .subheadline) private var rowHeight: CGFloat = 34
    @ScaledMetric(relativeTo: .subheadline) private var columnWidth: CGFloat = 78
    @ScaledMetric(relativeTo: .subheadline) private var firstWidth: CGFloat = 40
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        if table.rows.count > 10 {
            ScrollView(.vertical) { grid }
                .frame(height: rowHeight * 10.5)
        } else {
            grid
        }
    }

    private var grid: some View {
        HStack(alignment: .top, spacing: 0) {
            column(0, width: firstWidth, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(1..<max(1, table.columns.count), id: \.self) { i in
                        column(i, width: columnWidth, alignment: .trailing)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func column(_ index: Int, width: CGFloat, alignment: Alignment) -> some View {
        let c = Theme.colors(accent)
        return VStack(spacing: 0) {
            Text(table.columns[index])
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
                .lineLimit(1)
                .frame(width: width, height: rowHeight, alignment: alignment)
            ForEach(table.rows) { row in
                Text(index < row.cells.count ? row.cells[index] : "")
                    .font(Theme.Typography.numeric)
                    .foregroundStyle(row.isRest ? c.fg3 : c.fg1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(width: width, height: rowHeight, alignment: alignment)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(c.line1).frame(height: 0.5)
                    }
            }
        }
    }
}

// MARK: - Zones, peaks, strength

@MainActor
struct ActivityZonesSection: View {
    let zones: [ZoneSetModel]
    @State private var selected: String = ""

    var body: some View {
        ScreenSection("Time in zones") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                if zones.count > 1 {
                    Picker("Zones", selection: $selected) {
                        ForEach(zones) { z in Text(z.title).tag(z.id) }
                    }
                    .pickerStyle(.segmented)
                }
                if let set = zones.first(where: { $0.id == selected }) ?? zones.first {
                    ZoneBarsView(zones: set)
                        .animation(Theme.Motion.smooth, value: set.id)
                }
            }
        }
        .onAppear { if selected.isEmpty { selected = zones.first?.id ?? "" } }
    }
}

@MainActor
struct ActivityPeaksSection: View {
    let peaks: [PeakRowModel]
    let efforts: [PeakRowModel]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xl) {
            if !peaks.isEmpty {
                ScreenSection("Peaks") { PeakRows(rows: peaks) }
            }
            if !efforts.isEmpty {
                ScreenSection("Best efforts") { PeakRows(rows: efforts) }
            }
        }
    }
}

@MainActor
private struct PeakRows: View {
    let rows: [PeakRowModel]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(spacing: 0) {
            ForEach(rows) { row in
                HStack {
                    Text(row.label)
                        .font(Theme.Typography.body)
                        .foregroundStyle(c.fg2)
                    Spacer()
                    Text(row.value)
                        .font(Theme.Typography.statSmall)
                        .foregroundStyle(c.fg1)
                }
                .padding(.vertical, Theme.Space.xs)
                .accessibilityElement(children: .combine)
                if row.id != rows.last?.id {
                    Rectangle().fill(c.line1).frame(height: 0.5)
                }
            }
        }
    }
}

@MainActor
struct StrengthSection: View {
    let rows: [StrengthExerciseModel]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Exercises") {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.exercise)
                            .font(Theme.Typography.body.weight(.medium))
                            .foregroundStyle(c.fg1)
                        Text(row.detail)
                            .font(Theme.Typography.numeric)
                            .foregroundStyle(c.fg3)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

// MARK: - Your log

@MainActor
struct ActivityLogSection: View {
    let store: ActivityStore
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @FocusState private var noteFocused: Bool

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Your log") {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Effort (RPE)").font(Theme.Typography.label).foregroundStyle(c.fg3)
                        Spacer()
                        Text(store.rpe.map { "\($0) · \(EffortScale.rpeLabel($0))" } ?? "Not set")
                            .font(Theme.Typography.bodySmall.monospacedDigit())
                            .foregroundStyle(c.fg2)
                            .contentTransition(.numericText())
                    }
                    ScaleButtons(values: EffortScale.rpeValues, selected: store.rpe, columnsWhenWrapped: 5,
                                 label: { "\($0)" }, accessibility: { "RPE \($0), \(EffortScale.rpeLabel($0))" }) { v in
                        perform { client in await store.setRPE(store.rpe == v ? nil : v, client: client, model: model) }
                    }
                }
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    Text("How it felt").font(Theme.Typography.label).foregroundStyle(c.fg3)
                    ScaleButtons(values: EffortScale.feelValues, selected: store.feel, columnsWhenWrapped: 3,
                                 label: { EffortScale.feelLabel($0) }, accessibility: { "Felt \(EffortScale.feelLabel($0).lowercased())" }) { v in
                        perform { client in await store.setFeel(store.feel == v ? nil : v, client: client, model: model) }
                    }
                }
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    HStack {
                        Text("Note").font(Theme.Typography.label).foregroundStyle(c.fg3)
                        Spacer()
                        if let t = store.noteState.text {
                            Text(t).font(Theme.Typography.caption).foregroundStyle(c.fg3)
                                .transition(.opacity)
                        }
                    }
                    TextField("How did it go? Legs, fuelling, conditions…",
                              text: Binding(get: { store.note }, set: { store.note = $0 }), axis: .vertical)
                        .lineLimit(3...12)
                        .font(Theme.Typography.body)
                        .focused($noteFocused)
                        .padding(Theme.Space.s)
                        .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                }
                .task(id: store.note) {
                    guard store.note != store.savedNote else { return }
                    try? await Task.sleep(for: .milliseconds(900))
                    if Task.isCancelled { return }
                    if let client = model.client { await store.saveNote(client: client, model: model) }
                }
                if let vm = store.vm {
                    VStack(spacing: 0) {
                        Toggle(isOn: Binding(get: { vm.isKey }, set: { v in perform { client in await store.setKey(v, client: client, model: model) } })) {
                            Label("Key session", systemImage: "star")
                                .font(Theme.Typography.body)
                                .foregroundStyle(c.fg1)
                        }
                        .padding(.vertical, Theme.Space.xs)
                        Rectangle().fill(c.line1).frame(height: 0.5)
                        HStack {
                            Label("Intensity", systemImage: "gauge.with.dots.needle.50percent")
                                .font(Theme.Typography.body)
                                .foregroundStyle(c.fg1)
                            Spacer()
                            if vm.intensity != .unknown { ZoneDot(intensity: vm.intensity) }
                            Picker("Intensity", selection: Binding<IntensityClass?>(
                                get: { vm.intensityIsAuto ? nil : vm.intensity },
                                set: { v in perform { client in await store.setIntensity(v, client: client, model: model) } })) {
                                Text(vm.intensityAutoLabel).tag(IntensityClass?.none)
                                ForEach(IntensityClass.knownCases, id: \.self) { i in
                                    Text(i.label).tag(IntensityClass?.some(i))
                                }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                        }
                        .padding(.vertical, Theme.Space.xxs)
                    }
                }
            }
            .animation(Theme.Motion.snappy, value: store.rpe)
            .animation(Theme.Motion.snappy, value: store.feel)
            .animation(Theme.Motion.fast, value: store.noteState)
            .sensoryFeedback(.selection, trigger: store.rpe)
            .sensoryFeedback(.selection, trigger: store.feel)
        }
    }

    private func perform(_ action: @escaping @MainActor (APIClient) async -> Void) {
        guard let client = model.client else { return }
        Task { @MainActor in await action(client) }
    }
}

/// A row of selectable values (RPE 1…10, feel 1…5): one line when it fits, else a grid.
/// Selected = accent fill (selection); others a surface step.
@MainActor
struct ScaleButtons: View {
    let values: [Int]
    let selected: Int?
    var columnsWhenWrapped: Int = 5
    let label: (Int) -> String
    let accessibility: (Int) -> String
    let action: @MainActor (Int) -> Void
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { buttons }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: columnsWhenWrapped), spacing: 6) { buttons }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        let c = Theme.colors(accent)
        ForEach(values, id: \.self) { v in
            let isOn = v == selected
            Button {
                action(v)
            } label: {
                Text(label(v))
                    .font(Theme.Typography.bodySmall.monospacedDigit().weight(isOn ? .semibold : .regular))
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 8)
                    .frame(minWidth: 32, maxWidth: .infinity, minHeight: 40)
                    .foregroundStyle(isOn ? c.onAccent : c.fg1)
                    .background(isOn ? c.accentColor : c.surface2,
                                in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(accessibility(v)))
            .accessibilityAddTraits(isOn ? .isSelected : [])
        }
    }
}
