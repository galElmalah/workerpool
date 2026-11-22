import Foundation

// Extra activity-detail fields the backend reports (`locationName` and `facts` on
// `GET /api/activities/:id`, packages/core/src/domain.ts `ActivityFacts`). Decoded separately from the
// same response (the shared `Models/` types do not carry them yet), every field optional, so an older
// server or a missing fact simply shows nothing. When `Models/Activity.swift` gains these fields this
// type can be dropped and `ActivityMetrics` read them from `ActivityDetail` directly.

public struct ActivityExtraSensor: Codable, Hashable, Sendable {
    public var kind: String
    public var name: String?
}

/// `ActivityDetail.facts` (all optional).
public struct ActivityExtraFacts: Codable, Hashable, Sendable {
    public var startLat: Double?
    public var startLng: Double?
    public var endLat: Double?
    public var endLng: Double?
    public var timezone: String?
    public var timerSec: Double?
    public var pausedSec: Double?
    public var pauseCount: Double?
    public var maxSpeedMps: Double?
    public var elevationLossM: Double?
    public var minAltitudeM: Double?
    public var maxAltitudeM: Double?
    public var maxGradePct: Double?
    public var minGradePct: Double?
    public var minHr: Double?
    public var powerBalanceLeftPct: Double?
    public var maxCadence: Double?
    public var avgGroundContactMs: Double?
    public var avgGroundContactBalanceLeftPct: Double?
    public var avgVerticalOscillationCm: Double?
    public var avgVerticalRatioPct: Double?
    public var avgStrideLengthM: Double?
    public var steps: Double?
    public var activeLengths: Double?
    public var avgStrokesPerLength: Double?
    public var avgDistancePerStrokeM: Double?
    public var totalStrokes: Double?
    public var avgTempC: Double?
    public var minTempC: Double?
    public var maxTempC: Double?
    public var deviceLoad: Double?
    public var trainingEffectLabel: String?
    public var sweatLossMl: Double?
    public var deviceName: String?
    public var deviceSoftware: String?
    public var sensors: [ActivityExtraSensor]?
    public var sportProfile: String?

    public init() {}
}

/// The extra top-level fields of an activity detail response.
public struct ActivityExtras: Hashable, Sendable, Decodable {
    public var locationName: String?
    public var facts: ActivityExtraFacts?

    public init(locationName: String? = nil, facts: ActivityExtraFacts? = nil) {
        self.locationName = locationName
        self.facts = facts
    }

    enum CodingKeys: String, CodingKey { case locationName, facts }

    /// Tolerant: a malformed `facts` object (or field) never fails the whole decode.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        locationName = (try? c.decodeIfPresent(String.self, forKey: .locationName)) ?? nil
        facts = (try? c.decodeIfPresent(ActivityExtraFacts.self, forKey: .facts)) ?? nil
    }

    /// The same request as `Endpoints.activity(id:)` (same cache key), decoded as extras: after
    /// `client.activity(id:)` succeeded, `client.cached(ActivityExtras.endpoint(id:))` reads the
    /// extras from the stored response without another request.
    public static func endpoint(id: String) -> Endpoint<ActivityExtras> {
        let ep = Endpoints.activity(id: id)
        return Endpoint<ActivityExtras>(ep.method, ep.path, query: ep.query, body: nil, requiresAuth: ep.requiresAuth, cacheKey: ep.cacheKey)
    }

    /// "Tempo", "VO2 max", "Anaerobic capacity" from Garmin's "TEMPO", "VO2MAX", "ANAEROBIC_CAPACITY".
    public static func trainingEffectText(_ raw: String) -> String {
        let up = raw.uppercased()
        if up == "VO2MAX" || up == "VO2_MAX" { return "VO2 max" }
        if up == "LACTATE_THRESHOLD" { return "Threshold" }
        let words = raw.replacingOccurrences(of: "_", with: " ").lowercased()
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}
