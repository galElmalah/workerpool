import SwiftUI
import CadenceKit

// Small non-Swift-Charts visuals: zone bars, the easy/moderate/hard share bar and the consistency
// heatmap. Plain shapes so they size predictably at any Dynamic Type size.

/// Time in zones: one row per zone — label, bar in the zone colour, time and share.
@MainActor
struct ZoneBarsView: View {
    let zones: ZoneSetModel
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            ForEach(zones.bars) { bar in
                VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                        Text("Z\(bar.zone)")
                            .font(Theme.Typography.label.monospacedDigit())
                            .foregroundStyle(c.fg2)
                        Text(bar.name)
                            .font(Theme.Typography.bodySmall)
                            .foregroundStyle(c.fg1)
                            .lineLimit(1)
                        Spacer(minLength: Theme.Space.xs)
                        Text(bar.timeText)
                            .font(Theme.Typography.numeric)
                            .foregroundStyle(c.fg1)
                        Text(bar.shareText)
                            .font(Theme.Typography.numeric)
                            .foregroundStyle(c.fg3)
                            .frame(minWidth: 40, alignment: .trailing)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(c.surface2)
                            Capsule()
                                .fill(DataColor.zone(bar.zone))
                                .frame(width: max(3, geo.size.width * CGFloat(bar.fraction)))
                        }
                    }
                    .frame(height: 6)
                    if let range = bar.rangeText, !typeSize.isAccessibilitySize {
                        Text(range)
                            .font(Theme.Typography.caption.monospacedDigit())
                            .foregroundStyle(c.fg3)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Zone \(bar.zone), \(bar.name)"))
                .accessibilityValue(Text("\(bar.timeText), \(bar.shareText)\(bar.rangeText.map { ", " + $0 } ?? "")"))
            }
        }
    }
}

/// Easy / moderate / hard as one segmented bar (zone colours), with the three shares as text.
@MainActor
struct IntensityShareBar: View {
    let share: IntensityShare
    var height: CGFloat = 8
    var dim: Bool = false
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        GeometryReader { geo in
            HStack(spacing: 2) {
                segment(.easy, share.easy, width: geo.size.width)
                segment(.moderate, share.moderate, width: geo.size.width)
                segment(.hard, share.hard, width: geo.size.width)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.surface2, in: Capsule())
            .clipShape(Capsule())
        }
        .frame(height: height)
        .opacity(dim ? 0.55 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Easy \(Format.percent(share.easy)), moderate \(Format.percent(share.moderate)), hard \(Format.percent(share.hard))"))
    }

    @ViewBuilder
    private func segment(_ band: IntensityBand, _ fraction: Double, width: CGFloat) -> some View {
        if fraction > 0 {
            Rectangle()
                .fill(DataColor.zone(band.zone))
                .frame(width: max(2, (width - 4) * CGFloat(fraction)))
        }
    }
}

/// Legend for the share bar: three keyed labels with percentages.
@MainActor
struct IntensityShareLegend: View {
    let share: IntensityShare

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Space.m) { items }
            VStack(alignment: .leading, spacing: Theme.Space.xxs) { items }
        }
    }

    @ViewBuilder
    private var items: some View {
        ChartKey(color: DataColor.zone(IntensityBand.easy.zone), label: IntensityBand.easy.label, value: Format.percent(share.easy))
        ChartKey(color: DataColor.zone(IntensityBand.moderate.zone), label: IntensityBand.moderate.label, value: Format.percent(share.moderate))
        ChartKey(color: DataColor.zone(IntensityBand.hard.zone), label: IntensityBand.hard.label, value: Format.percent(share.hard))
    }
}

/// The consistency heatmap: one column per week, Monday at the top; one hue (accent tints, §8).
/// Lives in a horizontal ScrollView anchored to the latest week.
@MainActor
struct HeatmapGrid: View {
    let model: ConsistencyModel
    var cell: CGFloat = 12
    var gap: CGFloat = 3
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: gap) {
                VStack(alignment: .trailing, spacing: gap) {
                    Text(" ").font(Theme.Typography.caption).frame(height: 16)
                    ForEach(1...7, id: \.self) { d in
                        Text(d == 1 ? "Mon" : d == 3 ? "Wed" : d == 5 ? "Fri" : "")
                            .font(.caption2)
                            .foregroundStyle(c.fg3)
                            .frame(height: cell)
                    }
                }
                .accessibilityHidden(true)
                ForEach(model.columns) { col in
                    VStack(spacing: gap) {
                        Text(col.monthLabel ?? " ")
                            .font(.caption2)
                            .foregroundStyle(c.fg3)
                            .fixedSize()
                            .frame(width: cell, height: 16, alignment: .leading)
                        ForEach(col.cells) { day in
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(fill(day, c))
                                .frame(width: cell, height: cell)
                                .accessibilityElement()
                                .accessibilityLabel(Text(day.accessibilityLabel))
                        }
                    }
                }
            }
            .padding(.horizontal, 1)
        }
        .defaultScrollAnchor(.trailing)
    }

    private func fill(_ day: HeatCell, _ c: ThemeColors) -> Color {
        if day.isFuture { return Color.clear }
        switch day.level {
        case 0: return c.surface2
        case 1: return c.accentColor.opacity(0.28)
        case 2: return c.accentColor.opacity(0.5)
        case 3: return c.accentColor.opacity(0.75)
        default: return c.accentColor
        }
    }
}
