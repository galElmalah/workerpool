import Foundation

// Words for the small rating scales the app asks for (web: features/today/kit.tsx). One place so the
// Today quick log, the day page and the activity page say the same thing.

public enum LogScales {
    /// Morning check-in "How do you feel this morning?" (1…5)
    public static let checkInFeel = ["Very tired", "Tired", "Normal", "Fresh", "Very fresh"]
    /// Morning soreness (1 none … 5 very sore)
    public static let soreness = ["None", "A little", "Some", "Sore", "Very sore"]
    /// Post-activity feel (1 awful … 5 great)
    public static let activityFeel = ["Awful", "Poor", "Okay", "Good", "Great"]
    /// RPE 1…10
    public static let rpeWords = ["Very easy", "Easy", "Easy", "Steady", "Moderate", "Moderate", "Hard", "Very hard", "Very hard", "Max"]
    /// zone-ramp index (1…7) per RPE value, for the segment fill
    static let rpeRamps = [1, 2, 2, 3, 3, 4, 5, 5, 6, 7]

    /// `labels[value - 1]`, nil when out of range.
    public static func label(_ labels: [String], _ value: Int?) -> String? {
        guard let value, value >= 1, value <= labels.count else { return nil }
        return labels[value - 1]
    }

    public static func rpeWord(_ rpe: Int?) -> String? { label(rpeWords, rpe) }

    /// Zone-ramp index for an RPE value (1…10 → 1…7).
    public static func rpeRamp(_ rpe: Int) -> Int { rpeRamps[min(9, max(0, rpe - 1))] }

    /// "RPE 4 · Felt okay · “57.8 km, coffee…”" — nil when nothing is logged.
    public static func activitySummary(rpe: Int?, feel: Int?, note: String?) -> String? {
        var parts: [String] = []
        if let rpe { parts.append("RPE \(rpe)") }
        if let f = label(activityFeel, feel) { parts.append("Felt \(f.lowercased())") }
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            parts.append("\u{201C}\(note)\u{201D}")
        }
        return parts.isEmpty ? nil : parts.joined(separator: Format.dot)
    }
}
