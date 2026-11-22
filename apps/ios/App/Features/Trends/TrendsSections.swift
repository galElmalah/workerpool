import SwiftUI
import Charts
import CadenceKit

// MARK: - Headline

@MainActor
struct TrendsHeadlineRow: View {
    let figures: [KeyFigure]
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Theme.Space.m, alignment: .topLeading),
                                 count: typeSize.isAccessibilitySize ? 1 : 2),
                  alignment: .leading, spacing: Theme.Space.l) {
            ForEach(figures) { f in
                LabelledStat(label: f.label, value: f.value, unit: f.unit, context: f.context, size: .large)
                    .contentTransition(.numericText())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(f.accessibilityText))
            }
        }
    }
}

// MARK: - Fitness · Fatigue · Form

@MainActor
struct FitnessSection: View {
    let chart: FitnessChartModel
    @State private var selection: Double? = nil
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Fitness, fatigue and form") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                Text(chart.sentence)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(selection.flatMap { chart.readout(at: $0) } ?? " ")
                    .font(Theme.Typography.caption.monospacedDigit())
                    .foregroundStyle(c.fg1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(height: 18, alignment: .leading)
                if chart.isEmpty {
                    EmptyState(symbol: "chart.xyaxis.line", title: "No history yet",
                               message: "Fitness builds from completed activities.")
                } else {
                    plot(c)
                        .frame(height: 240)
                    legend
                }
            }
        }
    }

    private func color(_ kind: FitnessSeriesKind) -> Color {
        switch kind {
        case .fitness: return DataColor.fitness
        case .fatigue: return DataColor.fatigue
        case .form: return DataColor.form
        }
    }

    private func plot(_ c: ThemeColors) -> some View {
        Chart {
            RuleMark(x: .value("Today", chart.todayX))
                .foregroundStyle(c.line3)
                .lineStyle(StrokeStyle(lineWidth: 1))
            RuleMark(y: .value("Zero", 0.0))
                .foregroundStyle(c.line2)
                .lineStyle(StrokeStyle(lineWidth: 0.5))
            ForEach(chart.markers) { m in
                RuleMark(x: .value("Event", m.x))
                    .foregroundStyle(m.isPrimary ? c.fg2 : c.fg4)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    .annotation(position: .top, alignment: .leading, spacing: 2) {
                        Text(m.label)
                            .font(.caption2)
                            .foregroundStyle(m.isPrimary ? c.fg1 : c.fg3)
                            .lineLimit(1)
                    }
            }
            ForEach(chart.series) { s in
                ForEach(s.points, id: \.x) { p in
                    LineMark(x: .value("Day", p.x),
                             y: .value(s.kind.label, p.y),
                             series: .value("Series", s.id))
                        .foregroundStyle(color(s.kind).opacity(s.projected ? 0.75 : 1))
                        .lineStyle(StrokeStyle(lineWidth: s.kind == .fitness ? 2 : 1.4, lineCap: .round,
                                               dash: s.projected ? [4, 4] : []))
                        .interpolationMethod(.monotone)
                }
            }
            if let x = selection.flatMap({ chart.snappedX($0) }) {
                RuleMark(x: .value("Selected", x))
                    .foregroundStyle(c.fg2)
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }
        }
        .chartXScale(domain: chart.xDomain)
        .chartYScale(domain: chart.yDomain)
        .chartLegend(.hidden)
        .cadenceAxes(xTicks: chart.xTicks, yTicks: chart.yTicks, accent: accent)
        .chartXSelection(value: $selection)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Fitness, fatigue and form chart"))
        .accessibilityValue(Text(chart.accessibilitySummary))
    }

    private var legend: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Space.m) { legendItems }
            VStack(alignment: .leading, spacing: Theme.Space.xxs) { legendItems }
        }
    }

    @ViewBuilder
    private var legendItems: some View {
        ForEach(FitnessSeriesKind.allCases, id: \.self) { kind in
            ChartKey(color: color(kind), label: kind.label,
                     value: chart.endLabels[kind].map { kind == .form ? Format.form($0) : Format.fitness($0) })
        }
        if chart.series.contains(where: { $0.projected }) {
            ChartKey(color: Theme.colors(accent).fg3, label: "Planned", dashed: true)
        }
    }
}

// MARK: - Weekly volume

@MainActor
struct VolumeSection: View {
    let volume: VolumeChartModel
    @Binding var metric: VolumeMetric
    @State private var selectedWeek: String? = nil
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Weekly volume") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                Picker("Measure", selection: $metric) {
                    ForEach(VolumeMetric.allCases) { m in Text(m.label).tag(m) }
                }
                .pickerStyle(.segmented)
                selectionLine(c)
                    .frame(minHeight: 22, alignment: .leading)
                Chart {
                    ForEach(volume.segments) { seg in
                        BarMark(x: .value("Week", seg.week), y: .value(volume.metric.label, seg.value), width: .ratio(0.7))
                            .foregroundStyle(by: .value("Sport", seg.sport.label))
                            .opacity(selectedWeek == nil || selectedWeek == seg.week ? 1 : 0.4)
                            .accessibilityLabel(Text(volume.bar(seg.week)?.label ?? seg.week))
                            .accessibilityValue(Text(seg.accessibilityText))
                    }
                    if let avg = volume.average {
                        RuleMark(y: .value("Average", avg))
                            .foregroundStyle(c.fg2)
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    }
                }
                .chartForegroundStyleScale(domain: volume.sports.map(\.label), range: volume.sports.map { DataColor.sport($0) })
                .chartYScale(domain: volume.yDomain)
                .chartLegend(.hidden)
                .cadenceCategoryAxes(labelled: volume.labelledWeeks, label: { volume.bar($0)?.label ?? "" },
                                     yTicks: volume.yTicks, accent: accent)
                .chartXSelection(value: $selectedWeek)
                .frame(height: 200)
                HStack(alignment: .firstTextBaseline) {
                    sportLegend
                    Spacer(minLength: Theme.Space.xs)
                    if let avg = volume.averageText {
                        Text(avg)
                            .font(Theme.Typography.caption.monospacedDigit())
                            .foregroundStyle(c.fg2)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func selectionLine(_ c: ThemeColors) -> some View {
        if let week = selectedWeek, let bar = volume.bar(week) {
            HStack(spacing: Theme.Space.xs) {
                Text("\(bar.isCurrent ? "This week" : "Week of " + Format.dayMonth(bar.startDate))\(Format.dot)\(bar.valueText)")
                    .font(Theme.Typography.bodySmall.monospacedDigit())
                    .foregroundStyle(c.fg1)
                    .lineLimit(1)
                Spacer(minLength: 0)
                NavigationLink(value: Route.week(bar.id)) {
                    HStack(spacing: 2) {
                        Text("Review")
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .font(Theme.Typography.bodySmall)
                }
            }
        } else {
            Text(volume.sentence)
                .font(Theme.Typography.bodySmall)
                .foregroundStyle(c.fg3)
        }
    }

    private var sportLegend: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s) {
                ForEach(volume.sports, id: \.self) { s in
                    ChartKey(color: DataColor.sport(s), label: s.label)
                }
            }
        }
    }
}

// MARK: - Week-over-week progression

@MainActor
struct ProgressionSection: View {
    let model: ProgressionModel
    @State private var selectedWeek: String? = nil
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Week over week") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                    if model.bars.last?.isCaution == true {
                        Image(systemName: AnalysisTone.warn.symbol)
                            .foregroundStyle(DataColor.warn)
                            .accessibilityHidden(true)
                    }
                    Text(model.sentence)
                        .font(Theme.Typography.title3)
                        .foregroundStyle(c.fg1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let detail = model.detail {
                    Text(detail)
                        .font(Theme.Typography.bodySmall.monospacedDigit())
                        .foregroundStyle(c.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !model.bars.isEmpty {
                    Text(selectedText ?? " ")
                        .font(Theme.Typography.caption.monospacedDigit())
                        .foregroundStyle(c.fg1)
                        .frame(height: 16, alignment: .leading)
                    Chart {
                        RuleMark(y: .value("Zero", 0.0))
                            .foregroundStyle(c.line3)
                            .lineStyle(StrokeStyle(lineWidth: 1))
                        RuleMark(y: .value("Caution", model.cautionLine))
                            .foregroundStyle(DataColor.warn.opacity(0.7))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                            .annotation(position: .top, alignment: .leading, spacing: 2) {
                                Text("Caution above +15%")
                                    .font(.caption2)
                                    .foregroundStyle(c.fg3)
                            }
                        ForEach(model.bars) { bar in
                            BarMark(x: .value("Week", bar.id), y: .value("Change", bar.delta), width: .ratio(0.6))
                                .foregroundStyle(barColor(bar, c))
                                .cornerRadius(2)
                                .accessibilityLabel(Text("Week of \(bar.label)"))
                                .accessibilityValue(Text(bar.deltaText + (bar.isCaution ? ", above the caution line" : "")))
                        }
                    }
                    .chartYScale(domain: model.yDomain)
                    .chartLegend(.hidden)
                    .cadenceCategoryAxes(labelled: model.labelledWeeks,
                                         label: { id in model.bars.first { $0.id == id }?.label ?? "" },
                                         yTicks: model.yTicks, accent: accent)
                    .chartXSelection(value: $selectedWeek)
                    .frame(height: 160)
                }
            }
        }
    }

    private var selectedText: String? {
        guard let id = selectedWeek, let bar = model.bars.first(where: { $0.id == id }) else { return nil }
        return "Week of \(bar.label)\(Format.dot)\(bar.deltaText) vs the week before"
    }

    private func barColor(_ bar: WowBar, _ c: ThemeColors) -> Color {
        if bar.isCaution { return DataColor.warn }
        if selectedWeek == bar.id || (selectedWeek == nil && bar.isLatest) { return c.fg1 }
        return c.fg3
    }
}

// MARK: - Intensity distribution

@MainActor
struct IntensitySection: View {
    let chart: IntensityChartModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Intensity distribution") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                    if let label = chart.distributionLabel {
                        Text(label)
                            .font(Theme.Typography.title3)
                            .foregroundStyle(c.fg1)
                    }
                    Text(chart.total.text)
                        .font(Theme.Typography.bodySmall.monospacedDigit())
                        .foregroundStyle(c.fg2)
                }
                Text(chart.sentence)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg3)
                    .fixedSize(horizontal: false, vertical: true)
                if !chart.total.isEmpty {
                    IntensityShareBar(share: chart.total, height: 10)
                    IntensityShareLegend(share: chart.total)
                }
                if !chart.segments.isEmpty {
                    Chart {
                        ForEach(chart.segments) { seg in
                            BarMark(x: .value("Week", seg.week), y: .value("Share", seg.share), width: .ratio(0.7))
                                .foregroundStyle(by: .value("Band", seg.band.label))
                                .accessibilityLabel(Text("Week of \(chart.weekLabels[seg.week] ?? seg.week), \(seg.band.label)"))
                                .accessibilityValue(Text(Format.percent(seg.share)))
                        }
                    }
                    .chartForegroundStyleScale(domain: IntensityBand.allCases.map(\.label),
                                               range: IntensityBand.allCases.map { DataColor.zone($0.zone) })
                    .chartYScale(domain: 0.0...1.0)
                    .chartLegend(.hidden)
                    .cadenceCategoryAxes(labelled: chart.labelledWeeks, label: { chart.weekLabels[$0] ?? "" },
                                         yTicks: [ChartTick(value: 0, label: "0%"), ChartTick(value: 0.5, label: "50%"), ChartTick(value: 1, label: "100%")],
                                         accent: accent)
                    .frame(height: 150)
                }
            }
        }
    }
}

// MARK: - Consistency

@MainActor
struct ConsistencySection: View {
    let model: ConsistencyModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScreenSection("Consistency") {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                Text(model.sentence)
                    .font(Theme.Typography.bodySmall.monospacedDigit())
                    .foregroundStyle(c.fg2)
                    .fixedSize(horizontal: false, vertical: true)
                HeatmapGrid(model: model)
                HStack(spacing: 4) {
                    Spacer()
                    Text("Less").font(.caption2).foregroundStyle(c.fg3)
                    ForEach(0..<5, id: \.self) { level in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(level == 0 ? c.surface2 : c.accentColor.opacity([0, 0.28, 0.5, 0.75, 1][level]))
                            .frame(width: 10, height: 10)
                    }
                    Text("More").font(.caption2).foregroundStyle(c.fg3)
                }
                .accessibilityHidden(true)
            }
        }
    }
}
