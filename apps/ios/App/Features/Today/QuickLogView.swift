import SwiftUI
import CadenceKit

/// One change from the quick log (the screen applies it optimistically and saves it).
enum QuickLogChange {
    case rpe(Int?)
    case feel(Int?)
    case note(String)
}

/// "Log how it went": RPE 1–10 as ten thumb-sized segments, feel as five words, an optional note
/// that saves as you type. Two taps to done.
@MainActor
struct QuickLogView: View {
    let activityId: String
    let rpe: Int?
    let feel: Int?
    let note: String
    let onChange: (QuickLogChange) -> Void
    @Environment(\.cadenceAccent) private var accent
    @State private var draft = ""
    @State private var loadedNote: String? = nil

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text("How hard?")
                        .font(Theme.Typography.label)
                        .foregroundStyle(c.fg3)
                    Spacer()
                    Text(rpe.map { "RPE \($0) \u{00B7} \(LogScales.rpeWord($0) ?? "")" } ?? "RPE")
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(rpe == nil ? c.fg4 : c.fg1)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(Theme.Motion.snappy, value: rpe)
                }
                RPESegments(value: rpe) { onChange(.rpe($0)) }
            }
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Text("How did it feel?")
                    .font(Theme.Typography.label)
                    .foregroundStyle(c.fg3)
                ChoiceChips(labels: LogScales.activityFeel, value: feel, accessibilityName: "Feel") { onChange(.feel($0)) }
            }
            TextField("A note for the journal", text: $draft, axis: .vertical)
                .font(Theme.Typography.bodySmall)
                .foregroundStyle(c.fg1)
                .lineLimit(1...5)
                .padding(.horizontal, Theme.Space.s)
                .padding(.vertical, Theme.Space.xs)
                .background(c.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .task(id: draft) {
                    // autosave a moment after typing stops
                    guard draft != (loadedNote ?? note) else { return }
                    try? await Task.sleep(for: .milliseconds(900))
                    guard !Task.isCancelled else { return }
                    loadedNote = draft
                    onChange(.note(draft))
                }
        }
        .onAppear {
            if loadedNote == nil {
                draft = note
                loadedNote = note
            }
        }
    }
}

/// RPE 1…10: ten segments that fill up to the chosen value, toned along the zone ramp.
@MainActor
struct RPESegments: View {
    let value: Int?
    let onSelect: (Int?) -> Void
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(spacing: 3) {
            ForEach(1...10, id: \.self) { n in
                let on = (value ?? 0) >= n
                Button {
                    onSelect(value == n ? nil : n)
                } label: {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(on ? DataColor.zone(LogScales.rpeRamp(n)) : c.surface2)
                        .frame(height: 30)
                        .overlay(
                            Text("\(n)")
                                .font(.caption2.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(on ? Color.white : c.fg3)
                        )
                }
                .buttonStyle(.plain)
                .frame(minWidth: 22, maxWidth: .infinity)
                .accessibilityLabel("\(n), \(LogScales.rpeWord(n) ?? "")")
                .accessibilityAddTraits(value == n ? .isSelected : [])
            }
        }
        .animation(Theme.Motion.snappy, value: value)
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("RPE")
    }
}

/// A row of word choices (feel, soreness). Scrolls sideways at large text sizes instead of squeezing.
@MainActor
struct ChoiceChips: View {
    let labels: [String]
    let value: Int?
    let accessibilityName: String
    let onSelect: (Int?) -> Void
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.xs) {
                ForEach(Array(labels.enumerated()), id: \.offset) { i, label in
                    let n = i + 1
                    let selected = value == n
                    Button {
                        onSelect(selected ? nil : n)
                    } label: {
                        Text(label)
                            .font(Theme.Typography.bodySmall.weight(selected ? .semibold : .regular))
                            .foregroundStyle(selected ? c.fg1 : c.fg2)
                            .lineLimit(1)
                            .padding(.horizontal, Theme.Space.s)
                            .padding(.vertical, Theme.Space.xs)
                            .background(selected ? c.surfaceActive : c.surface2, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(accessibilityName): \(label)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
        .scrollClipDisabled()
        .animation(Theme.Motion.snappy, value: value)
        .sensoryFeedback(.selection, trigger: value)
    }
}
