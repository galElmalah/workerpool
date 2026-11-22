import SwiftUI
import WidgetKit
import AppIntents
import CadenceKit

/// Interactive morning check-in (medium): five buttons run `LogFeelIntent` (Shared/Intents) in the
/// widget extension, which sends `PUT /api/wellness/:date {feel}` with the shared device token,
/// stores the answer in the App Group, refreshes the snapshot cache and reloads the timelines.
struct CheckInWidget: Widget {
    static let kind = "CadenceCheckIn"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CadenceProvider(.checkIn, checkIn: true)) { entry in
            CheckInWidgetView(entry: entry)
        }
        .configurationDisplayName("Morning check-in")
        .description("Log how you feel with one tap.")
        .supportedFamilies([.systemMedium])
        // five buttons need the width: we pad ourselves (12 pt) instead of the system margins
        .contentMarginsDisabled()
    }
}

struct CheckInWidgetView: View {
    let entry: CadenceEntry
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        switch entry.content {
        case .signedOut, .empty:
            WidgetMessageView(content: entry.content)
                .padding(Theme.Space.m)
                .cadenceWidgetChrome(entry, link: .today)
        case .data:
            let m = WidgetModels.checkIn(record: entry.checkIn, now: entry.date)
            let c = Theme.colors(entry.accent)
            let r = RenderingInfo(mode: mode)
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(m.title)
                        .font(Font.subheadline.weight(.semibold))
                        .foregroundStyle(r.text(c.fg1))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 4)
                    Text(m.statusText ?? m.dateText)
                        .font(.caption)
                        .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .invalidatableContent()
                }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    ForEach(m.options) { option in
                        Button(intent: LogFeelIntent(feel: FeelLevel(value: option.value))) {
                            CheckInOptionLabel(option: option)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(option.accessibilityLabel)
                    }
                }
                .invalidatableContent()
            }
            .padding(.horizontal, Theme.Space.s)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .cadenceWidgetChrome(entry, link: m.deepLink)
        }
    }
}

/// Number over a word; the chosen one gets a surface step, semibold text and a check (not colour).
private struct CheckInOptionLabel: View {
    let option: CheckInOption
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        VStack(spacing: 2) {
            HStack(spacing: 2) {
                if option.isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                        .widgetAccentable()
                }
                Text(option.valueText)
                    .font(Theme.Typography.statSmall)
            }
            .foregroundStyle(r.text(c.fg1))
            Text(option.label)
                .font(.caption2.weight(option.isSelected ? .semibold : .regular))
                .foregroundStyle(r.text(option.isSelected ? c.fg1 : c.fg3, fallback: option.isSelected ? .primary : .secondary))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, minHeight: 50)
        .padding(.horizontal, 2)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(background(c, r))
        )
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
    }

    private func background(_ c: ThemeColors, _ r: RenderingInfo) -> AnyShapeStyle {
        if r.isFullColor { return AnyShapeStyle(option.isSelected ? c.surface3 : c.surface1) }
        return AnyShapeStyle(option.isSelected ? HierarchicalShapeStyle.tertiary : HierarchicalShapeStyle.quaternary)
    }
}

#Preview("Check-in", as: .systemMedium) {
    CheckInWidget()
} timeline: {
    CadenceEntry.preview()
}
