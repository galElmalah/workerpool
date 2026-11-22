import Foundation

// Journal feed (day notes, workout intentions, activity reflections, week reflections).

public enum JournalFilter: String, CaseIterable, Hashable, Sendable, Identifiable {
    case everything, dayNotes, workouts, weekly

    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .everything: return "Everything"
        case .dayNotes: return "Day notes"
        case .workouts: return "Workouts"
        case .weekly: return "Weekly"
        }
    }

    /// Types sent to `GET /api/journal?type=` (empty = all).
    public var types: [JournalType] {
        switch self {
        case .everything: return []
        case .dayNotes: return [.day]
        case .workouts: return [.workoutPre, .activityPost]
        case .weekly: return [.week]
        }
    }
}

/// Where tapping an entry goes.
public enum JournalTarget: Hashable, Sendable {
    case day(LocalDate)
    case week(IsoWeek)
    case workout(id: String)
    case activity(id: String)
}

public struct JournalEntryModel: Hashable, Sendable, Identifiable {
    public var id: String
    public var type: JournalType
    public var sport: Sport?
    /// SF Symbol for the entry kind (sport glyph for workout notes)
    public var symbol: String
    /// "Sun 27"
    public var dayText: String
    /// "Weekly reflection · Week 52 reflection" / "Reflection · Long ride 2h05 · RPE 4"
    public var metaText: String
    public var body: String
    public var target: JournalTarget?
    public var accessibilityLabel: String

    public init(item i: JournalItem) {
        type = i.type
        sport = i.sport
        id = "\(i.type.rawValue):\(i.ref):\(i.date)"
        dayText = Format.dayShort(i.date)
        body = i.body.trimmingCharacters(in: .whitespacesAndNewlines)
        let kind = JournalEntryModel.kindLabel(i.type)
        var meta = [kind]
        if !i.title.isEmpty && i.type != .day { meta.append(i.title) }
        if let rpe = i.rpe { meta.append("RPE \(rpe)") }
        if let feel = i.feel { meta.append("felt \(EffortScale.feelLabel(feel).lowercased())") }
        metaText = meta.joined(separator: Format.dot)
        switch i.type {
        case .week: symbol = "calendar"; target = .week(i.ref)
        case .day: symbol = "note.text"; target = .day(i.ref.isEmpty ? i.date : i.ref)
        case .workoutPre: symbol = i.sport?.symbolName ?? "figure.run"; target = .workout(id: i.ref)
        case .activityPost: symbol = i.sport?.symbolName ?? "figure.run"; target = .activity(id: i.ref)
        case .unknown: symbol = "note.text"; target = nil
        }
        accessibilityLabel = [Format.dateLong(i.date), metaText, body].joined(separator: ", ")
    }

    public static func kindLabel(_ t: JournalType) -> String {
        switch t {
        case .week: return "Weekly reflection"
        case .day: return "Day note"
        case .workoutPre: return "Intention"
        case .activityPost: return "Reflection"
        case .unknown: return "Note"
        }
    }
}

public struct JournalSection: Hashable, Sendable, Identifiable {
    /// "2026-11"
    public var id: String
    /// "November 2026"
    public var title: String
    public var entries: [JournalEntryModel]
}

public enum JournalModel {
    /// Month sections in feed order; duplicate entries (same id across pages) are dropped.
    public static func sections(_ items: [JournalItem]) -> [JournalSection] {
        var out: [JournalSection] = []
        var seen = Set<String>()
        for item in items {
            let e = JournalEntryModel(item: item)
            guard seen.insert(e.id).inserted else { continue }
            let key = String(item.date.prefix(7))
            if let last = out.indices.last, out[last].id == key {
                out[last].entries.append(e)
            } else {
                out.append(JournalSection(id: key, title: Format.monthYear(key), entries: [e]))
            }
        }
        return out
    }

    /// "Today · Saturday 21 November"
    public static func composeTitle(today: LocalDate) -> String { "Today\(Format.dot)\(Format.dateLong(today))" }

    public static let composePrompt = "How did today feel? Sleep, legs, mood, anything worth remembering."

    /// Empty-state copy per filter / search.
    public static func emptyText(filter: JournalFilter, query: String) -> String {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty { return "Nothing you wrote matches “\(query)”." }
        switch filter {
        case .everything: return "Notes, intentions and reflections you write appear here."
        case .dayNotes: return "No day notes yet."
        case .workouts: return "No workout notes yet."
        case .weekly: return "No weekly reflections yet."
        }
    }
}

// MARK: - Autosave state (week note, activity note, day note)

public enum NoteSaveState: Hashable, Sendable {
    case idle, saving, saved, failed(String)

    /// "Saving…", "Saved", "Not saved: You're offline." — nil when idle
    public var text: String? {
        switch self {
        case .idle: return nil
        case .saving: return "Saving…"
        case .saved: return "Saved"
        case .failed(let m): return "Not saved: \(m)"
        }
    }
}
