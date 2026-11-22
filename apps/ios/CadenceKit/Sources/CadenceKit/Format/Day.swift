import Foundation

/// A calendar date without time or zone — the Swift side of `LocalDate` ('YYYY-MM-DD').
/// Pure integer arithmetic (proleptic Gregorian), so no time zone or DST can shift it.
public struct Day: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    public init?(year: Int, month: Int, day: Int) {
        guard (1...12).contains(month), day >= 1, day <= Day.daysInMonth(year: year, month: month) else { return nil }
        self.year = year; self.month = month; self.day = day
    }

    /// Parses 'YYYY-MM-DD' (extra characters after the date, e.g. a time, are ignored).
    public init?(_ string: String) {
        let parts = string.prefix(10).split(separator: "-")
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        self.init(year: y, month: m, day: d)
    }

    /// The local calendar day of `date` in `timeZone` (the device zone by default).
    public init(_ date: Date, timeZone: TimeZone = .current) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        self.year = c.year ?? 1970; self.month = c.month ?? 1; self.day = c.day ?? 1
    }

    fileprivate init(daysSinceEpoch z0: Int) {
        // Howard Hinnant's civil_from_days
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        self.year = yoe + era * 400 + (m <= 2 ? 1 : 0); self.month = m; self.day = d
    }

    /// Days since 1970-01-01.
    public var daysSinceEpoch: Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// 'YYYY-MM-DD'
    public var string: LocalDate {
        "\(zeroPad(year, 4))-\(zeroPad(month, 2))-\(zeroPad(day, 2))"
    }

    public var description: String { string }

    public func adding(days n: Int) -> Day { Day(daysSinceEpoch: daysSinceEpoch + n) }

    /// Whole days from `self` to `other` (positive when `other` is later).
    public func days(until other: Day) -> Int { other.daysSinceEpoch - daysSinceEpoch }

    /// 1 = Monday … 7 = Sunday
    public var isoWeekday: Int {
        let w = (daysSinceEpoch + 3) % 7 // 1970-01-01 was a Thursday (isoWeekday 4 → index 3)
        return (w < 0 ? w + 7 : w) + 1
    }

    public var weekStart: Day { adding(days: 1 - isoWeekday) }
    public var weekEnd: Day { adding(days: 7 - isoWeekday) }

    /// ISO-8601 week, e.g. "2026-W47".
    public var isoWeek: IsoWeek {
        let thursday = adding(days: 4 - isoWeekday)
        let jan1 = Day(year: thursday.year, month: 1, day: 1)!
        let week = jan1.days(until: thursday) / 7 + 1
        return "\(zeroPad(thursday.year, 4))-W\(zeroPad(week, 2))"
    }

    /// Monday of an ISO week ('YYYY-Www').
    public static func isoWeekStart(_ week: IsoWeek) -> Day? {
        let parts = week.split(separator: "-")
        guard parts.count == 2, let y = Int(parts[0]), parts[1].hasPrefix("W"), let w = Int(parts[1].dropFirst()) else { return nil }
        guard let jan4 = Day(year: y, month: 1, day: 4) else { return nil }
        return jan4.weekStart.adding(days: (w - 1) * 7)
    }

    /// Start of this day in `timeZone` as a `Date`.
    public func startDate(in timeZone: TimeZone = .current) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        return cal.date(from: DateComponents(year: year, month: month, day: day)) ?? Date(timeIntervalSince1970: 0)
    }

    public static func < (a: Day, b: Day) -> Bool { a.daysSinceEpoch < b.daysSinceEpoch }

    public static func daysInMonth(year: Int, month: Int) -> Int {
        switch month {
        case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    /// Every day from `from` through `to` inclusive.
    public static func range(_ from: Day, _ to: Day) -> [Day] {
        guard from <= to else { return [] }
        return (0...from.days(until: to)).map { from.adding(days: $0) }
    }
}

/// Left-pads a non-negative integer with zeros ("7" → "07").
func zeroPad(_ n: Int, _ width: Int) -> String {
    let s = String(abs(n))
    let padded = s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
    return n < 0 ? "-" + padded : padded
}

/// ISO-8601 instants from the API ("2026-11-21T07:30:00.000Z", with or without fractional seconds).
public enum Instant {
    public static func parse(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }

    public static func string(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}
