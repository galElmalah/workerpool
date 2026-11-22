import SwiftUI
import Charts
import CadenceKit

// Axis styling shared by every Cadence chart (DESIGN_V2 §5 + §8): at most 3 horizontal gridlines
// (line-1 hairlines), no vertical gridlines, no axis lines, axis text in the label style, fg3.
// Ticks and their labels come from CadenceKit view-models (`ChartTick`), never formatted here.

extension View {
    /// Numeric x and y axes from model ticks. `showsX: false` hides the x labels (stacked tracks).
    func cadenceAxes(xTicks: [ChartTick], yTicks: [ChartTick], showsX: Bool = true, accent: Accent) -> some View {
        modifier(NumericAxesModifier(xTicks: xTicks, yTicks: yTicks, showsX: showsX, accent: accent))
    }

    /// Categorical x axis (ISO weeks etc.) labelled only at `labelled`, numeric y from model ticks.
    func cadenceCategoryAxes(labelled: [String], label: @escaping (String) -> String, yTicks: [ChartTick], accent: Accent) -> some View {
        modifier(CategoryAxesModifier(labelled: labelled, label: label, yTicks: yTicks, accent: accent))
    }
}

private func tickLabel(_ ticks: [ChartTick], _ value: Double) -> String {
    ticks.first { abs($0.value - value) < 1e-9 }?.label ?? ""
}

@MainActor
private struct NumericAxesModifier: ViewModifier {
    let xTicks: [ChartTick]
    let yTicks: [ChartTick]
    let showsX: Bool
    let accent: Accent

    func body(content: Content) -> some View {
        let c = Theme.colors(accent)
        content
            .chartXAxis {
                AxisMarks(values: showsX ? xTicks.map(\.value) : []) { value in
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(tickLabel(xTicks, v))
                                .font(Theme.Typography.caption)
                                .foregroundStyle(c.fg3)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: yTicks.map(\.value)) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                        .foregroundStyle(c.line2)
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(tickLabel(yTicks, v))
                                .font(Theme.Typography.caption)
                                .foregroundStyle(c.fg3)
                        }
                    }
                }
            }
    }
}

@MainActor
private struct CategoryAxesModifier: ViewModifier {
    let labelled: [String]
    let label: (String) -> String
    let yTicks: [ChartTick]
    let accent: Accent

    func body(content: Content) -> some View {
        let c = Theme.colors(accent)
        content
            .chartXAxis {
                AxisMarks(values: labelled) { value in
                    AxisValueLabel {
                        if let v = value.as(String.self) {
                            Text(label(v))
                                .font(Theme.Typography.caption)
                                .foregroundStyle(c.fg3)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: yTicks.map(\.value)) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                        .foregroundStyle(c.line2)
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(tickLabel(yTicks, v))
                                .font(Theme.Typography.caption)
                                .foregroundStyle(c.fg3)
                        }
                    }
                }
            }
    }
}

/// Small coloured key + label, for direct labels and compact legends (the colour sits beside fg text).
@MainActor
struct ChartKey: View {
    let color: Color
    let label: String
    var value: String? = nil
    var dashed: Bool = false
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(spacing: 6) {
            Capsule()
                .fill(color)
                .frame(width: dashed ? 6 : 12, height: 3)
                .accessibilityHidden(true)
            Text(label)
                .font(Theme.Typography.caption)
                .foregroundStyle(c.fg2)
            if let value {
                Text(value)
                    .font(Theme.Typography.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(c.fg1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
