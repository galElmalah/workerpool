import Foundation

/// Pure formatters for every number, unit and date the app and widgets show. They mirror
/// apps/web/src/lib/format.ts so both clients read the same:
///  - minus is U+2212 (−); deltas carry an explicit sign (+12%, −8%, ±0%);
///  - a narrow no-break space (U+202F) separates value and unit: "4:05 /km", "245 W";
///  - grouping is "12,500", decimals use "." (English, locale-independent on purpose);
///  - dates are `LocalDate` strings, never shifted by a time zone.
/// Missing values render as an em dash. Numbers in SwiftUI use `.monospacedDigit()`.
public enum Format {
    public static let minus = "\u{2212}"
    /// narrow no-break space between a value and its unit
    public static let unitSpace = "\u{202F}"
    public static let placeholder = "\u{2014}"
    public static let enDash = "\u{2013}"
    public static let dot = " \u{00B7} "

    public static let metresPerMile = 1609.344
    public static let metresPerYard = 0.9144
    public static let metresPerFoot = 0.3048
    public static let kgPerPound = 0.45359237

    // MARK: Numbers

    /// number(12500) → "12,500"; number(4.25, decimals: 1) → "4.3"; trim drops trailing zeros ("4" not "4.0").
    public static func number(_ value: Double?, decimals: Int = 0, trim: Bool = false) -> String {
        guard let value, value.isFinite else { return placeholder }
        var scaleInt = 1
        for _ in 0..<max(0, decimals) { scaleInt *= 10 }
        let scaledInt = Int((abs(value) * Double(scaleInt)).rounded(.toNearestOrAwayFromZero))
        let negative = value < 0 && scaledInt != 0
        let intPart = scaledInt / scaleInt
        var frac = scaledInt % scaleInt
        var fracDigits = decimals
        var out = grouped(intPart)
        if decimals > 0 {
            if trim {
                while fracDigits > 0 && frac % 10 == 0 { frac /= 10; fracDigits -= 1 }
            }
            if fracDigits > 0 { out += "." + zeroPad(frac, fracDigits) }
        }
        return negative ? minus + out : out
    }

    /// "+3", "−13", "0"
    public static func signed(_ value: Double?, decimals: Int = 0) -> String {
        guard let value, value.isFinite else { return placeholder }
        let s = number(abs(value), decimals: decimals)
        if s == number(0, decimals: decimals) { return s }
        return (value > 0 ? "+" : minus) + s
    }

    /// percent(0.92) → "92%"; percent(0.12, signed: true) → "+12%"; zero signed → "±0%".
    public static func percent(_ fraction: Double?, decimals: Int = 0, signed: Bool = false) -> String {
        guard let fraction, fraction.isFinite else { return placeholder }
        let v = fraction * 100
        if !signed { return number(v, decimals: decimals) + "%" }
        let body = number(abs(v), decimals: decimals)
        if body == number(0, decimals: decimals) { return "\u{00B1}" + body + "%" }
        return (v > 0 ? "+" : minus) + body + "%"
    }

    private static func grouped(_ n: Int) -> String {
        let digits = Array(String(n))
        var out = ""
        for (i, ch) in digits.enumerated() {
            if i > 0 && (digits.count - i) % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return out
    }

    // MARK: Durations

    public enum DurationStyle: Sendable {
        /// "1:25" (h:mm, rounded to the minute; "0:45" under an hour) — calendar, week totals
        case clock
        /// "1:15:30" / "45:30" / "0:42" — activity elapsed time, laps
        case hms
        /// "1h 25m", "45m", "2h", "40s" — prose
        case short
        /// "45m" under an hour, else "1:25" — widget lines, session rows
        case compact
    }

    public static func duration(_ seconds: Double?, style: DurationStyle = .clock) -> String {
        guard let seconds, seconds.isFinite else { return placeholder }
        let neg = seconds < 0
        let s = abs(seconds)
        var out: String
        switch style {
        case .hms:
            let t = Int(s.rounded())
            let h = t / 3600, m = (t % 3600) / 60, ss = t % 60
            out = h > 0 ? "\(h):\(zeroPad(m, 2)):\(zeroPad(ss, 2))" : "\(m):\(zeroPad(ss, 2))"
        case .clock, .short, .compact:
            let totalMin = Int((s / 60).rounded())
            let h = totalMin / 60, m = totalMin % 60
            switch style {
            case .clock:
                out = "\(h):\(zeroPad(m, 2))"
            case .compact:
                out = h > 0 ? "\(h):\(zeroPad(m, 2))" : (s < 60 ? "\(Int(s.rounded()))s" : "\(m)m")
            default:
                if s < 60 { out = "\(Int(s.rounded()))s" }
                else if h > 0 { out = m > 0 ? "\(h)h\(unitSpace)\(m)m" : "\(h)h" }
                else { out = "\(m)m" }
            }
        }
        return neg ? minus + out : out
    }

    /// Hours with one decimal: 9.75 h → "9.8"
    public static func hours(_ seconds: Double?) -> String {
        guard let seconds else { return placeholder }
        return number(seconds / 3600, decimals: 1)
    }

    // MARK: Distance, pace, speed

    public struct Parts: Hashable, Sendable {
        public var value: String
        public var unit: String
        public var joined: String { unit.isEmpty ? value : value + Format.unitSpace + unit }
    }

    /// Display unit for distances of a sport: swim m/yd, row m, others km/mi.
    public static func distanceUnit(sport: Sport, units: UnitSystem, swimYards: Bool = false) -> (unit: String, metresPer: Double) {
        if sport == .swim { return swimYards ? ("yd", metresPerYard) : ("m", 1) }
        if sport == .row { return ("m", 1) }
        return units == .imperial ? ("mi", metresPerMile) : ("km", 1000)
    }

    /// 42195 run → "42.2 km"; swim 2500 → "2,500 m"; row 5000 → "5,000 m" (row ≥ 10 km → "12.5 km").
    public static func distanceParts(_ metres: Double?, sport: Sport, units: UnitSystem = .metric, swimYards: Bool = false) -> Parts {
        let u = distanceUnit(sport: sport, units: units, swimYards: swimYards)
        guard let metres, metres.isFinite else { return Parts(value: placeholder, unit: u.unit) }
        let v = metres / u.metresPer
        if u.unit == "m" || u.unit == "yd" {
            if sport == .row && v >= 10_000 { return Parts(value: number(v / 1000, decimals: 1, trim: true), unit: "km") }
            return Parts(value: number(v), unit: u.unit)
        }
        return Parts(value: number(v, decimals: v < 100 ? 1 : 0, trim: true), unit: u.unit)
    }

    public static func distance(_ metres: Double?, sport: Sport, units: UnitSystem = .metric, swimYards: Bool = false) -> String {
        distanceParts(metres, sport: sport, units: units, swimYards: swimYards).joined
    }

    /// Pace basis per sport: run-like /km or /mi, swim /100m (/100yd), row /500m.
    public static func paceBasis(sport: Sport, units: UnitSystem, swimYards: Bool = false) -> (label: String, metres: Double) {
        if sport == .swim { return swimYards ? ("/100yd", 100 * metresPerYard) : ("/100m", 100) }
        if sport == .row { return ("/500m", 500) }
        return units == .imperial ? ("/mi", metresPerMile) : ("/km", 1000)
    }

    /// 4.08 m/s run → "4:05 /km"; swim → "1:45 /100m"; row → "1:52.4 /500m".
    public static func paceParts(_ mps: Double?, sport: Sport, units: UnitSystem = .metric, swimYards: Bool = false) -> Parts {
        let basis = paceBasis(sport: sport, units: units, swimYards: swimYards)
        guard let mps, mps.isFinite, mps > 0 else { return Parts(value: placeholder, unit: basis.label) }
        let secs = basis.metres / mps
        if sport == .row {
            let tenths = Int((secs * 10).rounded())
            let mm = tenths / 600
            let rest = tenths - mm * 600
            return Parts(value: "\(mm):\(zeroPad(rest / 10, 2)).\(rest % 10)", unit: basis.label)
        }
        let t = Int(secs.rounded())
        return Parts(value: "\(t / 60):\(zeroPad(t % 60, 2))", unit: basis.label)
    }

    public static func pace(_ mps: Double?, sport: Sport, units: UnitSystem = .metric, swimYards: Bool = false) -> String {
        paceParts(mps, sport: sport, units: units, swimYards: swimYards).joined
    }

    /// "32.4 km/h" / "20.1 mph"
    public static func speedParts(_ mps: Double?, units: UnitSystem = .metric) -> Parts {
        let unit = units == .imperial ? "mph" : "km/h"
        guard let mps, mps.isFinite else { return Parts(value: placeholder, unit: unit) }
        let v = units == .imperial ? mps * 3600 / metresPerMile : mps * 3.6
        return Parts(value: number(v, decimals: 1), unit: unit)
    }

    /// Sports read as pace rather than speed.
    public static func usesPace(_ sport: Sport) -> Bool {
        [.run, .swim, .row, .walk, .hike].contains(sport)
    }

    /// Pace for pace sports, speed otherwise.
    public static func speedOrPace(_ mps: Double?, sport: Sport, units: UnitSystem = .metric) -> String {
        usesPace(sport) ? pace(mps, sport: sport, units: units) : speedParts(mps, units: units).joined
    }

    // MARK: Body numbers

    /// Load is unitless ("88"); add the word "load" in copy where needed.
    public static func load(_ value: Double?) -> String { number(value) }
    public static func power(_ watts: Double?) -> String { Parts(value: number(watts), unit: "W").joined }
    public static func heartRate(_ bpm: Double?) -> String { Parts(value: number(bpm), unit: "bpm").joined }

    public static func elevation(_ metres: Double?, units: UnitSystem = .metric) -> String {
        guard let metres else { return Parts(value: placeholder, unit: units == .imperial ? "ft" : "m").joined }
        return units == .imperial ? Parts(value: number(metres / metresPerFoot), unit: "ft").joined : Parts(value: number(metres), unit: "m").joined
    }

    public static func weight(_ kg: Double?, units: UnitSystem = .metric) -> String {
        guard let kg else { return Parts(value: placeholder, unit: units == .imperial ? "lb" : "kg").joined }
        return units == .imperial ? Parts(value: number(kg / kgPerPound, decimals: 1), unit: "lb").joined : Parts(value: number(kg, decimals: 1), unit: "kg").joined
    }

    /// Fitness / fatigue (one decimal is noise on a phone): "66"; form is signed: "−6", "+12".
    public static func fitness(_ value: Double?) -> String { number(value) }
    public static func form(_ value: Double?) -> String { signed(value) }

    // MARK: Dates

    static let weekdaysShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    static let weekdaysLong = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    static let monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    /// "Sat"
    public static func weekdayShort(_ date: LocalDate) -> String {
        guard let d = Day(date) else { return placeholder }
        return weekdaysShort[d.isoWeekday - 1]
    }

    /// "S" — one letter for week strips.
    public static func weekdayInitial(_ date: LocalDate) -> String {
        String(weekdayShort(date).prefix(1))
    }

    /// "Sat 21"
    public static func dayShort(_ date: LocalDate) -> String {
        guard let d = Day(date) else { return placeholder }
        return "\(weekdaysShort[d.isoWeekday - 1]) \(d.day)"
    }

    /// "21 Nov"
    public static func dayMonth(_ date: LocalDate) -> String {
        guard let d = Day(date) else { return placeholder }
        return "\(d.day) \(monthsShort[d.month - 1])"
    }

    /// "Sat 21 Nov" (+ " 2026" with `withYear`)
    public static func dateMedium(_ date: LocalDate, withYear: Bool = false) -> String {
        guard let d = Day(date) else { return placeholder }
        return "\(weekdaysShort[d.isoWeekday - 1]) \(d.day) \(monthsShort[d.month - 1])" + (withYear ? " \(d.year)" : "")
    }

    /// "Saturday 21 November" (+ " 2026" with `withYear`)
    public static func dateLong(_ date: LocalDate, withYear: Bool = false) -> String {
        guard let d = Day(date) else { return placeholder }
        return "\(weekdaysLong[d.isoWeekday - 1]) \(d.day) \(monthsLong[d.month - 1])" + (withYear ? " \(d.year)" : "")
    }

    /// "November 2026"
    public static func monthYear(_ date: LocalDate) -> String {
        guard let d = Day(date.count == 7 ? date + "-01" : date) else { return placeholder }
        return "\(monthsLong[d.month - 1]) \(d.year)"
    }

    /// "Today", "Tomorrow", "Yesterday", "in 3 days", "in 36 days", "3 days ago"; beyond 99 days
    /// "in 4 months" / "in 2 years".
    public static func relativeDay(_ date: LocalDate, today: LocalDate) -> String {
        guard let d = Day(date), let t = Day(today) else { return placeholder }
        let n = t.days(until: d)
        switch n {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        default: break
        }
        let a = abs(n)
        var v = a
        var unit = "day"
        if a >= 730 { v = Int((Double(a) / 365.25).rounded()); unit = "year" }
        else if a >= 100 { v = Int((Double(a) / 30.44).rounded()); unit = "month" }
        let s = "\(v) \(unit)\(v == 1 ? "" : "s")"
        return n > 0 ? "in \(s)" : "\(s) ago"
    }

    /// Countdown copy for a race: "Today", "Tomorrow", "36 days".
    public static func countdown(daysTo: Int) -> String {
        switch daysTo {
        case 0: return "Today"
        case 1: return "Tomorrow"
        default: return "\(abs(daysTo)) days"
        }
    }

    /// "W47"
    public static func weekLabel(_ isoWeek: IsoWeek) -> String {
        guard let r = isoWeek.range(of: "-W"), let n = Int(isoWeek[r.upperBound...]) else { return isoWeek }
        return "W\(n)"
    }

    /// "16–22 Nov" or "30 Nov – 6 Dec"
    public static func weekRange(_ isoWeek: IsoWeek) -> String {
        guard let a = Day.isoWeekStart(isoWeek) else { return placeholder }
        let b = a.adding(days: 6)
        if a.month == b.month { return "\(a.day)\(enDash)\(b.day) \(monthsShort[b.month - 1])" }
        return "\(a.day) \(monthsShort[a.month - 1]) \(enDash) \(b.day) \(monthsShort[b.month - 1])"
    }

    /// "07:30" (24 h) or "7:30 am" from 'HH:MM'.
    public static func clock(_ hhmm: String?, hour12: Bool = false) -> String {
        guard let hhmm else { return placeholder }
        let p = hhmm.split(separator: ":")
        guard p.count >= 2, let h = Int(p[0]), let m = Int(p[1]) else { return placeholder }
        if !hour12 { return "\(zeroPad(h, 2)):\(zeroPad(m, 2))" }
        let hh = h % 12 == 0 ? 12 : h % 12
        return "\(hh):\(zeroPad(m, 2))\(unitSpace)\(h < 12 ? "am" : "pm")"
    }

    /// "just now", "5 min ago", "3 h ago", "2 days ago" — for "Updated …" lines.
    public static func ago(_ date: Date?, now: Date) -> String {
        guard let date else { return placeholder }
        let s = max(0, now.timeIntervalSince(date))
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60)) min ago" }
        if s < 86_400 { return "\(Int(s / 3600)) h ago" }
        let d = Int(s / 86_400)
        return "\(d) day\(d == 1 ? "" : "s") ago"
    }
}
