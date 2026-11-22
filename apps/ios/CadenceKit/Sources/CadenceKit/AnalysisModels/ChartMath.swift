import Foundation

// Pure helpers for chart preparation (ticks, downsampling, smoothing). Used by the activity
// stream charts and the trends charts; the SwiftUI side only draws what these produce.

/// One axis tick: the plotted value and its label.
public struct ChartTick: Hashable, Sendable {
    public var value: Double
    public var label: String

    public init(value: Double, label: String) {
        self.value = value
        self.label = label
    }
}

/// A plain (x, y) point.
public struct XYPoint: Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public enum ChartMath {
    /// A "nice" step (1, 2, 2.5, 5 × 10ⁿ) close to `raw`.
    public static func niceStep(_ raw: Double) -> Double {
        guard raw.isFinite, raw > 0 else { return 1 }
        let exp = floor(log10(raw))
        let base = pow(10, exp)
        let f = raw / base
        let nice: Double
        if f <= 1 { nice = 1 } else if f <= 2 { nice = 2 } else if f <= 2.5 { nice = 2.5 } else if f <= 5 { nice = 5 } else { nice = 10 }
        return nice * base
    }

    /// At most `maxCount` evenly stepped values inside `lo...hi` (DESIGN_V2: ≤ 3 gridlines).
    public static func niceTicks(lo: Double, hi: Double, maxCount: Int = 3) -> [Double] {
        guard lo.isFinite, hi.isFinite, maxCount > 0 else { return [] }
        if hi <= lo { return [lo] }
        var step = niceStep((hi - lo) / Double(max(1, maxCount - 1)))
        var out: [Double] = []
        for _ in 0..<6 {
            out = []
            var v = ceil(lo / step) * step
            while v <= hi + step * 1e-9 {
                out.append(abs(v) < step * 1e-9 ? 0 : v)
                v += step
            }
            if out.count <= maxCount { break }
            step = niceStep(step * 1.01 * 2)
        }
        return out
    }

    /// Value at percentile `p` (0…1) of an unsorted array (nearest rank). nil when empty.
    public static func percentile(_ values: [Double], _ p: Double) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let rank = Int((min(1, max(0, p)) * Double(sorted.count - 1)).rounded())
        return sorted[rank]
    }

    /// Largest-Triangle-Three-Buckets downsampling: keeps the visual shape (peaks, troughs) of a
    /// line with at most `threshold` points. Input must be sorted by x. Returns the input when it
    /// is already small enough.
    public static func lttb(_ points: [XYPoint], threshold: Int) -> [XYPoint] {
        let n = points.count
        guard threshold >= 3, n > threshold else { return points }
        var sampled: [XYPoint] = [points[0]]
        sampled.reserveCapacity(threshold)
        let every = Double(n - 2) / Double(threshold - 2)
        var a = 0
        for i in 0..<(threshold - 2) {
            // average of the next bucket
            let avgStart = Int(floor(Double(i + 1) * every)) + 1
            let avgEnd = min(Int(floor(Double(i + 2) * every)) + 1, n)
            var avgX = 0.0, avgY = 0.0
            let avgLen = max(1, avgEnd - avgStart)
            if avgStart < avgEnd {
                for j in avgStart..<avgEnd { avgX += points[j].x; avgY += points[j].y }
            } else {
                avgX = points[n - 1].x; avgY = points[n - 1].y
            }
            avgX /= Double(avgLen); avgY /= Double(avgLen)
            // this bucket
            let rangeStart = Int(floor(Double(i) * every)) + 1
            let rangeEnd = min(Int(floor(Double(i + 1) * every)) + 1, n - 1)
            let pa = points[a]
            var maxArea = -1.0
            var next = rangeStart
            if rangeStart < rangeEnd {
                for j in rangeStart..<rangeEnd {
                    let area = abs((pa.x - avgX) * (points[j].y - pa.y) - (pa.x - points[j].x) * (avgY - pa.y))
                    if area > maxArea { maxArea = area; next = j }
                }
            }
            sampled.append(points[next])
            a = next
        }
        sampled.append(points[n - 1])
        return sampled
    }

    /// Centred moving average over an x window (same length as the input; x unchanged).
    /// Works with irregular x spacing. `window <= 0` returns the input.
    public static func movingAverage(_ points: [XYPoint], window: Double) -> [XYPoint] {
        guard window > 0, points.count > 2 else { return points }
        let half = window / 2
        var out = points
        var lo = 0, hi = 0
        var sum = 0.0
        for i in 0..<points.count {
            let x = points[i].x
            while hi < points.count && points[hi].x <= x + half { sum += points[hi].y; hi += 1 }
            while lo < hi && points[lo].x < x - half { sum -= points[lo].y; lo += 1 }
            let count = hi - lo
            out[i].y = count > 0 ? sum / Double(count) : points[i].y
        }
        return out
    }

    /// Index of the element of a sorted array closest to `x` (nil when empty).
    public static func nearestIndex(_ sorted: [Double], to x: Double) -> Int? {
        guard !sorted.isEmpty else { return nil }
        var lo = 0, hi = sorted.count - 1
        while lo < hi {
            let mid = (lo + hi) / 2
            if sorted[mid] < x { lo = mid + 1 } else { hi = mid }
        }
        if lo > 0 && abs(sorted[lo - 1] - x) <= abs(sorted[lo] - x) { return lo - 1 }
        return lo
    }

    /// Splits an optional series into runs of consecutive non-nil values (gaps break a line).
    public static func segments(x: [Double], y: [Double?]) -> [[XYPoint]] {
        var out: [[XYPoint]] = []
        var current: [XYPoint] = []
        for i in 0..<min(x.count, y.count) {
            if let v = y[i], v.isFinite {
                current.append(XYPoint(x: x[i], y: v))
            } else if !current.isEmpty {
                out.append(current)
                current = []
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }
}
