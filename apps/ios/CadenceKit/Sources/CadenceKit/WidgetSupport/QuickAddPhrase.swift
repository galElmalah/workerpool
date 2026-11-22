import Foundation

/// Splits a spoken/typed quick-add phrase into the date and the workout text the server parses.
///
/// The server's quick-add grammar (`POST /api/workouts/quick`, packages/core parseQuickAdd) reads
/// "run 45m easy", "bike 2h @key #long", "run 6x800m @5k"… but takes the date as a separate field.
/// A date phrase at the end or the start is lifted out here, with the web palette's vocabulary:
/// "today", "tomorrow"/"tmr", "yesterday", weekdays ("tue", "on tuesday", "next tue", "this sat";
/// "tue" means the coming Tuesday, a week ahead when said on a Tuesday), "dec 24"/"24 dec",
/// "2026-12-24", "+2d", "in 3 days". Without one the workout goes on `today`.
public struct QuickAddPhrase: Hashable, Sendable {
    /// LocalDate the workout goes on
    public var date: LocalDate
    /// the phrase without the date words, e.g. "run 45m easy"
    public var text: String
    /// false when no date phrase was found (defaulted to today)
    public var hasExplicitDate: Bool

    public init(date: LocalDate, text: String, hasExplicitDate: Bool) {
        self.date = date
        self.text = text
        self.hasExplicitDate = hasExplicitDate
    }

    static let weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    static let weekdayWords: [String: Int] = {
        var m: [String: Int] = [:]
        let full = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for (i, w) in weekdays.enumerated() { m[w] = i + 1 }
        for (i, w) in full.enumerated() { m[w] = i + 1 }
        m["tues"] = 2; m["weds"] = 3; m["thur"] = 4; m["thurs"] = 4
        return m
    }()
    static let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

    public static func parse(_ raw: String, today: LocalDate) -> QuickAddPhrase {
        let words = raw.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init)
        guard let t = Day(today), !words.isEmpty else {
            return QuickAddPhrase(date: today, text: words.joined(separator: " "), hasExplicitDate: false)
        }
        // longest phrase first, at the end, then at the start
        for n in stride(from: min(3, words.count - 1), through: 1, by: -1) {
            let tail = Array(words.suffix(n))
            if let d = date(tail, today: t) {
                var rest = Array(words.dropLast(n))
                if let last = rest.last?.lowercased(), last == "on" || last == "for" { rest.removeLast() }
                if !rest.isEmpty { return QuickAddPhrase(date: d.string, text: rest.joined(separator: " "), hasExplicitDate: true) }
            }
            let head = Array(words.prefix(n))
            if let d = date(head, today: t) {
                let rest = Array(words.dropFirst(n))
                if !rest.isEmpty { return QuickAddPhrase(date: d.string, text: rest.joined(separator: " "), hasExplicitDate: true) }
            }
        }
        return QuickAddPhrase(date: today, text: words.joined(separator: " "), hasExplicitDate: false)
    }

    /// A date for exactly these words, or nil.
    static func date(_ words: [String], today: Day) -> Day? {
        var w = words.map { $0.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ",.!?")) }
        if w.first == "on" || w.first == "for" { w.removeFirst() }
        guard !w.isEmpty else { return nil }
        let phrase = w.joined(separator: " ")
        switch phrase {
        case "today", "tonight", "this morning", "this evening": return today
        case "tomorrow", "tmr", "tomorrow morning", "tomorrow evening": return today.adding(days: 1)
        case "yesterday": return today.adding(days: -1)
        case "day after tomorrow": return today.adding(days: 2)
        default: break
        }
        if w.count == 1, let d = Day(w[0]), w[0].count == 10 { return d }
        // "+2d", "+1w"
        if w.count == 1, w[0].hasPrefix("+"), let unit = w[0].last, unit == "d" || unit == "w",
           let n = Int(w[0].dropFirst().dropLast()), (0...400).contains(n) {
            return today.adding(days: unit == "w" ? n * 7 : n)
        }
        // "in 3 days", "in 2 weeks"
        if w.count == 3, w[0] == "in", let n = Int(w[1]), (0...400).contains(n) {
            if w[2] == "day" || w[2] == "days" { return today.adding(days: n) }
            if w[2] == "week" || w[2] == "weeks" { return today.adding(days: n * 7) }
        }
        // "tue", "next tuesday", "this sat"
        var modifier: String?
        var dayWord = w[0]
        if w.count == 2, w[0] == "next" || w[0] == "this" { modifier = w[0]; dayWord = w[1] }
        if (w.count == 1 || modifier != nil), let target = weekdayWords[dayWord] {
            var delta = (target - today.isoWeekday + 7) % 7
            if delta == 0 && modifier != "this" { delta = 7 }
            return today.adding(days: delta)
        }
        // "dec 24", "24 dec", "december 24th"
        if w.count == 2 {
            let (a, b) = (w[0], w[1])
            let dayFirst = Int(a.trimmingCharacters(in: CharacterSet.letters))
            let dayLast = Int(b.trimmingCharacters(in: CharacterSet.letters))
            let monA = months.firstIndex(of: String(a.prefix(3))).flatMap { a.allSatisfy(\.isLetter) ? $0 : nil }
            let monB = months.firstIndex(of: String(b.prefix(3))).flatMap { b.allSatisfy(\.isLetter) ? $0 : nil }
            var dm: (Int, Int)?
            if let m = monA, let d = dayLast { dm = (d, m + 1) }
            else if let m = monB, let d = dayFirst { dm = (d, m + 1) }
            if let dm {
                // the nearest occurrence within ±6 months
                for year in [today.year, today.year + 1, today.year - 1] {
                    if let c = Day(year: year, month: dm.1, day: dm.0), abs(today.days(until: c)) <= 183 { return c }
                }
            }
        }
        return nil
    }
}
