import SwiftUI
import CadenceKit

// Small shared building blocks for app screens and widgets. They take CadenceKit view-models
// (`SessionLine`, formatted strings) and never format numbers themselves.

/// Sport glyph (SF Symbol), neutral colour. Decorative next to a title; labelled when alone.
struct SportGlyph: View {
    enum Size { case small, regular, large }

    let sport: Sport
    var size: Size = .regular
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        Image(systemName: sport.symbolName)
            .font(font)
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(Theme.colors(accent).fg2)
            .frame(width: frame, height: frame)
            .accessibilityLabel(sport.label)
    }

    private var font: Font {
        switch size {
        case .small: return .footnote
        case .regular: return .body
        case .large: return .title2
        }
    }

    private var frame: CGFloat {
        switch size {
        case .small: return 16
        case .regular: return 24
        case .large: return 36
        }
    }
}

/// Label above, value below, optional one-line context (DESIGN_V2 §3/§5 stat anatomy).
struct LabelledStat: View {
    enum Size { case small, medium, large, display }

    let label: String
    let value: String
    var unit: String? = nil
    var context: String? = nil
    var size: Size = .medium
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            Text(label)
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(valueFont)
                    .foregroundStyle(c.fg1)
                if let unit, !unit.isEmpty {
                    Text(unit)
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg3)
                }
            }
            if let context, !context.isEmpty {
                Text(context)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var valueFont: Font {
        switch size {
        case .small: return Theme.Typography.statSmall
        case .medium: return Theme.Typography.statMedium
        case .large: return Theme.Typography.statLarge
        case .display: return Theme.Typography.statDisplay
        }
    }
}

/// A thin (4 pt) progress bar. Neutral by default — "done" is never accent; pass `tint` for the
/// rare case where the bar is the screen's hero/selection.
struct ThinProgressBar: View {
    let fraction: Double
    var tint: Color? = nil
    var height: CGFloat = 4
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(c.surface3)
                Capsule()
                    .fill(tint ?? c.fg2)
                    .frame(width: geo.size.width * CGFloat(min(1, max(0, fraction))))
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityValue(Text("\(Int((min(1, max(0, fraction)) * 100).rounded())) percent"))
    }
}

/// Small dot for hard sessions (threshold, high, race), toned from the zone ramp.
struct IntensityDot: View {
    let rampIndex: Int
    var diameter: CGFloat = 6
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        Circle()
            .fill(Theme.colors(accent).zone(rampIndex))
            .frame(width: diameter, height: diameter)
            .accessibilityHidden(true)
    }
}

/// One session: glyph · title (semibold when key) / "1:25 · 42.2 km" · trailing marks.
/// Done = solid neutral check; planned = hollow quiet circle; missed = struck + dimmed;
/// skipped = dimmed dash. Key = small neutral star. No edge stripes, no accent for state.
struct SessionRow: View {
    let line: SessionLine
    var showsTime: Bool = true
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        let dim = line.state == .missed || line.state == .skipped
        HStack(alignment: .center, spacing: Theme.Space.s) {
            SportGlyph(sport: line.sport)
                .opacity(dim ? 0.6 : 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(line.title)
                    .font(line.isKey ? Theme.Typography.body.weight(.semibold) : Theme.Typography.body)
                    .strikethrough(line.state == .missed, color: c.fg4)
                    .foregroundStyle(dim ? c.fg4 : c.fg1)
                    .lineLimit(2)
                HStack(spacing: Theme.Space.xs) {
                    if line.showsIntensityDot { IntensityDot(rampIndex: line.intensityRamp) }
                    Text(detailText)
                        .font(Theme.Typography.numeric)
                        .foregroundStyle(c.fg3)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Theme.Space.xs)
            if line.isKey {
                Image(systemName: "star.fill")
                    .font(.caption2)
                    .foregroundStyle(c.fg3)
                    .accessibilityHidden(true)
            }
            stateMark(c)
        }
        .padding(.vertical, Theme.Space.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line.accessibilityLabel)
    }

    private var detailText: String {
        guard showsTime, let time = line.time else { return line.detail }
        return line.detail.isEmpty ? time : time + Format.dot + line.detail
    }

    @ViewBuilder
    private func stateMark(_ c: ThemeColors) -> some View {
        switch line.state {
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(c.fg2).accessibilityHidden(true)
        case .planned, .unknown:
            Image(systemName: "circle").foregroundStyle(c.fg4).accessibilityHidden(true)
        case .skipped:
            Image(systemName: "minus.circle").foregroundStyle(c.fg4).accessibilityHidden(true)
        case .missed:
            EmptyView()
        }
    }
}

/// Section title (sentence case) with an optional trailing text button.
struct SectionHeader: View {
    let title: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(Theme.Typography.title3)
                .foregroundStyle(c.fg1)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
            }
        }
    }
}

/// Quiet empty state: glyph, one line, optional detail and action. Empty space is fine.
struct EmptyState: View {
    let symbol: String
    let title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(spacing: Theme.Space.s) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(c.fg3)
                .accessibilityHidden(true)
            Text(title)
                .font(Theme.Typography.title3)
                .foregroundStyle(c.fg1)
            if let message {
                Text(message)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg3)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
                    .padding(.top, Theme.Space.xs)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Space.xl)
        .padding(.horizontal, Theme.Space.l)
    }
}

/// The page's single primary action: accent fill, full width.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let c = Theme.colors(accent)
        configuration.label
            .font(Theme.Typography.body.weight(.semibold))
            .foregroundStyle(c.onAccent)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(configuration.isPressed ? c.accentPress : c.accentColor,
                        in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .opacity(isEnabled ? 1 : 0.5)
    }
}

#Preview("Components") {
    ComponentsPreview()
}

private struct ComponentsPreview: View {
    var body: some View {
        let s = MobileSnapshot.preview
        let lines = (s.todaySessions + s.tomorrowSessions).map { SessionLine(session: $0, units: s.units) }
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                SectionHeader(title: "Today", actionTitle: "Calendar", action: {})
                ForEach(lines) { line in
                    SessionRow(line: line)
                }
                HStack(spacing: Theme.Space.l) {
                    LabelledStat(label: "Fitness", value: Format.fitness(s.status.fitness))
                    LabelledStat(label: "Form", value: Format.form(s.status.form), context: s.status.formZone?.label)
                }
                ThinProgressBar(fraction: 0.62)
                EmptyState(symbol: "moon.zzz", title: "Rest day", message: "Nothing planned today.")
            }
            .padding(Theme.Space.gutter)
        }
    }
}
