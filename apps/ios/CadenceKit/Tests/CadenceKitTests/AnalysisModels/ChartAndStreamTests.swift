import XCTest
@testable import CadenceKit

final class ChartMathTests: XCTestCase {
    func testNiceTicksAtMostThree() {
        XCTAssertEqual(ChartMath.niceTicks(lo: 0, hi: 100, maxCount: 3), [0, 50, 100])
        XCTAssertEqual(ChartMath.niceTicks(lo: 0, hi: 704, maxCount: 3), [0, 500])
        let t = ChartMath.niceTicks(lo: -25, hi: 80, maxCount: 3)
        XCTAssertLessThanOrEqual(t.count, 3)
        XCTAssertTrue(t.contains(0))
        XCTAssertEqual(ChartMath.niceTicks(lo: 5, hi: 5), [5])
    }

    func testNiceStep() {
        XCTAssertEqual(ChartMath.niceStep(0.7), 1)
        XCTAssertEqual(ChartMath.niceStep(1.8), 2)
        XCTAssertEqual(ChartMath.niceStep(23), 25)
        XCTAssertEqual(ChartMath.niceStep(260), 500)
    }

    func testPercentile() {
        XCTAssertNil(ChartMath.percentile([], 0.5))
        XCTAssertEqual(ChartMath.percentile([5, 1, 3], 0.5), 3)
        XCTAssertEqual(ChartMath.percentile([5, 1, 3], 0), 1)
        XCTAssertEqual(ChartMath.percentile([5, 1, 3], 1), 5)
    }

    func testLTTBKeepsEndsAndPeak() {
        var pts: [XYPoint] = (0..<1000).map { XYPoint(x: Double($0), y: sin(Double($0) / 50)) }
        pts[500].y = 10 // a spike
        let out = ChartMath.lttb(pts, threshold: 100)
        XCTAssertEqual(out.count, 100)
        XCTAssertEqual(out.first, pts.first)
        XCTAssertEqual(out.last, pts.last)
        XCTAssertTrue(out.contains { $0.y == 10 }, "the spike survives downsampling")
        XCTAssertEqual(out.map(\.x), out.map(\.x).sorted(), "x stays sorted")
        XCTAssertEqual(ChartMath.lttb(Array(pts.prefix(50)), threshold: 100).count, 50, "small input returned as-is")
    }

    func testMovingAverage() {
        let flat = (0..<10).map { XYPoint(x: Double($0), y: 4) }
        XCTAssertEqual(ChartMath.movingAverage(flat, window: 3).map(\.y), Array(repeating: 4, count: 10))
        let step = [XYPoint(x: 0, y: 0), XYPoint(x: 1, y: 0), XYPoint(x: 2, y: 9), XYPoint(x: 3, y: 9)]
        let s = ChartMath.movingAverage(step, window: 2)
        XCTAssertEqual(s[1].y, 3, accuracy: 1e-9) // mean of 0, 0, 9
        XCTAssertEqual(s.map(\.x), [0, 1, 2, 3])
    }

    func testNearestIndex() {
        let xs: [Double] = [0, 5, 10, 20]
        XCTAssertEqual(ChartMath.nearestIndex(xs, to: -3), 0)
        XCTAssertEqual(ChartMath.nearestIndex(xs, to: 6), 1)
        XCTAssertEqual(ChartMath.nearestIndex(xs, to: 16), 3)
        XCTAssertEqual(ChartMath.nearestIndex(xs, to: 99), 3)
        XCTAssertNil(ChartMath.nearestIndex([], to: 1))
    }

    func testSegmentsBreakOnGaps() {
        let segs = ChartMath.segments(x: [0, 1, 2, 3, 4], y: [1, nil, 2, 3, nil])
        XCTAssertEqual(segs.count, 2)
        XCTAssertEqual(segs[1].map(\.x), [2, 3])
    }
}

final class StreamChartModelTests: XCTestCase {
    private func bikeStreams(n: Int = 3600) -> ActivityStreams {
        let t = (0..<n).map(Double.init)
        return ActivityStreams(t: t,
                               hr: t.map { 120 + 20 * sin($0 / 300) },
                               power: t.map { 200 + 50 * sin($0 / 60) },
                               speed: t.map { _ in 9.0 },
                               cadence: t.map { _ in 88 },
                               altitude: t.map { 100 + $0 / 36 },
                               distance: t.map { $0 * 9 },
                               lat: t.map { 41.9 + $0 / 100_000 },
                               lng: t.map { 2.8 + $0 / 50_000 })
    }

    func testBikePrimaryIsPowerAndDownsampled() {
        let m = StreamChartModel(streams: bikeStreams(), sport: .bike, units: .metric, maxPoints: 200)
        XCTAssertEqual(m.primary?.metric, .power)
        XCTAssertEqual(m.secondary.map(\.metric), [.heartRate, .cadence], "speed is not repeated next to power")
        XCTAssertLessThanOrEqual(m.primary?.points.count ?? 0, 202)
        XCTAssertEqual(m.primary?.unit, "W")
        XCTAssertEqual(m.primary?.yDomain.lowerBound, 0)
        XCTAssertLessThanOrEqual(m.primary?.yTicks.count ?? 99, 3)
        XCTAssertNotNil(m.elevation)
        XCTAssertNotNil(m.route)
        XCTAssertEqual(m.xTicks.map(\.label), ["0:15", "0:30", "0:45"])
    }

    func testElevationBackdropFitsLowerPartOfDomain() {
        let m = StreamChartModel(streams: bikeStreams(), sport: .bike, units: .metric)
        let d = m.primary!.yDomain
        let (base, pts) = m.elevationBackdrop(in: d, share: 0.5)
        XCTAssertEqual(base, d.lowerBound)
        XCTAssertFalse(pts.isEmpty)
        let top = d.lowerBound + (d.upperBound - d.lowerBound) * 0.5
        XCTAssertTrue(pts.allSatisfy { $0.y >= base - 1e-9 && $0.y <= top + 1e-9 })
        XCTAssertGreaterThan(pts.last!.y, pts.first!.y, "climbing route rises")
    }

    func testReadoutUsesRawValues() {
        let m = StreamChartModel(streams: bikeStreams(), sport: .bike, units: .metric)
        let r = m.readout(at: 1800.4)
        XCTAssertEqual(r?.timeText, "30:00")
        XCTAssertEqual(r?.items.first?.metric, .power)
        XCTAssertEqual(r?.items.first?.value, Format.number(200 + 50 * sin(1800.0 / 60)))
        XCTAssertEqual(r?.distanceText, "16.2\u{202F}km")
        XCTAssertNotNil(r?.routePoint)
        XCTAssertTrue(r?.accessibilityText.hasPrefix("30:00, 16.2") ?? false)
    }

    func testRunPaceIsPlottedNegativeWithPaceLabels() {
        let t = (0..<1200).map(Double.init)
        let s = ActivityStreams(t: t, hr: t.map { _ in 150 }, speed: t.map { _ in 4.0 }) // 4:10 /km
        let m = StreamChartModel(streams: s, sport: .run, units: .metric)
        XCTAssertEqual(m.primary?.metric, .pace)
        XCTAssertEqual(m.primary?.unit, "/km")
        XCTAssertTrue(m.primary?.points.allSatisfy { $0.y < 0 } ?? false, "faster is higher")
        for tick in m.primary?.yTicks ?? [] { XCTAssertTrue(tick.label.contains(":"), tick.label) }
        XCTAssertEqual(m.readout(at: 60)?.items.first?.value, "4:10")
        XCTAssertEqual(m.primary?.summary, "avg 4:10\u{202F}/km")
    }

    func testStandingStillIsAGapNotASpike() {
        let t = (0..<100).map(Double.init)
        let speed: [Double?] = t.map { $0 >= 40 && $0 < 60 ? 0.1 : 3.0 }
        let m = StreamChartModel(streams: ActivityStreams(t: t, speed: speed), sport: .run, units: .metric)
        XCTAssertEqual(Set(m.primary?.points.map(\.segment) ?? []).count, 2)
    }

    func testPrimaryMetricFallbacks() {
        XCTAssertEqual(StreamChartModel.primaryMetric(sport: .bike, available: [.heartRate, .speed]), .speed)
        XCTAssertEqual(StreamChartModel.primaryMetric(sport: .swim, available: [.heartRate]), .heartRate)
        XCTAssertEqual(StreamChartModel.primaryMetric(sport: .strength, available: [.heartRate]), .heartRate)
        XCTAssertNil(StreamChartModel.primaryMetric(sport: .run, available: []))
    }

    func testRouteIsNormalisedAndAspectCorrect() {
        let t: [Double] = [0, 1, 2]
        let r = RouteShape.make(t: t, lat: [0.0, 0.0, 0.0], lng: [0.0, 0.01, 0.02])
        // lat 0 and lng 0 together is treated as "no fix"
        XCTAssertEqual(r?.points.count, 2)
        let r2 = RouteShape.make(t: t, lat: [41.0, 41.0, 41.01], lng: [2.0, 2.01, 2.01])!
        for p in r2.points { XCTAssertTrue((0...1).contains(p.x) && (0...1).contains(p.y)) }
        XCTAssertEqual(r2.start?.y ?? 0, r2.points[1].y, accuracy: 1e-9)
        XCTAssertLessThan(r2.end!.y, r2.start!.y, "north is up")
        XCTAssertNil(RouteShape.make(t: t, lat: [41, 41, 41], lng: [2, 2, 2]), "a single spot has no shape")
        XCTAssertEqual(r2.point(atTime: 2.2), r2.end)
    }

    func testFixtureStreams() throws {
        let s = try Fixtures.decode(ActivityStreams.self, "activity_streams")
        let m = StreamChartModel(streams: s, sport: .bike, units: .metric)
        XCTAssertFalse(m.isEmpty)
        XCTAssertEqual(m.primary?.metric, .power)
        XCTAssertNotNil(m.readout(at: 1000))
    }
}
