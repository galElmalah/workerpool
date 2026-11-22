import SwiftUI
import WidgetKit
import CadenceKit

// MARK: - Form

/// Form (small): Form number + zone word, Fitness and Fatigue beneath, 42-day Fitness sparkline.
struct FormWidget: Widget {
    static let kind = "CadenceForm"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CadenceProvider(.form)) { entry in
            FormWidgetView(entry: entry)
        }
        .configurationDisplayName("Form")
        .description("Form, Fitness and Fatigue, with six weeks of Fitness.")
        .supportedFamilies([.systemSmall])
    }
}

struct FormWidgetView: View {
    let entry: CadenceEntry
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        if let s = entry.snapshot {
            let m = WidgetModels.form(s)
            let line = WidgetModels.fitnessSparkline(s)
            let c = Theme.colors(entry.accent)
            let r = RenderingInfo(mode: mode)
            VStack(alignment: .leading, spacing: 2) {
                Text("Form")
                    .font(Theme.Typography.label)
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(m.formText)
                        .font(Theme.Typography.statLarge)
                        .foregroundStyle(r.text(c.fg1))
                    Text(m.zoneText)
                        .font(Theme.Typography.bodySmall.weight(.medium))
                        .foregroundStyle(r.text(c.fg2, fallback: .secondary))
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Theme.Space.xs) {
                        stat("Fitness", m.fitnessText, c, r)
                        stat("Fatigue", m.fatigueText, c, r)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        stat("Fitness", m.fitnessText, c, r)
                        stat("Fatigue", m.fatigueText, c, r)
                    }
                }
                Spacer(minLength: Theme.Space.xxs)
                if line.isDrawable {
                    SparklineShape(sparkline: line)
                        .stroke(r.data(DataColor.fitness), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .widgetAccentable()
                        .frame(maxWidth: .infinity, minHeight: 18, maxHeight: 36)
                        .accessibilityLabel(line.accessibilityLabel)
                } else {
                    Text(line.accessibilityLabel)
                        .font(.caption2)
                        .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .cadenceWidgetChrome(entry, link: m.deepLink)
        } else {
            WidgetMessageView(content: entry.content)
                .cadenceWidgetChrome(entry, link: .trends)
        }
    }

    /// "Fitness 66" — label in fg-3, value in fg-1 (text is never data-coloured).
    private func stat(_ label: String, _ value: String, _ c: ThemeColors, _ r: RenderingInfo) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(r.text(c.fg3, fallback: .secondary))
            Text(value)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(r.text(c.fg1))
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Next race

/// Next race: small = days to go, name, date; medium adds this week's summary line.
struct RaceWidget: Widget {
    static let kind = "CadenceRace"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CadenceProvider(.race)) { entry in
            RaceWidgetView(entry: entry)
        }
        .configurationDisplayName("Next race")
        .description("Countdown to your next event.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct RaceWidgetView: View {
    let entry: CadenceEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        if let s = entry.snapshot {
            let d = WidgetModels.raceDisplay(s, now: entry.date)
            let c = Theme.colors(entry.accent)
            let r = RenderingInfo(mode: mode)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Next race")
                        .font(Theme.Typography.label)
                        .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    Spacer(minLength: 4)
                    if let race = d.race, family != .systemSmall {
                        Text(race.priorityText)
                            .font(.caption)
                            .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    }
                }
                .lineLimit(1)
                Spacer(minLength: 0)
                if let race = d.race {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(d.heroText)
                            .font(Theme.Typography.statLarge)
                            .foregroundStyle(r.text(c.fg1))
                        if let unit = d.heroUnit {
                            Text(unit)
                                .font(Theme.Typography.bodySmall)
                                .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                        }
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    Text(race.name)
                        .font(Font.subheadline.weight(.semibold))
                        .foregroundStyle(r.text(c.fg1))
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                    Text(family == .systemSmall ? race.dateText : race.dateText + Format.dot + race.priorityText)
                        .font(.caption)
                        .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                } else {
                    Text(WidgetCopy.noRaceTitle)
                        .font(Theme.Typography.title3)
                        .foregroundStyle(r.text(c.fg1))
                        .lineLimit(2)
                    Text(WidgetCopy.noRaceMessage)
                        .font(.caption)
                        .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                        .lineLimit(2)
                }
                if family != .systemSmall {
                    Spacer(minLength: Theme.Space.xxs)
                    Text(d.weekLine)
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(r.text(c.fg2, fallback: .secondary))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .combine)
            .cadenceWidgetChrome(entry, link: d.deepLink)
        } else {
            WidgetMessageView(content: entry.content)
                .cadenceWidgetChrome(entry, link: .calendar(date: nil))
        }
    }
}

#Preview("Form", as: .systemSmall) {
    FormWidget()
} timeline: {
    CadenceEntry.preview()
}

#Preview("Race medium", as: .systemMedium) {
    RaceWidget()
} timeline: {
    CadenceEntry.preview()
}
