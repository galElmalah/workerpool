import SwiftUI
import CadenceKit

/// The large session card (Today hero, day page): ONE surface, no border, no edge stripe. Sport glyph
/// tinted by sport, title, one status line (status mark in its status colour · time · zone dot ·
/// duration · distance or load), neutral key star, the mini profile, then the quick log or
/// "Send to watch". Completed sessions sit on a soft sport tint. Tapping opens the workout/activity.
@MainActor
struct SessionCardView: View {
    let card: SessionCardModel
    /// show the RPE / feel / note logger in the card (completed sessions)
    var showsLog: Bool = false
    var onLog: ((QuickLogChange) -> Void)? = nil
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var sending = false
    @State private var editingLog = false

    var body: some View {
        let c = Theme.colors(accent)
        let route = Route(card.target)
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: route) {
                header(c)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(card.accessibilityLabel)
            .accessibilityHint("Opens the \(card.activityId == nil ? "workout" : "activity")")

            footer(c)
        }
        .background(background(c))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .zoomSource(route)
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }

    private func background(_ c: ThemeColors) -> some View {
        ZStack {
            c.surface1
            if card.activityId != nil { DataColor.sportTint(card.sport) }
        }
    }

    private func header(_ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .top, spacing: Theme.Space.s) {
                SportMark(sport: card.sport, size: 24)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                    Text(card.title)
                        .font(Theme.Typography.title2)
                        .foregroundStyle(card.isDimmed ? c.fg3 : c.fg1)
                        .strikethrough(card.isStruck, color: c.fg4)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    statusLine(c)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if card.isKey {
                    KeyStarMark(isKey: true, font: .subheadline)
                        .padding(.top, 6)
                }
            }
            if card.profile.count > 1 {
                SessionProfileBars(values: card.profile, isPlan: card.profileIsPlan, height: 32)
                    .padding(.leading, 36)
            }
            if let note = card.preNote {
                Text("\u{201C}\(note)\u{201D}")
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                    .lineLimit(4)
                    .padding(.leading, 36)
            }
        }
        .padding(Theme.Space.card)
        .contentShape(Rectangle())
    }

    /// One wrapping line: ✓ On plan · 07:00 · ● 2:06 · 57.8 km
    private func statusLine(_ c: ThemeColors) -> some View {
        var text = Text(Image(systemName: card.statusSymbol))
            .foregroundStyle(DataColor.status(card.state) ?? c.fg3)
        text = text + Text(" " + card.statusText).foregroundStyle(c.fg2)
        if card.activityId == nil, let time = card.timeText {
            text = text + Text(Format.dot + time).foregroundStyle(c.fg3)
        }
        if let d = card.durationText {
            let dot = Text(Image(systemName: "circle.fill")).font(.system(size: 7)).foregroundStyle(DataColor.intensity(card.intensity))
            text = text + Text(Format.dot).foregroundStyle(c.fg3)
            text = text + dot
            text = text + Text(" " + d).foregroundStyle(c.fg2)
        }
        if let a = card.amountText {
            text = text + Text(Format.dot + a).foregroundStyle(c.fg2)
        }
        return text
            .font(Theme.Typography.numeric)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func footer(_ c: ThemeColors) -> some View {
        if let activityId = card.activityId, showsLog, let onLog, card.needsLog || editingLog {
            QuickLogView(activityId: activityId, rpe: card.rpe, feel: card.feel, note: card.postNote ?? "", onChange: onLog)
                .padding(.horizontal, Theme.Space.card)
                .padding(.bottom, Theme.Space.card)
                .transition(.opacity.combined(with: .move(edge: .top)))
        } else if let summary = card.logSummary {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                Text(summary)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if showsLog, onLog != nil {
                    Button("Edit") { withAnimation(Theme.Motion.smooth) { editingLog = true } }
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg2)
                        .buttonStyle(.borderless)
                }
            }
            .padding(.leading, Theme.Space.card + 36)
            .padding(.trailing, Theme.Space.card)
            .padding(.bottom, Theme.Space.card)
        } else if card.canSendToWatch, let id = card.workoutId {
            HStack(spacing: Theme.Space.s) {
                Button {
                    sending = true
                    Task {
                        await model.sendToWatch(id: id, title: card.title)
                        sending = false
                    }
                } label: {
                    Label(card.garmin?.sendButtonTitle ?? "Send to watch", systemImage: "applewatch.radiowaves.left.and.right")
                        .font(Theme.Typography.bodySmall.weight(.medium))
                }
                .buttonStyle(.bordered)
                .tint(c.fg2)
                .disabled(sending)
                if let status = card.garmin?.statusText(now: Date()) {
                    Text(status)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(c.fg3)
                        .lineLimit(2)
                } else if let env = card.environmentText {
                    Text(env)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(c.fg3)
                }
            }
            .padding(.leading, Theme.Space.card + 36)
            .padding(.trailing, Theme.Space.card)
            .padding(.bottom, Theme.Space.card)
        }
    }
}

/// A compact session row for lists (calendar day list, up next): sport glyph, title, one detail line,
/// zone dot, key star and the status mark in its colour. Completed rows sit on a soft sport tint.
@MainActor
struct SessionListRow: View {
    let card: SessionCardModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(alignment: .center, spacing: Theme.Space.s) {
            SportMark(sport: card.sport, size: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title)
                    .font(card.isKey ? Theme.Typography.body.weight(.semibold) : Theme.Typography.body)
                    .foregroundStyle(card.isDimmed ? c.fg3 : c.fg1)
                    .strikethrough(card.isStruck, color: c.fg4)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    ZoneDot(intensity: card.intensity, diameter: 6)
                    Text(detail)
                        .font(Theme.Typography.numeric)
                        .foregroundStyle(c.fg3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if card.isKey { KeyStarMark(isKey: true, font: .caption) }
            StatusMark(state: card.state, size: 15)
        }
        .padding(.vertical, Theme.Space.xs)
        .padding(.horizontal, Theme.Space.s)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(card.activityId != nil ? DataColor.sportTint(card.sport) : Color.clear)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.accessibilityLabel)
    }

    private var detail: String {
        [card.activityId == nil ? card.timeText : nil, card.durationText, card.amountText]
            .compactMap { $0 }
            .joined(separator: Format.dot)
    }
}
