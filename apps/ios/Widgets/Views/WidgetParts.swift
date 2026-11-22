import SwiftUI
import WidgetKit
import CadenceKit

// Small, dumb building blocks for the widget families. They draw CadenceKit view-models; colours
// follow DESIGN_V2 §8 (data colours on glyphs/dots/marks, text in fg-*), and every coloured mark also
// has a distinct symbol so the tinted/vibrant rendering modes and StandBy read the same.

/// True when WidgetKit renders our colours as they are (Home Screen, full colour).
/// In `.accented` (tinted Home Screen) and `.vibrant` (Lock Screen, StandBy night) it does not.
struct RenderingInfo {
    let mode: WidgetRenderingMode
    var isFullColor: Bool { mode == .fullColor }

    /// The data colour in full-colour mode; the primary style otherwise (shape carries meaning).
    func data(_ color: Color) -> AnyShapeStyle {
        isFullColor ? AnyShapeStyle(color) : AnyShapeStyle(.primary)
    }

    /// A theme text colour in full-colour mode; a hierarchical style otherwise.
    func text(_ color: Color, fallback: HierarchicalShapeStyle = .primary) -> AnyShapeStyle {
        isFullColor ? AnyShapeStyle(color) : AnyShapeStyle(fallback)
    }
}

/// Sport glyph tinted with the sport colour (decorative next to a title).
struct WidgetSportGlyph: View {
    let sport: Sport
    var font: Font = .body
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        Image(systemName: sport.symbolName)
            .font(font)
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(RenderingInfo(mode: mode).data(DataColor.sport(sport)))
            .widgetAccentable()
            .accessibilityHidden(true)
    }
}

/// The small intensity dot (every session with an intensity; zone colour).
struct WidgetZoneDot: View {
    let intensity: IntensityClass
    var diameter: CGFloat = 6
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        Circle()
            .fill(RenderingInfo(mode: mode).data(DataColor.intensity(intensity)))
            .frame(width: diameter, height: diameter)
            .accessibilityHidden(true)
    }
}

/// Trailing state mark: done = green check, missed = red cross, skipped = dash, planned = hollow ring.
struct WidgetStateMark: View {
    let state: SessionState
    @Environment(\.widgetRenderingMode) private var mode
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let r = RenderingInfo(mode: mode)
        let c = Theme.colors(accent)
        let color = DataColor.status(state)
        Image(systemName: WidgetModels.stateSymbol(state))
            .font(.footnote)
            .foregroundStyle(color.map { r.data($0) } ?? r.text(c.fg4, fallback: .tertiary))
            .widgetAccentable(color != nil)
            .accessibilityHidden(true)
    }
}

/// A coloured status mark for a `StatusTone` (week strip).
struct WidgetToneMark: View {
    let symbol: String
    let tone: StatusTone
    var dimmed = false
    @Environment(\.widgetRenderingMode) private var mode
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let r = RenderingInfo(mode: mode)
        let c = Theme.colors(accent)
        Image(systemName: symbol)
            .font(.footnote)
            .foregroundStyle(style(r, c))
            .widgetAccentable(tone != .neutral)
            .accessibilityHidden(true)
    }

    private func style(_ r: RenderingInfo, _ c: ThemeColors) -> AnyShapeStyle {
        switch tone {
        case .good: return r.data(DataColor.good)
        case .warn: return r.data(DataColor.warn)
        case .critical: return r.data(DataColor.critical)
        case .neutral: return r.text(dimmed ? c.fg4 : c.fg3, fallback: dimmed ? .tertiary : .secondary)
        }
    }
}

/// One session line for widgets: glyph · title / dot · "09:00 · 1:30" · state mark.
struct WidgetSessionRow: View {
    let line: SessionLine
    var intensity: IntensityClass? = nil
    var showsTime = true
    /// small label shown before the detail ("Tomorrow", "Mon")
    var prefix: String? = nil
    /// one line (title · detail) for lists of up to six rows (large Week widget)
    var compact = false
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        let dim = line.state == .missed || line.state == .skipped
        HStack(alignment: .center, spacing: Theme.Space.xs) {
            WidgetSportGlyph(sport: line.sport, font: .subheadline)
                .frame(width: 20)
                .opacity(dim ? 0.6 : 1)
            if compact {
                Text(line.title)
                    .font(line.isKey ? Font.footnote.weight(.semibold) : Font.footnote)
                    .strikethrough(line.state == .missed)
                    .foregroundStyle(r.text(dim ? c.fg4 : c.fg1, fallback: dim ? .tertiary : .primary))
                    .lineLimit(1)
                    .privacySensitive()
                Spacer(minLength: 4)
                if let intensity { WidgetZoneDot(intensity: intensity) }
                Text(detailText)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    .lineLimit(1)
                    .fixedSize()
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text(line.title)
                        .font(line.isKey ? Font.subheadline.weight(.semibold) : Font.subheadline)
                        .strikethrough(line.state == .missed)
                        .foregroundStyle(r.text(dim ? c.fg4 : c.fg1, fallback: dim ? .tertiary : .primary))
                        .lineLimit(1)
                        .privacySensitive()
                    HStack(spacing: 4) {
                        if let prefix {
                            Text(prefix)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(r.text(c.fg2, fallback: .secondary))
                        }
                        if let intensity { WidgetZoneDot(intensity: intensity) }
                        Text(detailText)
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 4)
            }
            if line.isKey {
                Image(systemName: "star.fill")
                    .font(.caption2)
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    .accessibilityHidden(true)
            }
            WidgetStateMark(state: line.state)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(prefix.map { $0 + ", " + line.accessibilityLabel } ?? line.accessibilityLabel)
    }

    private var detailText: String {
        // `time` and `detail` are already formatted by CadenceKit; this only picks which to show
        guard showsTime, let time = line.time else { return line.detail }
        return line.detail.isEmpty ? time : time + Format.dot + line.detail
    }
}

/// Seven-day strip: initial above a status mark; today = semibold initial on a surface step,
/// accent ink in full colour (the widget's one accent mark).
struct WeekStripView: View {
    let cells: [WeekStripCell]
    var showsTodayAccent = true
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        HStack(spacing: 0) {
            ForEach(cells) { cell in
                VStack(spacing: 4) {
                    Text(cell.initial)
                        .font(.caption2.weight(cell.isToday ? .bold : .regular))
                        .foregroundStyle(cell.isToday
                                         ? r.text(showsTodayAccent ? c.accentInk : c.fg1, fallback: .primary)
                                         : r.text(c.fg3, fallback: .secondary))
                        .frame(width: 20, height: 20)
                        .background {
                            if cell.isToday {
                                Circle().fill(r.isFullColor ? AnyShapeStyle(c.surface3) : AnyShapeStyle(.quaternary))
                            }
                        }
                        .widgetAccentable(cell.isToday)
                    WidgetToneMark(symbol: cell.symbol, tone: cell.tone, dimmed: cell.isDimmed)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(cell.accessibilityLabel)
            }
        }
    }
}

/// Normalised sparkline drawn as a path (no Charts dependency).
struct SparklineShape: Shape {
    let sparkline: Sparkline

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard sparkline.isDrawable else { return p }
        for i in sparkline.values.indices {
            let pt = sparkline.point(i)
            let xy = CGPoint(x: rect.minX + CGFloat(pt.x) * rect.width, y: rect.minY + CGFloat(pt.y) * rect.height)
            if i == 0 { p.move(to: xy) } else { p.addLine(to: xy) }
        }
        return p
    }
}

/// "Connect in the app" / "Nothing to show yet", sized for the family.
struct WidgetMessageView: View {
    let content: CadenceEntry.Content
    @Environment(\.widgetFamily) private var family
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let c = Theme.colors(accent)
        let r = RenderingInfo(mode: mode)
        let isSignedOut: Bool = {
            if case .signedOut = content { return true }
            return false
        }()
        let title = isSignedOut ? WidgetCopy.connectTitle : WidgetCopy.loadingTitle
        let message = isSignedOut ? WidgetCopy.connectMessage : WidgetCopy.loadingMessage
        let symbol = isSignedOut ? "link" : "arrow.clockwise"
        switch family {
        case .accessoryInline:
            Text(title)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: symbol).font(.title3).widgetAccentable()
            }
            .accessibilityLabel(title)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("Cadence").font(.headline).widgetAccentable()
                Text(title).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Image(systemName: symbol)
                    .font(.title3)
                    .foregroundStyle(r.text(c.fg2, fallback: .secondary))
                    .widgetAccentable()
                Spacer(minLength: 0)
                Text(title)
                    .font(Theme.Typography.title3)
                    .foregroundStyle(r.text(c.fg1))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(message)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(r.text(c.fg3, fallback: .secondary))
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

/// Root modifier for every Cadence widget view: accent environment, iOS 17 container background
/// (canvas on the Home Screen, nothing on the Lock Screen), and the tap target.
struct CadenceWidgetChrome: ViewModifier {
    let entry: CadenceEntry
    let link: DeepLink?
    @Environment(\.widgetFamily) private var family

    func body(content: Content) -> some View {
        let c = Theme.colors(entry.accent)
        content
            .environment(\.cadenceAccent, entry.accent)
            .widgetURL((link ?? .today).url)
            .containerBackground(for: .widget) {
                if isAccessory {
                    Color.clear
                } else {
                    c.canvas
                }
            }
    }

    private var isAccessory: Bool {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: return true
        default: return false
        }
    }
}

extension View {
    func cadenceWidgetChrome(_ entry: CadenceEntry, link: DeepLink?) -> some View {
        modifier(CadenceWidgetChrome(entry: entry, link: link))
    }
}
