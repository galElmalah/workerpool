import SwiftUI
import WidgetKit
import CadenceKit

/// Week: small = hours (or Load) done of plan + thin bar + "W47 · Run base"; medium = + seven-day
/// strip and the other metric; large = + this week's sessions (up to 6). Lock Screen circular =
/// week progress gauge (the product's one ring). Configurable: lead with hours or Load.
struct WeekWidget: Widget {
    static let kind = "CadenceWeek"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: WeekWidgetConfigurationIntent.self, provider: WeekProvider()) { entry in
            WeekWidgetView(entry: entry)
        }
        .configurationDisplayName("Week")
        .description("This week's training against the plan.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular])
    }
}

struct WeekWidgetView: View {
    let entry: CadenceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let s = entry.snapshot {
            let p = WidgetModels.weekProgress(s, metric: entry.metric, now: entry.date)
            content(p, s)
                .cadenceWidgetChrome(entry, link: p.deepLink)
        } else {
            WidgetMessageView(content: entry.content)
                .cadenceWidgetChrome(entry, link: .week(Day(entry.date).isoWeek))
        }
    }

    @ViewBuilder
    private func content(_ p: WeekProgressModel, _ s: MobileSnapshot) -> some View {
        switch family {
        case .accessoryCircular:
            WeekGaugeView(progress: p)
        case .systemMedium:
            WeekMediumView(progress: p)
        case .systemLarge:
            WeekLargeView(progress: p,
                          sessions: WidgetModels.weekSessions(calendar: entry.calendar, snapshot: s, now: entry.date, limit: 6))
        default:
            WeekSmallView(progress: p)
        }
    }
}

private struct WeekGaugeView: View {
    let progress: WeekProgressModel

    var body: some View {
        Gauge(value: progress.fraction) {
            Text(progress.gaugeLabel)
        } currentValueLabel: {
            Text(progress.gaugeValueText)
                .monospacedDigit()
                .minimumScaleFactor(0.6)
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
        .accessibilityLabel(progress.accessibilityLabel)
    }
}

/// "7:48 of 9:45" (or "Load 464 of 539"); stacks when it does not fit on one line.
private struct WeekHero: View {
    let progress: WeekProgressModel
    var heroFont: Font = Theme.Typography.statLarge
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                prefixView(c, r)
                heroView(c, r)
                ofView(c, r)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    prefixView(c, r)
                    heroView(c, r)
                }
                ofView(c, r)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(progress.accessibilityLabel)
    }

    @ViewBuilder
    private func prefixView(_ c: ThemeColors, _ r: RenderingInfo) -> some View {
        if let prefix = progress.heroPrefix {
            Text(prefix).font(Theme.Typography.bodySmall).foregroundStyle(r.text(c.fg3, fallback: .secondary))
        }
    }

    private func heroView(_ c: ThemeColors, _ r: RenderingInfo) -> some View {
        Text(progress.heroText).font(heroFont).foregroundStyle(r.text(c.fg1))
    }

    private func ofView(_ c: ThemeColors, _ r: RenderingInfo) -> some View {
        Text(progress.ofText).font(Theme.Typography.bodySmall).monospacedDigit().foregroundStyle(r.text(c.fg3, fallback: .secondary))
    }
}

/// Thin bar; accent fill when `accented` (the widget's one accent mark), else neutral.
private struct WeekProgressBar: View {
    let fraction: Double
    var accented: Bool
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let full = RenderingInfo(mode: mode).isFullColor
        ThinProgressBar(fraction: fraction, tint: full ? (accented ? c.accentColor : c.fg2) : Color.primary)
            .widgetAccentable()
    }
}

private struct WeekTitle: View {
    let text: String
    var trailing: String? = nil
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        HStack(alignment: .firstTextBaseline) {
            Text(text)
                .font(Theme.Typography.label)
                .foregroundStyle(r.text(c.fg2, fallback: .secondary))
            Spacer(minLength: 4)
            if let trailing {
                Text(trailing)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}

private struct WeekSmallView: View {
    let progress: WeekProgressModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            WeekTitle(text: progress.title)
            Spacer(minLength: 0)
            WeekHero(progress: progress)
            WeekProgressBar(fraction: progress.fraction, accented: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct WeekMediumView: View {
    let progress: WeekProgressModel
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            WeekTitle(text: progress.title, trailing: progress.keyText)
            HStack(alignment: .lastTextBaseline) {
                WeekHero(progress: progress)
                Spacer(minLength: 8)
                Text(progress.secondaryText)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            // the today mark carries the accent here, so the bar stays neutral
            WeekProgressBar(fraction: progress.fraction, accented: false)
            Spacer(minLength: 0)
            WeekStripView(cells: progress.strip)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct WeekLargeView: View {
    let progress: WeekProgressModel
    let sessions: WeekSessionsModel
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            WeekMediumView(progress: progress)
                .frame(height: 118)
            Spacer(minLength: Theme.Space.xxs)
            if let empty = sessions.emptyText {
                Text(empty)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
            }
            ForEach(sessions.rows) { row in
                Link(destination: (row.line.deepLink ?? progress.deepLink).url) {
                    HStack(spacing: Theme.Space.xs) {
                        Text(row.dayText)
                            .font(.caption.weight(row.isToday ? .semibold : .regular))
                            .foregroundStyle(r.text(row.isToday ? c.fg1 : c.fg3, fallback: row.isToday ? .primary : .secondary))
                            .frame(width: 30, alignment: .leading)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        WidgetSessionRow(line: row.line, intensity: row.intensity, showsTime: false, compact: true)
                    }
                }
            }
            if let more = sessions.moreText {
                Text(more)
                    .font(.caption)
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

#Preview("Week small", as: .systemSmall) {
    WeekWidget()
} timeline: {
    CadenceEntry.preview()
    CadenceEntry.preview(metric: .load)
}

#Preview("Week medium", as: .systemMedium) {
    WeekWidget()
} timeline: {
    CadenceEntry.preview(accent: .green)
}

#Preview("Week large", as: .systemLarge) {
    WeekWidget()
} timeline: {
    CadenceEntry.preview()
}

#Preview("Week gauge", as: .accessoryCircular) {
    WeekWidget()
} timeline: {
    CadenceEntry.preview()
}
