import Foundation

// Form widget sparkline and the Next race widget, on top of `FormWidgetModel` / `RaceWidgetModel`.

/// A line chart reduced to normalised points: x = index / (count − 1), y = 0 (bottom) … 1 (top).
/// Views draw it with a `Path` scaled to their frame; nothing to compute in SwiftUI.
public struct Sparkline: Hashable, Sendable {
    /// 0…1 per point, oldest first
    public var values: [Double]
    /// "Fitness 66, up 3 in 6 weeks"
    public var accessibilityLabel: String

    public var isDrawable: Bool { values.count >= 2 }

    /// Normalised (x, y) for point `i`, y measured from the top (SwiftUI coordinates), both 0…1.
    public func point(_ i: Int) -> (x: Double, y: Double) {
        guard values.count > 1, values.indices.contains(i) else { return (0, 0.5) }
        return (Double(i) / Double(values.count - 1), 1 - values[i])
    }
}

/// Next race widget.
public struct RaceWidgetDisplay: Hashable, Sendable {
    /// nil when no race is coming up (show `WidgetCopy.noRaceTitle`)
    public var race: RaceWidgetModel?
    /// hero: "36", or "Tomorrow" / "Today"
    public var heroText: String
    /// "days to go" after a number, nil after "Tomorrow" / "Today"
    public var heroUnit: String?
    /// medium: this week's summary, "W47 · 7:48 of 9:45 · Load 464"
    public var weekLine: String
    public var accessibilityLabel: String
    public var deepLink: DeepLink
}

extension WidgetModels {
    /// Fitness over the snapshot's 42 days (the hero series), padded so a flat line sits mid-height.
    public static func fitnessSparkline(_ s: MobileSnapshot) -> Sparkline {
        let fitness = s.fitnessSeries.map(\.fitness)
        guard let lo = fitness.min(), let hi = fitness.max() else {
            return Sparkline(values: [], accessibilityLabel: "No fitness history yet")
        }
        let span = hi - lo
        let pad = span > 0 ? span * 0.1 : 1
        let low = lo - pad
        let range = (hi + pad) - low
        let values = fitness.map { range > 0 ? ($0 - low) / range : 0.5 }
        var label = "Fitness " + Format.fitness(fitness.last)
        if let first = fitness.first, let last = fitness.last, fitness.count >= 2 {
            let delta = (last - first).rounded()
            let weeks = Int((Double(fitness.count - 1) / 7).rounded())
            let period = weeks >= 2 ? "in \(weeks) weeks" : "in \(fitness.count - 1) days"
            if delta == 0 { label += ", unchanged \(period)" }
            else { label += ", \(delta > 0 ? "up" : "down") \(Format.number(abs(delta))) \(period)" }
        }
        return Sparkline(values: values, accessibilityLabel: label)
    }

    public static func raceDisplay(_ s: MobileSnapshot, now: Date, timeZone: TimeZone = .current) -> RaceWidgetDisplay {
        let r = race(s, now: now, timeZone: timeZone)
        let w = week(s, now: now, timeZone: timeZone)
        let weekLine = joinNonEmpty([s.week.label, "\(w.doneText) \(w.plannedText)", "Load " + Format.load(s.week.doneLoad)])
        guard let r else {
            return RaceWidgetDisplay(race: nil, heroText: WidgetCopy.noRaceTitle, heroUnit: nil, weekLine: weekLine,
                                     accessibilityLabel: WidgetCopy.noRaceTitle, deepLink: .calendar(date: nil))
        }
        let numeric = r.daysTo >= 2
        let hero = numeric ? "\(r.daysTo)" : r.countdownText
        let unit: String? = numeric ? "days to go" : nil
        let spokenWhen = numeric ? "in \(r.daysTo) days" : r.countdownText.lowercased()
        return RaceWidgetDisplay(
            race: r,
            heroText: hero,
            heroUnit: unit,
            weekLine: weekLine,
            accessibilityLabel: "\(r.name), \(r.priorityText), \(spokenWhen), \(r.dateText)",
            deepLink: r.deepLink
        )
    }
}
