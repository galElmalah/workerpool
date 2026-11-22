import Foundation

// Drafts behind the "new workout" and "edit basics" forms: the views bind to these values and ask
// them for the request body, so the rules (title fallback, rounding, what changed) are tested here.

/// "HH:MM" wall-clock times ↔ `Date` for the system time pickers.
public enum ClockTime {
    /// "07:05"
    public static func string(hour: Int, minute: Int) -> String {
        "\(zeroPad(min(23, max(0, hour)), 2)):\(zeroPad(min(59, max(0, minute)), 2))"
    }

    /// "07:05" → (7, 5)
    public static func parse(_ hhmm: String?) -> (hour: Int, minute: Int)? {
        guard let hhmm else { return nil }
        let p = hhmm.split(separator: ":")
        guard p.count >= 2, let h = Int(p[0]), let m = Int(p[1]), (0...23).contains(h), (0...59).contains(m) else { return nil }
        return (h, m)
    }

    /// The wall-clock time of `date` in `timeZone` as "HH:MM".
    public static func string(from date: Date, timeZone: TimeZone = .current) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.hour, .minute], from: date)
        return string(hour: c.hour ?? 0, minute: c.minute ?? 0)
    }

    /// A `Date` on `day` at "HH:MM" (09:00 when nil/invalid) for a time picker.
    public static func date(_ hhmm: String?, on day: LocalDate, timeZone: TimeZone = .current) -> Date {
        let t = parse(hhmm) ?? (hour: 9, minute: 0)
        let base = (Day(day) ?? Day(Date(), timeZone: timeZone)).startDate(in: timeZone)
        return base.addingTimeInterval(TimeInterval(t.hour * 3600 + t.minute * 60))
    }
}

/// `LocalDate` ↔ `Date` for the system date pickers (midnight in the device zone).
public enum PickerDate {
    public static func date(_ local: LocalDate, timeZone: TimeZone = .current) -> Date {
        (Day(local) ?? Day(Date(), timeZone: timeZone)).startDate(in: timeZone)
    }

    public static func local(_ date: Date, timeZone: TimeZone = .current) -> LocalDate {
        Day(date, timeZone: timeZone).string
    }
}

/// Durations in the forms: minutes, stepped by 5 (1 below 10 minutes).
public enum DurationField {
    public static let range = 5...600

    public static func step(below minutes: Int) -> Int { minutes < 10 ? 1 : 5 }

    /// "45m", "1h 30m"
    public static func text(minutes: Int) -> String { Format.duration(Double(minutes) * 60, style: .short) }

    /// Seconds → whole minutes for editing (nil stays nil).
    public static func minutes(_ seconds: Double?) -> Int? {
        guard let seconds, seconds > 0 else { return nil }
        return max(1, Int((seconds / 60).rounded()))
    }
}

public struct NewWorkoutDraft: Hashable, Sendable {
    public var date: LocalDate
    public var sport: Sport
    public var title: String
    public var durationMin: Int
    public var intensity: IntensityClass
    public var isKey: Bool
    /// "HH:MM" or nil (untimed)
    public var startTime: String?

    public init(date: LocalDate, sport: Sport = .run, title: String = "", durationMin: Int = 45,
                intensity: IntensityClass = .endurance, isKey: Bool = false, startTime: String? = nil) {
        self.date = date; self.sport = sport; self.title = title; self.durationMin = durationMin
        self.intensity = intensity; self.isKey = isKey; self.startTime = startTime
    }

    /// Placeholder / fallback title: "Endurance run", "Threshold ride".
    public var suggestedTitle: String {
        let s = sport == .unknown ? "session" : sport.label.lowercased()
        return intensity == .unknown ? sport.label : "\(intensity.label) \(s)"
    }

    public var isValid: Bool { Day(date) != nil && sport != .unknown && durationMin > 0 }

    public var durationText: String { DurationField.text(minutes: durationMin) }

    public func input() -> WorkoutInput {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return WorkoutInput(date: date, sport: sport, title: t.isEmpty ? suggestedTitle : t, startTime: startTime,
                            plannedDurationSec: Double(durationMin * 60), isKey: isKey, intensity: intensity)
    }
}

/// Edit the basics of an existing workout (title, date, time, duration).
public struct WorkoutEditDraft: Hashable, Sendable {
    public var title: String
    public var date: LocalDate
    /// nil = untimed
    public var startTime: String?
    /// nil = no planned duration
    public var durationMin: Int?

    public init(_ w: PlannedWorkout) {
        title = w.title
        date = w.date
        startTime = w.startTime
        durationMin = DurationField.minutes(w.plannedDurationSec)
    }

    /// Only the fields that differ from `original`; nil when nothing changed.
    public func patch(from original: PlannedWorkout) -> WorkoutPatch? {
        var p = WorkoutPatch()
        var changed = false
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty && t != original.title { p.title = t; changed = true }
        if date != original.date && Day(date) != nil { p.date = date; changed = true }
        if startTime != original.startTime { p.startTime = Nullable(startTime); changed = true }
        if durationMin != DurationField.minutes(original.plannedDurationSec) {
            p.plannedDurationSec = Nullable(durationMin.map { Double($0 * 60) })
            changed = true
        }
        return changed ? p : nil
    }

    public var isValid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && Day(date) != nil }
}
