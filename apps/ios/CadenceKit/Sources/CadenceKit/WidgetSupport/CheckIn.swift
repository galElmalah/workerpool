import Foundation

// Morning check-in ("How do you feel this morning?", 1 very tired … 5 very fresh — the web app's
// scale) for the interactive widget and the "Log how I feel" shortcut.
// `PUT /api/wellness/:date {feel}`; the last answer is kept in the App Group so the widget shows the
// logged state at once (and offline), and a failed send is retried on the next timeline reload.

public enum CheckInScale {
    public static let question = "How do you feel this morning?"
    /// index 0 = feel 1
    public static let labels = ["Very tired", "Tired", "Normal", "Fresh", "Very fresh"]
    public static let range = 1...5

    /// "Fresh" for 4; nil outside 1…5
    public static func label(for feel: Int) -> String? {
        range.contains(feel) ? labels[feel - 1] : nil
    }
}

/// The last check-in this phone knows about.
public struct CheckInRecord: Codable, Hashable, Sendable {
    public var date: LocalDate
    /// 1…5
    public var feel: Int
    public var savedAt: Date
    /// false until the server accepted it
    public var synced: Bool

    public init(date: LocalDate, feel: Int, savedAt: Date, synced: Bool) {
        self.date = date
        self.feel = feel
        self.savedAt = savedAt
        self.synced = synced
    }
}

/// App Group storage for the last check-in (`AppGroupConfig.defaults`). Thread-safe enough for one
/// writer at a time (UserDefaults is).
public struct CheckInStore: @unchecked Sendable {
    public static let key = "cadence.checkin.last"
    public let defaults: UserDefaults

    public init(defaults: UserDefaults) { self.defaults = defaults }

    public func load() -> CheckInRecord? {
        guard let data = defaults.data(forKey: CheckInStore.key) else { return nil }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return try? d.decode(CheckInRecord.self, from: data)
    }

    /// The record for `date`, if the last one is for that day.
    public func record(for date: LocalDate) -> CheckInRecord? {
        guard let r = load(), r.date == date else { return nil }
        return r
    }

    public func save(_ record: CheckInRecord) {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970
        if let data = try? e.encode(record) { defaults.set(data, forKey: CheckInStore.key) }
    }

    public func clear() { defaults.removeObject(forKey: CheckInStore.key) }

    /// The record still waiting for the server, if any (only today's or yesterday's are worth sending).
    public func pending(now: Date, timeZone: TimeZone = .current) -> CheckInRecord? {
        guard let r = load(), !r.synced, let day = Day(r.date) else { return nil }
        let age = day.days(until: Day(now, timeZone: timeZone))
        return (0...1).contains(age) ? r : nil
    }
}

public struct CheckInOption: Hashable, Sendable, Identifiable {
    public var id: Int { value }
    /// 1…5
    public var value: Int
    /// "1"
    public var valueText: String
    /// "Very tired"
    public var label: String
    public var isSelected: Bool
    /// "Very tired, 1 of 5" (+ ", selected")
    public var accessibilityLabel: String
}

public struct CheckInWidgetModel: Hashable, Sendable {
    /// "How do you feel this morning?" (or "Today's check-in" once logged)
    public var title: String
    /// "Sun 22 Nov"
    public var dateText: String
    public var date: LocalDate
    public var options: [CheckInOption]
    public var isLogged: Bool
    /// "Logged · Fresh", "Fresh · not synced yet", or nil before the check-in
    public var statusText: String?
    public var deepLink: DeepLink
}

extension WidgetModels {
    /// The check-in widget for the local day of `now`; `record` is ignored unless it is for that day.
    public static func checkIn(record: CheckInRecord?, now: Date, timeZone: TimeZone = .current) -> CheckInWidgetModel {
        let date = Day(now, timeZone: timeZone).string
        let r = (record?.date == date) ? record : nil
        let selected = r.map(\.feel)
        let options = CheckInScale.range.map { v -> CheckInOption in
            let label = CheckInScale.labels[v - 1]
            let isSelected = v == selected
            return CheckInOption(value: v, valueText: "\(v)", label: label, isSelected: isSelected,
                                 accessibilityLabel: "\(label), \(v) of 5" + (isSelected ? ", selected" : ""))
        }
        var status: String?
        if let r, let label = CheckInScale.label(for: r.feel) {
            status = r.synced ? "Logged" + Format.dot + label : label + Format.dot + "not synced yet"
        }
        return CheckInWidgetModel(
            title: r == nil ? CheckInScale.question : "Today's check-in",
            dateText: Format.dateMedium(date),
            date: date,
            options: options,
            isLogged: r != nil,
            statusText: status,
            deepLink: .checkIn(date: date)
        )
    }
}
