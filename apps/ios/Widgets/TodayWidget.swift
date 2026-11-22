import SwiftUI
import WidgetKit
import CadenceKit

/// Today: small = the session to do (or done / rest day); medium = up to two rows + the Form line;
/// Lock Screen rectangular = two lines; inline = "Run 45m easy · Form −2". Tap → workout/activity.
struct TodayWidget: Widget {
    static let kind = "CadenceToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CadenceProvider(.today)) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Today's session, and tomorrow's once you are done.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

struct TodayWidgetView: View {
    let entry: CadenceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let s = entry.snapshot {
            let d = WidgetModels.todayDisplay(s, fetchedAt: entry.fetchedAt, now: entry.date, maxRows: 2)
            content(d)
                .cadenceWidgetChrome(entry, link: family == .systemMedium ? .today : d.model.deepLink)
        } else {
            WidgetMessageView(content: entry.content)
                .cadenceWidgetChrome(entry, link: .today)
        }
    }

    @ViewBuilder
    private func content(_ d: TodayWidgetDisplay) -> some View {
        switch family {
        case .accessoryInline:
            TodayInlineView(display: d)
        case .accessoryRectangular:
            TodayRectangularView(display: d)
        case .systemMedium:
            TodayMediumView(display: d)
        default:
            TodaySmallView(display: d)
        }
    }
}

private struct TodayInlineView: View {
    let display: TodayWidgetDisplay

    var body: some View {
        // Inline widgets render one Text (an optional leading Image); no colour, no layout.
        Text(display.inlineText)
            .privacySensitive()
    }
}

private struct TodayRectangularView: View {
    let display: TodayWidgetDisplay

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                if let symbol = display.rectangularSymbol {
                    Image(systemName: symbol)
                        .font(.headline)
                        .widgetAccentable()
                        .accessibilityHidden(true)
                }
                Text(display.rectangularTitle)
                    .font(.headline)
                    .lineLimit(1)
                    .privacySensitive()
            }
            Text(display.rectangularDetail)
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(display.accessibilityLabel)
    }
}

private struct TodaySmallView: View {
    let display: TodayWidgetDisplay
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        let m = display.model
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            HStack(alignment: .firstTextBaseline) {
                Text(m.heading)
                    .font(Theme.Typography.label)
                    .foregroundStyle(r.text(c.accentInk, fallback: .primary))
                    .widgetAccentable()
                Spacer(minLength: 4)
                Text(m.dateText)
                    .font(.caption2)
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if let p = m.primary {
                HStack(alignment: .center) {
                    WidgetSportGlyph(sport: p.sport, font: .title2)
                    Spacer(minLength: 0)
                    WidgetStateMark(state: p.state)
                }
                Text(p.title)
                    .font(Font.subheadline.weight(.semibold))
                    .foregroundStyle(r.text(c.fg1))
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .privacySensitive()
                Text(p.detail)
                    .font(Theme.Typography.statSmall)
                    .foregroundStyle(r.text(c.fg2, fallback: .secondary))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            } else {
                Text(m.emptyText)
                    .font(Theme.Typography.title3)
                    .foregroundStyle(r.text(c.fg1))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            if let footer = m.staleText ?? (m.allDone || m.lines.isEmpty ? display.upNextText : nil) {
                Text(footer)
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .privacySensitive()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(display.accessibilityLabel)
    }
}

private struct TodayMediumView: View {
    let display: TodayWidgetDisplay
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        let m = display.model
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            HStack(alignment: .firstTextBaseline) {
                Text(m.heading)
                    .font(Theme.Typography.title3)
                    .foregroundStyle(r.text(c.accentInk, fallback: .primary))
                    .widgetAccentable()
                Text(m.dateText)
                    .font(.caption)
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                Spacer(minLength: 4)
                if let more = display.moreText {
                    Text(more)
                        .font(.caption)
                        .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            if m.lines.isEmpty {
                Text(m.emptyText)
                    .font(Theme.Typography.bodySmall.weight(.medium))
                    .foregroundStyle(r.text(c.fg2, fallback: .secondary))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            ForEach(display.rows) { row in
                Link(destination: (row.line.deepLink ?? .today).url) {
                    WidgetSessionRow(line: row.line, intensity: row.intensity, showsTime: true, prefix: row.label)
                }
            }
            Spacer(minLength: 0)
            if let footer = m.staleText ?? display.formLine {
                Text(footer)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

#Preview("Today small", as: .systemSmall) {
    TodayWidget()
} timeline: {
    CadenceEntry.preview()
    CadenceEntry(date: Date(), content: .signedOut, accent: .blue)
}

#Preview("Today medium", as: .systemMedium) {
    TodayWidget()
} timeline: {
    CadenceEntry.preview(accent: .rose)
}

#Preview("Today rectangular", as: .accessoryRectangular) {
    TodayWidget()
} timeline: {
    CadenceEntry.preview()
}
