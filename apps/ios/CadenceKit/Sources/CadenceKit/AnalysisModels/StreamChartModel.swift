import Foundation

// Activity stream charts: picks the primary track per sport, smooths and downsamples every track,
// computes axes (≤ 3 gridlines), the scrubbing readout and the route polyline.

public enum StreamMetric: String, Hashable, Sendable, CaseIterable {
    case power, pace, speed, heartRate, cadence, elevation

    public var label: String {
        switch self {
        case .power: return "Power"
        case .pace: return "Pace"
        case .speed: return "Speed"
        case .heartRate: return "Heart rate"
        case .cadence: return "Cadence"
        case .elevation: return "Elevation"
        }
    }
}

/// A plotted point. `segment` separates runs broken by missing samples (one line per segment).
public struct StreamPoint: Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var segment: Int
}

public struct StreamTrack: Hashable, Sendable, Identifiable {
    public var id: StreamMetric { metric }
    public var metric: StreamMetric
    public var label: String
    public var unit: String
    public var isPrimary: Bool
    /// Plotted values. Pace is plotted as NEGATIVE seconds per unit so faster is higher; use
    /// `yTicks` labels (never format the raw plotted value yourself).
    public var points: [StreamPoint]
    public var yDomain: ClosedRange<Double>
    public var yTicks: [ChartTick]
    /// "avg 168 W" — one line of context under the track label
    public var summary: String?
}

public struct ReadoutItem: Hashable, Sendable, Identifiable {
    public var id: StreamMetric { metric }
    public var metric: StreamMetric
    public var label: String
    public var value: String
    public var unit: String
}

/// What the scrubbing readout shows for one x position.
public struct StreamReadout: Hashable, Sendable {
    public var x: Double
    /// "1:05:20"
    public var timeText: String
    /// "28.4 km" when distance is recorded
    public var distanceText: String?
    public var items: [ReadoutItem]
    /// position on the route (normalised), when a route exists
    public var routePoint: XYPoint?

    public var accessibilityText: String {
        var parts = [timeText]
        if let distanceText { parts.append(distanceText) }
        parts += items.map { "\($0.label) \($0.value)\($0.unit.isEmpty ? "" : " " + $0.unit)" }
        return parts.joined(separator: ", ")
    }
}

/// The route as a normalised polyline: x, y in 0…1, y down (screen space), aspect-correct
/// inside a unit square (the longer side spans 0…1, the shorter one is centred).
public struct RouteShape: Hashable, Sendable {
    public var points: [XYPoint]
    /// width / height of the route's bounding box
    public var aspectRatio: Double
    /// sample time (s) of each point, for the scrub marker
    public var times: [Double]

    public var start: XYPoint? { points.first }
    public var end: XYPoint? { points.last }

    public func point(atTime t: Double) -> XYPoint? {
        guard let i = ChartMath.nearestIndex(times, to: t), i < points.count else { return nil }
        return points[i]
    }

    /// Projects lat/lng (degrees) with an equirectangular projection at the mean latitude.
    /// nil with fewer than 2 valid positions or a degenerate (single-spot) route.
    public static func make(t: [Double], lat: [Double?]?, lng: [Double?]?, maxPoints: Int = 400) -> RouteShape? {
        guard let lat, let lng else { return nil }
        var raw: [(t: Double, lat: Double, lng: Double)] = []
        for i in 0..<min(t.count, lat.count, lng.count) {
            if let a = lat[i], let o = lng[i], a.isFinite, o.isFinite, abs(a) <= 90, abs(o) <= 180, !(a == 0 && o == 0) {
                raw.append((t[i], a, o))
            }
        }
        guard raw.count >= 2 else { return nil }
        let meanLat = raw.reduce(0) { $0 + $1.lat } / Double(raw.count)
        let k = cos(meanLat * .pi / 180)
        let xs = raw.map { $0.lng * k }
        let ys = raw.map { -$0.lat }
        guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else { return nil }
        let w = maxX - minX, h = maxY - minY
        let span = max(w, h)
        guard span > 1e-7 else { return nil }
        let offX = (span - w) / 2, offY = (span - h) / 2
        var pts: [XYPoint] = []
        var times: [Double] = []
        let stride = max(1, Int((Double(raw.count) / Double(max(2, maxPoints))).rounded(.up)))
        var i = 0
        while i < raw.count {
            pts.append(XYPoint(x: (xs[i] - minX + offX) / span, y: (ys[i] - minY + offY) / span))
            times.append(raw[i].t)
            i += stride
        }
        if times.last != raw[raw.count - 1].t {
            let j = raw.count - 1
            pts.append(XYPoint(x: (xs[j] - minX + offX) / span, y: (ys[j] - minY + offY) / span))
            times.append(raw[j].t)
        }
        return RouteShape(points: pts, aspectRatio: h > 0 ? w / h : 10, times: times)
    }
}

public struct StreamChartModel: Hashable, Sendable {
    public var sport: Sport
    public var units: UnitSystem
    /// primary first, then secondary tracks (elevation is separate)
    public var tracks: [StreamTrack]
    /// drawn as a faint area behind the primary track
    public var elevation: StreamTrack?
    public var xDomain: ClosedRange<Double>
    public var xTicks: [ChartTick]
    public var route: RouteShape?

    // raw samples for the readout
    private var t: [Double]
    private var raw: [StreamMetric: [Double?]]
    private var distance: [Double?]?

    public var primary: StreamTrack? { tracks.first { $0.isPrimary } }
    public var secondary: [StreamTrack] { tracks.filter { !$0.isPrimary } }
    public var isEmpty: Bool { tracks.isEmpty && elevation == nil }

    /// - Parameters:
    ///   - maxPoints: points per track after downsampling (LTTB)
    public init(streams s: ActivityStreams, sport: Sport, units: UnitSystem, maxPoints: Int = 300) {
        self.sport = sport
        self.units = units
        self.t = s.t
        self.distance = s.distance
        let duration = max(1, (s.t.last ?? 0) - (s.t.first ?? 0))
        self.xDomain = (s.t.first ?? 0)...((s.t.first ?? 0) + duration)
        self.xTicks = StreamChartModel.timeTicks(duration: duration, start: s.t.first ?? 0)

        // raw display values per metric
        var raw: [StreamMetric: [Double?]] = [:]
        if let p = s.power, StreamChartModel.hasSignal(p) { raw[.power] = p }
        if let hr = s.hr, StreamChartModel.hasSignal(hr) { raw[.heartRate] = hr }
        if let c = s.cadence, StreamChartModel.hasSignal(c) { raw[.cadence] = c }
        if let sp = s.speed, StreamChartModel.hasSignal(sp) {
            if Format.usesPace(sport) {
                let basis = Format.paceBasis(sport: sport, units: units).metres
                // < 0.5 m/s is standing still: no pace sample (avoids huge spikes)
                raw[.pace] = sp.map { v in v.flatMap { $0 > 0.5 ? basis / $0 : nil } }
            } else {
                let k = units == .imperial ? 3600 / Format.metresPerMile : 3.6
                raw[.speed] = sp.map { v in v.map { $0 * k } }
            }
        }
        if let alt = s.altitude, alt.contains(where: { $0 != nil }) {
            raw[.elevation] = units == .imperial ? alt.map { v in v.map { $0 / Format.metresPerFoot } } : alt
        }
        self.raw = raw

        let primaryMetric = StreamChartModel.primaryMetric(sport: sport, available: Set(raw.keys))
        var order: [StreamMetric] = []
        if let primaryMetric { order.append(primaryMetric) }
        for m in [StreamMetric.heartRate, .power, .pace, .speed, .cadence] where m != primaryMetric && raw[m] != nil {
            // keep secondary tracks to what the athlete reads: HR always, cadence, and the
            // second output measure only when it is not just the primary in other units
            if m == .speed && primaryMetric == .power { continue }
            order.append(m)
        }
        let smoothWindow = duration / 150
        var tracks: [StreamTrack] = []
        for m in order {
            guard let values = raw[m] else { continue }
            let smooth = (m == .power || m == .pace || m == .speed) ? smoothWindow : (m == .cadence ? smoothWindow / 2 : 0)
            if let track = StreamChartModel.makeTrack(metric: m, isPrimary: m == primaryMetric, t: s.t, values: values,
                                                       sport: sport, units: units, smoothWindow: smooth, maxPoints: maxPoints) {
                tracks.append(track)
            }
        }
        self.tracks = tracks
        if let alt = raw[.elevation] {
            self.elevation = StreamChartModel.makeTrack(metric: .elevation, isPrimary: false, t: s.t, values: alt, sport: sport,
                                                        units: units, smoothWindow: 0, maxPoints: maxPoints)
        } else {
            self.elevation = nil
        }
        self.route = RouteShape.make(t: s.t, lat: s.lat, lng: s.lng)
    }

    /// Power for bike (and row when measured); pace for run/walk/hike/swim/row; else HR.
    public static func primaryMetric(sport: Sport, available: Set<StreamMetric>) -> StreamMetric? {
        let prefs: [StreamMetric]
        switch sport {
        case .bike: prefs = [.power, .speed, .heartRate]
        case .row: prefs = [.power, .pace, .heartRate]
        case .run, .walk, .hike, .swim: prefs = [.pace, .heartRate, .power]
        case .ski: prefs = [.speed, .heartRate]
        default: prefs = [.heartRate, .power, .pace, .speed]
        }
        return prefs.first { available.contains($0) } ?? [.heartRate, .power, .pace, .speed, .cadence].first { available.contains($0) }
    }

    static func hasSignal(_ values: [Double?]) -> Bool {
        values.contains { ($0 ?? 0) > 0 }
    }

    public static func unit(_ m: StreamMetric, sport: Sport, units: UnitSystem) -> String {
        switch m {
        case .power: return "W"
        case .heartRate: return "bpm"
        case .cadence: return sport == .bike ? "rpm" : "spm"
        case .pace: return Format.paceBasis(sport: sport, units: units).label
        case .speed: return units == .imperial ? "mph" : "km/h"
        case .elevation: return units == .imperial ? "ft" : "m"
        }
    }

    /// Formats a display value (pace in seconds per unit) without its unit.
    public static func format(_ m: StreamMetric, _ v: Double, sport: Sport) -> String {
        switch m {
        case .pace:
            if sport == .row {
                let tenths = Int((v * 10).rounded())
                return "\(tenths / 600):\(zeroPad((tenths % 600) / 10, 2)).\(tenths % 10)"
            }
            let s = Int(v.rounded())
            return "\(s / 60):\(zeroPad(s % 60, 2))"
        case .speed: return Format.number(v, decimals: 1)
        default: return Format.number(v)
        }
    }

    static func makeTrack(metric m: StreamMetric, isPrimary: Bool, t: [Double], values: [Double?], sport: Sport, units: UnitSystem,
                          smoothWindow: Double, maxPoints: Int) -> StreamTrack? {
        // zeros are real samples for power/cadence (coasting) but not for HR/elevation-less data
        let cleaned: [Double?] = values.map { v in
            guard let v, v.isFinite else { return nil }
            if m == .heartRate && v <= 0 { return nil }
            return v
        }
        let segs = ChartMath.segments(x: t, y: cleaned)
        let all = segs.flatMap { $0 }.map(\.y)
        guard all.count >= 2 else { return nil }
        let total = segs.reduce(0) { $0 + $1.count }
        var points: [StreamPoint] = []
        for (i, seg) in segs.enumerated() {
            let smoothed = smoothWindow > 0 ? ChartMath.movingAverage(seg, window: smoothWindow) : seg
            let share = max(2, Int((Double(maxPoints) * Double(seg.count) / Double(max(1, total))).rounded()))
            let reduced = ChartMath.lttb(smoothed, threshold: max(3, share))
            points += reduced.map { StreamPoint(x: $0.x, y: m == .pace ? -$0.y : $0.y, segment: i) }
        }
        // domain: robust (1st–99th percentile of plotted values), padded; power/HR/cadence/speed from a floor
        let plotted = points.map(\.y)
        guard var lo = ChartMath.percentile(plotted, 0.01), var hi = ChartMath.percentile(plotted, 0.99) else { return nil }
        if m == .power || m == .cadence || m == .speed { lo = 0 }
        if hi <= lo { hi = lo + 1 }
        let pad = (hi - lo) * 0.08
        if m != .power && m != .cadence && m != .speed { lo -= pad }
        hi += pad
        let domain = lo...hi
        points = points.map { p in StreamPoint(x: p.x, y: min(hi, max(lo, p.y)), segment: p.segment) }
        let ticks = ChartMath.niceTicks(lo: lo, hi: hi, maxCount: 3).map { v in
            ChartTick(value: v, label: format(m, m == .pace ? -v : v, sport: sport))
        }
        let unit = unit(m, sport: sport, units: units)
        return StreamTrack(metric: m, label: m.label, unit: unit, isPrimary: isPrimary, points: points, yDomain: domain,
                           yTicks: ticks, summary: summary(m, values: cleaned, t: t, sport: sport, unit: unit))
    }

    /// "avg 168 W" (time-weighted over samples), "gain 722 m" for elevation.
    static func summary(_ m: StreamMetric, values: [Double?], t: [Double], sport: Sport, unit: String) -> String? {
        if m == .elevation {
            var gain = 0.0
            var last: Double?
            for v in values { if let v { if let l = last, v > l { gain += v - l }; last = v } }
            return "gain \(Format.number(gain))\(Format.unitSpace)\(unit)"
        }
        var sum = 0.0, weight = 0.0
        for i in 0..<min(values.count, t.count) {
            guard let v = values[i] else { continue }
            let dt = i + 1 < t.count ? max(0, min(t[i + 1] - t[i], 30)) : 1
            sum += v * dt; weight += dt
        }
        guard weight > 0 else { return nil }
        return "avg \(format(m, sum / weight, sport: sport))\(Format.unitSpace)\(unit)"
    }

    /// Ticks every 5/10/15/20/30/60/90/120 min so that at most 4 fit.
    public static func timeTicks(duration: Double, start: Double = 0) -> [ChartTick] {
        let steps: [Double] = [60, 120, 300, 600, 900, 1200, 1800, 3600, 5400, 7200, 10_800, 14_400, 21_600]
        let step = steps.first { duration / $0 <= 4 } ?? 43_200
        var out: [ChartTick] = []
        var v = step
        while v < duration - step * 0.25 {
            out.append(ChartTick(value: start + v, label: Format.duration(v, style: .clock)))
            v += step
        }
        return out
    }

    /// Readout for the sample nearest to `x` (seconds), from the raw (unsmoothed) values.
    public func readout(at x: Double) -> StreamReadout? {
        guard let i = ChartMath.nearestIndex(t, to: x) else { return nil }
        var items: [ReadoutItem] = []
        for track in tracks {
            guard let series = raw[track.metric], i < series.count, let v = series[i] else { continue }
            if track.metric == .heartRate && v <= 0 { continue }
            items.append(ReadoutItem(metric: track.metric, label: track.label,
                                     value: StreamChartModel.format(track.metric, v, sport: sport), unit: track.unit))
        }
        if let e = elevation, let series = raw[.elevation], i < series.count, let v = series[i] {
            items.append(ReadoutItem(metric: .elevation, label: e.label, value: Format.number(v), unit: e.unit))
        }
        var distanceText: String?
        if let d = distance, i < d.count, let m = d[i], m > 0 {
            distanceText = Format.distance(m, sport: sport, units: units)
        }
        return StreamReadout(x: t[i], timeText: Format.duration(t[i] - (t.first ?? 0), style: .hms), distanceText: distanceText,
                             items: items, routePoint: route?.point(atTime: t[i]))
    }

    /// "Power, avg 168 W, from 0 to 704 W" — the VoiceOver summary of a track.
    public func accessibilitySummary(_ track: StreamTrack) -> String {
        var parts = [track.label]
        if let s = track.summary { parts.append(s) }
        if let series = raw[track.metric] {
            let vals = series.compactMap { $0 }.filter { track.metric != .heartRate || $0 > 0 }
            if let lo = vals.min(), let hi = vals.max() {
                let a = StreamChartModel.format(track.metric, track.metric == .pace ? hi : lo, sport: sport)
                let b = StreamChartModel.format(track.metric, track.metric == .pace ? lo : hi, sport: sport)
                parts.append("range \(a) to \(b) \(track.unit)")
            }
        }
        return parts.joined(separator: ", ")
    }
}
