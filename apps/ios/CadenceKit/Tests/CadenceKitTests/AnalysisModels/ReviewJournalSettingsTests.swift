import XCTest
@testable import CadenceKit

final class WeekReviewModelTests: XCTestCase {
    func testFixturePastWeek() throws {
        let r = try Fixtures.decode(WeekReview.self, "week_review")
        let m = WeekReviewModel(review: r, today: "2026-11-21", units: .metric)
        XCTAssertEqual(m.mode, .past)
        XCTAssertEqual(m.title, "Week 46")
        XCTAssertEqual(m.rangeText, "9\u{2013}15 Nov 2026")
        XCTAssertEqual(m.previousWeek, "2026-W45")
        XCTAssertEqual(m.nextWeek, "2026-W47")
        XCTAssertEqual(m.days.count, 7)
        XCTAssertEqual(m.days.first?.weekday, "Mon")
        // every workout and activity appears once (paired ones as one line)
        for (row, day) in zip(m.days, r.days) {
            let paired = day.workouts.compactMap(\.pairedActivityId).filter { id in day.activities.contains { $0.id == id } }.count
            XCTAssertEqual(row.lines.count, day.workouts.count + day.activities.count - paired, row.date)
        }
        XCTAssertTrue(m.headline.hasPrefix("You completed "), m.headline)
        XCTAssertTrue(m.headline.contains("all 4 key sessions"), m.headline)
        XCTAssertEqual(m.figures.map(\.label), ["Hours", "Load", "Fitness at week end", "Form at week end"])
        XCTAssertEqual(m.keySessions.count, r.keySessions.count)
        XCTAssertEqual(m.nextText, "Next week: 9:45 h planned, 3 key sessions.")
        XCTAssertEqual(m.statusText, r.note?.body.isEmpty == false ? "Reviewed" : "Done")
    }

    func testHeadlineModes() {
        let w = makeWeek("2026-11-16", doneSec: 28_080, plannedSec: 35_100, doneLoad: 464, plannedLoad: 539, keyPlanned: 3, keyDone: 3, compliancePct: 84.3)
        XCTAssertEqual(WeekReviewModel.headline(w, mode: .current), "7:48 of 9:45 h done so far, all 3 key sessions done.")
        XCTAssertEqual(WeekReviewModel.headline(w, mode: .future), "9:45 h and 539 Load planned, with 3 key sessions.")
        XCTAssertEqual(WeekReviewModel.headline(w, mode: .past), "You completed 80% of the planned time and all 3 key sessions; compliance 84%.")
        let off = makeWeek("2026-11-16")
        XCTAssertEqual(WeekReviewModel.headline(off, mode: .past), "A week off: nothing planned, nothing done.")
    }

    func testWowLineAndCaution() {
        let p = makeWeek("2026-11-09", doneSec: 36_000, doneLoad: 400, doneDistanceM: 100_000)
        let s = makeWeek("2026-11-16", doneSec: 39_600, doneLoad: 480, doneDistanceM: 90_000)
        let (line, caution) = WeekReviewModel.wow(s, previous: p, mode: .past, units: .metric)
        XCTAssertEqual(line, "Against last week: hours +10% (10:00), load +20% (400), distance \u{2212}10% (100\u{202F}km).")
        XCTAssertEqual(caution, "Load rose more than 15%.")
        XCTAssertNil(WeekReviewModel.wow(s, previous: p, mode: .future, units: .metric).0)
    }

    func testYearBoundary() {
        XCTAssertEqual(Day.isoWeekStart("2026-W01")!.adding(days: -7).isoWeek, "2025-W52")
        XCTAssertEqual(Day.isoWeekStart("2026-W53")!.adding(days: 7).isoWeek, "2027-W01")
    }
}

final class JournalModelTests: XCTestCase {
    private func item(_ type: JournalType, _ date: String, ref: String, title: String = "T", body: String = "Body", rpe: Int? = nil) -> JournalItem {
        JournalItem(type: type, date: date, title: title, body: body, ref: ref, sport: type == .activityPost ? .run : nil, rpe: rpe, feel: nil)
    }

    func testEntries() {
        let e = JournalEntryModel(item: item(.activityPost, "2026-11-21", ref: "act_1", title: "Long ride", body: "  Solid. \n", rpe: 4))
        XCTAssertEqual(e.dayText, "Sat 21")
        XCTAssertEqual(e.metaText, "Reflection · Long ride · RPE 4")
        XCTAssertEqual(e.body, "Solid.")
        XCTAssertEqual(e.target, .activity(id: "act_1"))
        XCTAssertEqual(e.symbol, Sport.run.symbolName)
        XCTAssertEqual(JournalEntryModel(item: item(.week, "2026-11-22", ref: "2026-W47")).target, .week("2026-W47"))
        XCTAssertEqual(JournalEntryModel(item: item(.day, "2026-11-05", ref: "2026-11-05", title: "Day note")).metaText, "Day note")
    }

    func testSectionsAndFilters() throws {
        let items = [item(.day, "2026-12-01", ref: "a"), item(.day, "2026-11-30", ref: "b"), item(.day, "2026-11-30", ref: "b")]
        let s = JournalModel.sections(items)
        XCTAssertEqual(s.map(\.title), ["December 2026", "November 2026"])
        XCTAssertEqual(s[1].entries.count, 1, "duplicates across pages are dropped")
        XCTAssertEqual(JournalFilter.workouts.types, [.workoutPre, .activityPost])
        XCTAssertEqual(JournalFilter.everything.types, [])
        XCTAssertEqual(JournalModel.composeTitle(today: "2026-11-21"), "Today · Saturday 21 November")
        let page = try Fixtures.decode(JournalPage.self, "journal")
        XCTAssertEqual(JournalModel.sections(page.items).flatMap(\.entries).count, page.items.count)
        XCTAssertEqual(NoteSaveState.failed("You're offline.").text, "Not saved: You're offline.")
    }
}

final class SettingsModelTests: XCTestCase {
    let now = Instant.parse("2026-11-22T06:02:06.824Z")!

    func testGarminStatus() throws {
        let s = try Fixtures.decode(GarminStatus.self, "garmin_status")
        let m = GarminStatusModel(status: s, now: now)
        XCTAssertEqual(m.stateText, "Connected")
        XCTAssertEqual(m.accountText, "as jonas.tri")
        XCTAssertEqual(m.lastSyncText, "Last sync 12 h ago")
        XCTAssertEqual(m.countsText, "443 activities")
        XCTAssertNil(m.backfillText)
        XCTAssertTrue(m.canSync)
        XCTAssertTrue(m.isDemo)
    }

    func testSyncLogAndDevices() throws {
        let log = try Fixtures.decode(SyncLogPage.self, "sync_log")
        let row = SyncLogRowModel(entry: log.entries[0], now: now)
        XCTAssertEqual(row.kindText, "History import")
        XCTAssertEqual(row.whenText, "11 h ago · 106.0\u{202F}s")
        XCTAssertFalse(row.isError)
        let devices = try Fixtures.decode(DeviceList.self, "devices_list").devices
        let other = Device(id: "dev_web", name: "Laptop", platform: .other, createdAt: "2026-01-02T10:00:00.000Z", lastUsedAt: nil)
        let rows = DeviceRowModel.rows([other] + devices, currentDeviceId: devices[0].id, now: now, timeZone: TimeZone(identifier: "UTC")!)
        XCTAssertEqual(rows.first?.isCurrent, true)
        XCTAssertEqual(rows.first?.detail, "This iPhone · added Sun 22 Nov 2026")
        XCTAssertEqual(rows.last?.detail, "added Fri 2 Jan 2026 · never used")
        XCTAssertEqual(rows.last?.symbol, "laptopcomputer")
    }

    func testLabels() {
        XCTAssertEqual(ThemePreference.pickerCases.map(\.settingsLabel), ["System", "Light", "Dark"])
        XCTAssertEqual(Accent.rose.settingsLabel, "Rose")
        XCTAssertEqual(SettingsText.serverHost(URL(string: "http://localhost:5240")!), "localhost:5240")
        XCTAssertEqual(SettingsText.autoPush(0), "Off")
        XCTAssertEqual(SyncResultText.error(.server(code: "sync_in_progress", message: "x", status: 409)), "A sync is already running.")
    }
}

final class ActivityMetricsTests: XCTestCase {
    func testBikeGroups() throws {
        let d = try Fixtures.decode(ActivityDetail.self, "activity_bike")
        let s = try Fixtures.decode(ActivityStreams.self, "activity_streams")
        let groups = ActivityMetrics.groups(d, units: .metric, streams: s)
        let kinds = groups.map(\.kind)
        XCTAssertEqual(kinds.first, .timeDistance)
        XCTAssertTrue(kinds.contains(.power))
        XCTAssertTrue(kinds.contains(.heartRate))
        XCTAssertFalse(kinds.contains(.swim))
        XCTAssertFalse(kinds.contains(.strength))
        XCTAssertTrue(groups.allSatisfy { !$0.items.isEmpty })
        let power = groups.first { $0.kind == .power }!
        XCTAssertEqual(power.items.first { $0.label == "Weighted" }?.unit, "W")
        XCTAssertEqual(power.items.first { $0.label == "Intensity" }?.value, "0.70")
        let elevation = groups.first { $0.kind == .elevation }!
        XCTAssertEqual(elevation.items.map(\.label), ["Gain", "Loss", "Highest", "Lowest"])
        XCTAssertEqual(groups.first { $0.kind == .timeDistance }?.items.first { $0.label == "Start" }?.value, "09:26")
        XCTAssertTrue(groups.first { $0.kind == .conditions }?.items.contains { $0.label == "Temperature" } ?? false)
    }

    func testExtrasDecodeTolerantlyAndFeedGroups() throws {
        let json = """
        {"id":"x","locationName":"Girona","facts":{"maxSpeedMps":15.2,"elevationLossM":700,"maxAltitudeM":410,"minAltitudeM":20,
         "avgTempC":18.4,"minTempC":12,"maxTempC":24,"deviceName":"Edge 840","deviceSoftware":"21.19","trainingEffectLabel":"VO2MAX",
         "sensors":[{"kind":"power meter","name":"Assioma"},{"kind":"heart rate"}],"powerBalanceLeftPct":49.6,"pausedSec":300,"pauseCount":2}}
        """
        let extras = try JSONDecoder().decode(ActivityExtras.self, from: Data(json.utf8))
        XCTAssertEqual(extras.locationName, "Girona")
        XCTAssertEqual(extras.facts?.deviceName, "Edge 840")
        let broken = try JSONDecoder().decode(ActivityExtras.self, from: Data(#"{"locationName":"A","facts":{"maxSpeedMps":"fast"}}"#.utf8))
        XCTAssertEqual(broken.locationName, "A")
        XCTAssertNil(broken.facts, "a malformed facts object is dropped, not fatal")

        let d = try Fixtures.decode(ActivityDetail.self, "activity_bike")
        let groups = ActivityMetrics.groups(d, units: .metric, extras: extras)
        func item(_ k: MetricGroupKind, _ label: String) -> MetricItem? { groups.first { $0.kind == k }?.items.first { $0.label == label } }
        XCTAssertEqual(item(.conditions, "Location")?.value, "Girona")
        XCTAssertEqual(item(.conditions, "Device")?.value, "Edge 840 (21.19)")
        XCTAssertEqual(item(.conditions, "Sensors")?.value, "Assioma (power meter), heart rate")
        XCTAssertEqual(item(.conditions, "Temperature")?.value, "18")
        XCTAssertEqual(item(.paceSpeed, "Top speed")?.value, "54.7")
        XCTAssertEqual(item(.elevation, "Loss")?.value, "700")
        XCTAssertEqual(item(.energy, "Training effect")?.value, "VO2 max")
        XCTAssertEqual(item(.power, "Balance left / right")?.value, "50 / 50")
        XCTAssertEqual(item(.timeDistance, "Paused")?.unit, "2 stops")
        XCTAssertEqual(ActivityDetailModel(detail: d, units: .metric, extras: extras).locationText, "Girona")
        XCTAssertEqual(ActivityExtras.trainingEffectText("ANAEROBIC_CAPACITY"), "Anaerobic capacity")
        XCTAssertEqual(ActivityExtras.endpoint(id: "act_1").cacheKey, Endpoints.activity(id: "act_1").cacheKey)
    }

    func testLapTableColumns() {
        let laps = [
            Lap(index: 0, startSec: 0, durationSec: 600, distanceM: 5000, avgHr: 130, avgPower: 200, avgSpeedMps: 8.3, avgCadence: 88, elevationGainM: 20),
            Lap(index: 1, startSec: 600, durationSec: 300, distanceM: 2000, avgHr: 120, avgPower: 120, avgSpeedMps: 6.6, avgCadence: 80, isRest: true),
        ]
        let t = ActivityDetailModel.lapTable(laps, sport: .bike, units: .metric)!
        XCTAssertEqual(t.columns, ["Lap", "Time", "Distance", "Power", "HR", "Speed", "Cadence", "Elev"])
        XCTAssertEqual(t.rows[0].cells, ["1", "10:00", "5\u{202F}km", "200\u{202F}W", "130", "29.9", "88", "20"])
        XCTAssertTrue(t.rows[1].isRest)
        XCTAssertTrue(t.rows.allSatisfy { $0.cells.count == t.columns.count })
        XCTAssertNil(ActivityDetailModel.lapTable([laps[0]], sport: .bike, units: .metric), "one lap is not a table")
    }

    func testBuilderSkipsMissing() {
        var b = ActivityMetrics.Builder()
        b.add(.power, "Average", nil, "W")
        b.add(.power, "Max", Format.placeholder, "W")
        b.add(.heartRate, "Average", "140", "bpm")
        XCTAssertEqual(b.groups().map(\.kind), [.heartRate])
        XCTAssertEqual(AnalysisTone.of(.missed), .critical)
        XCTAssertEqual(AnalysisTone.of(.onTarget).symbol, "checkmark.circle.fill")
    }

    func testRouteCoordinatesAndRegion() {
        let r = RouteShape.make(t: [0, 1, 2], lat: [41.0, 41.01, 41.02], lng: [2.0, 2.0, 2.01])!
        XCTAssertEqual(r.coordinates.count, r.points.count)
        XCTAssertEqual(r.coordinate(atTime: 2)?.latitude, 41.02)
        XCTAssertEqual(r.region?.center.latitude ?? 0, 41.01, accuracy: 1e-9)
        XCTAssertGreaterThan(r.region?.latitudeDelta ?? 0, 0.02)
    }

    func testVolumeStacksBySport() {
        let bike = SportTotals(sport: .bike, plannedSec: 0, doneSec: 7200, plannedLoad: 0, doneLoad: 0, plannedDistanceM: 0, doneDistanceM: 0,
                               plannedCount: 0, doneCount: 1, elevationGainM: 0)
        let run = SportTotals(sport: .run, plannedSec: 0, doneSec: 3600, plannedLoad: 0, doneLoad: 0, plannedDistanceM: 0, doneDistanceM: 0,
                              plannedCount: 0, doneCount: 1, elevationGainM: 0)
        let w = makeWeek("2026-11-09", doneSec: 12_600, bySport: [run, bike])
        let v = VolumeChartModel(weeks: [w], range: .sixWeeks, metric: .hours, units: .metric, today: "2026-11-21")
        XCTAssertEqual(v.segments.map(\.sport), [.bike, .run, .other], "stack order, remainder as other")
        XCTAssertEqual(v.segments.map(\.value), [2, 1, 0.5])
        XCTAssertEqual(v.sports, [.bike, .run, .other])
    }
}
