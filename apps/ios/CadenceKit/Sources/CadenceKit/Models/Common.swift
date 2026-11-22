import Foundation

// Conventions for every model file in this folder (scripts/check_fixtures.py parses them):
//  - one top-level `public struct` / `public enum` per type, no nesting;
//  - stored properties are `public var name: Type` on one line each; property name == JSON key;
//  - `/// fixture-ignore: a, b` above a struct lists JSON keys the app deliberately does not model;
//  - `/// fixture-flatten: Activity` above a struct means the JSON object also carries all of
//    `Activity`'s keys (decoded through a custom init).
// SI units everywhere: seconds, metres, m/s, watts, kg. Dates are strings (see `Day`).

/// 'YYYY-MM-DD' in the athlete's time zone. Use `Day` for arithmetic.
public typealias LocalDate = String
/// 'YYYY-Www', e.g. "2026-W47".
public typealias IsoWeek = String
/// ISO-8601 instant, e.g. "2026-11-21T07:30:00.000Z". Use `Instant.parse` to get a `Date`.
public typealias IsoInstant = String

/// String enums that decode unknown raw values as `.unknown` instead of failing.
/// Every conforming enum declares `case unknown` (it satisfies the `unknown` requirement).
public protocol TolerantEnum: RawRepresentable, Codable, Hashable, Sendable, CaseIterable where RawValue == String {
    static var unknown: Self { get }
}

extension TolerantEnum {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknown
    }

    /// All cases except `.unknown` (for pickers).
    public static var knownCases: [Self] { allCases.filter { $0 != Self.unknown } }
}

// MARK: - Domain enums (packages/core/src/domain.ts)

public enum Sport: String, TolerantEnum {
    case bike, run, swim, row, strength, hike, walk, yoga, ski, other
    case unknown
}

public enum SubSport: String, TolerantEnum {
    case road, indoor, mtb, gravel, virtual
    case roadRun = "road_run"
    case trail, treadmill, track
    case pool
    case openWater = "open_water"
    case erg
    case onWater = "on_water"
    case gym, bodyweight, mobility, hiit, generic
    case unknown
}

public enum IntensityClass: String, TolerantEnum {
    case recovery, endurance, tempo, threshold, high, race
    case unknown
}

public enum ComplianceState: String, TolerantEnum {
    case planned
    case onTarget = "on_target"
    case partialShort = "partial_short"
    case partialLong = "partial_long"
    case offShort = "off_short"
    case offLong = "off_long"
    case missed, excused, unplanned
    case unknown
}

public enum ComplianceMetric: String, TolerantEnum {
    case load, duration, distance
    case unknown
}

public enum FormZone: String, TolerantEnum {
    case transition, fresh, neutral, productive, overreaching
    case unknown
}

public enum Accent: String, TolerantEnum {
    case blue, green, rose
    case unknown
}

public enum UnitSystem: String, TolerantEnum {
    case metric, imperial
    case unknown
}

public enum SkipReason: String, TolerantEnum {
    case sick, injury, travel, fatigue, life, weather, other
    case unknown
}

public enum EventPriority: String, TolerantEnum {
    case a = "A"
    case b = "B"
    case c = "C"
    case unknown
}

public enum PhaseType: String, TolerantEnum {
    case base, build, peak, taper, race, recovery, transition
    case unknown
}

public enum DayMarkerType: String, TolerantEnum {
    case rest, sick, injured, travel, vacation, altitude
    case unknown
}

public enum LoadSource: String, TolerantEnum {
    case power, pace
    case swimPace = "swim_pace"
    case hr, rpe, duration, device, manual
    case unknown
}

public enum ActivitySource: String, TolerantEnum {
    case garmin, upload, manual, demo
    case unknown
}

public enum ThresholdKind: String, TolerantEnum {
    case ftp
    case runThreshold = "run_threshold"
    case swimCss = "swim_css"
    case rowThreshold = "row_threshold"
    case lthr
    case hrMax = "hr_max"
    case hrRest = "hr_rest"
    case weight
    case unknown
}

public enum ThresholdSource: String, TolerantEnum {
    case manual, garmin, estimated
    case unknown
}

public enum ReadinessState: String, TolerantEnum {
    case green, amber, red
    case unknown
}

public enum HrvStatus: String, TolerantEnum {
    case normal, suppressed, elevated
    case unknown
}

public enum DistributionType: String, TolerantEnum {
    case polarized, pyramidal, threshold
    case highIntensity = "high_intensity"
    case mixed
    case unknown
}

public enum IntensityBucket: String, TolerantEnum {
    case easy, moderate, hard
    case unknown
}

// MARK: - Shared small types

/// `{ "error": { "code", "message" } }` — every non-2xx response body.
public struct APIErrorEnvelope: Codable, Hashable, Sendable {
    public var error: APIErrorBody
}

public struct APIErrorBody: Codable, Hashable, Sendable {
    public var code: String
    public var message: String
}

/// Any JSON value, for the few loosely typed payloads (and for building arbitrary patches).
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var stringValue: String? { if case .string(let s) = self { return s } else { return nil } }
    public var doubleValue: Double? { if case .number(let n) = self { return n } else { return nil } }
    public var boolValue: Bool? { if case .bool(let b) = self { return b } else { return nil } }
}

/// A PATCH field: leave the property `nil` to omit the key, `.null` to clear it on the server,
/// `.value(x)` to set it. Encodes as `"key": null` / `"key": x`.
public enum Nullable<Wrapped: Codable & Hashable & Sendable>: Codable, Hashable, Sendable {
    case null
    case value(Wrapped)

    public init(_ value: Wrapped?) {
        if let value { self = .value(value) } else { self = .null }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self = c.decodeNil() ? .null : .value(try c.decode(Wrapped.self))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .value(let v): try c.encode(v)
        }
    }
}

/// Body of `204 No Content` responses.
public struct EmptyResponse: Codable, Hashable, Sendable {
    public init() {}
}
