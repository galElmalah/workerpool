import XCTest
@testable import CadenceKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class APIClientTests: XCTestCase {
    func testSendsHeadersAndDecodes() async throws {
        let t = MockTransport([try .fixture("snapshot")])
        let (client, _) = makeClient(t)
        let s = try await client.snapshot()
        XCTAssertEqual(s.week.days.count, 7)
        let r = try XCTUnwrap(t.lastRequest)
        XCTAssertEqual(r.url?.absoluteString, "https://cadence.example.com/api/mobile/snapshot")
        XCTAssertEqual(r.httpMethod, "GET")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer cad_test")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertEqual(r.value(forHTTPHeaderField: "X-Cadence-Client"), "ios/1.2.3")
        XCTAssertNil(r.value(forHTTPHeaderField: "Content-Type"))
    }

    func testConnectStoresCredentialsWithoutPriorToken() async throws {
        let body = #"{"token":"cad_abc","device":{"id":"dev_1","name":"Phone","platform":"ios","createdAt":"2026-11-21T10:00:00.000Z","lastUsedAt":null}}"#
        let t = MockTransport([.json(201, body)])
        let (client, store) = makeClient(t, token: nil)
        let device = try await client.connect(passphrase: "secret", deviceName: "Phone")
        XCTAssertEqual(device.id, "dev_1")
        XCTAssertEqual(store.load()?.token, "cad_abc")
        XCTAssertEqual(store.load()?.serverURL.absoluteString, "https://cadence.example.com")
        let r = try XCTUnwrap(t.lastRequest)
        XCTAssertEqual(r.url?.path, "/api/auth/devices")
        XCTAssertEqual(r.httpMethod, "POST")
        XCTAssertNil(r.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(r.jsonBody?["passphrase"] as? String, "secret")
        XCTAssertEqual(r.jsonBody?["platform"] as? String, "ios")
        XCTAssertEqual(r.jsonBody?["name"] as? String, "Phone")
    }

    func testWrongPassphraseIsAServerErrorNotUnauthorized() async throws {
        let t = MockTransport([.json(401, #"{"error":{"code":"invalid_passphrase","message":"Wrong passphrase"}}"#)])
        let (client, _) = makeClient(t, token: nil)
        do {
            try await client.connect(passphrase: "nope", deviceName: "Phone")
            XCTFail("expected an error")
        } catch let e as APIError {
            XCTAssertEqual(e, .server(code: "invalid_passphrase", message: "Wrong passphrase", status: 401))
            XCTAssertEqual(e.message, "Wrong passphrase")
        }
    }

    func testUnauthorizedClearsTokenAndNotifies() async throws {
        let t = MockTransport([try .fixture("error_unauthorized", status: 401)])
        let flag = Flag()
        let (client, store) = makeClient(t, onUnauthorized: { flag.set() })
        do {
            _ = try await client.today()
            XCTFail("expected an error")
        } catch let e as APIError {
            XCTAssertEqual(e, .unauthorized)
        }
        XCTAssertNil(store.load())
        XCTAssertTrue(flag.value)
    }

    func testNotConnectedWithoutToken() async throws {
        let t = MockTransport([.json(200, "{}")])
        let (client, _) = makeClient(t, token: nil)
        do {
            _ = try await client.today()
            XCTFail("expected an error")
        } catch let e as APIError {
            XCTAssertEqual(e, .notConnected)
        }
        XCTAssertTrue(t.requests.isEmpty)
    }

    func testThrottledCarriesRetryAfter() async throws {
        let t = MockTransport([.json(429, #"{"error":{"code":"too_many_attempts","message":"Too many attempts. Try again in 30 s."}}"#, headers: ["Retry-After": "30"])])
        let (client, _) = makeClient(t, token: nil)
        do {
            try await client.connect(passphrase: "x", deviceName: "Phone")
            XCTFail("expected an error")
        } catch let e as APIError {
            guard case .throttled(let retry, let code, _) = e else { return XCTFail("got \(e)") }
            XCTAssertEqual(retry, 30)
            XCTAssertEqual(code, "too_many_attempts")
        }
    }

    func testServerErrorsCarryCodeAndMessage() async throws {
        let t = MockTransport([try .fixture("error_not_found", status: 404)])
        let (client, store) = makeClient(t)
        do {
            _ = try await client.workout(id: "wk_missing")
            XCTFail("expected an error")
        } catch let e as APIError {
            XCTAssertEqual(e.code, "not_found")
            if case .server(_, _, let status) = e { XCTAssertEqual(status, 404) } else { XCTFail("got \(e)") }
        }
        XCTAssertNotNil(store.load(), "a 404 must not sign the device out")
    }

    func testNonJSONErrorBodyFallsBack() async throws {
        let t = MockTransport([MockTransport.Reply(status: 502, body: Data("<html>Bad gateway</html>".utf8), headers: [:])])
        let (client, _) = makeClient(t)
        do {
            _ = try await client.today()
            XCTFail("expected an error")
        } catch let e as APIError {
            XCTAssertEqual(e.code, "internal")
        }
    }

    func testTransportErrorsAreClassified() async throws {
        let t = MockTransport([.json(200, "{}")])
        t.error = URLError(.notConnectedToInternet)
        let (client, _) = makeClient(t)
        do {
            _ = try await client.today()
            XCTFail("expected an error")
        } catch let e as APIError {
            XCTAssertTrue(e.isOffline)
        }
    }

    func testDecodingErrorNamesThePath() async throws {
        let t = MockTransport([.json(200, #"{"configured":true}"#)])
        let (client, _) = makeClient(t)
        do {
            _ = try await client.authStatus()
            XCTFail("expected an error")
        } catch let e as APIError {
            guard case .decoding(let detail) = e else { return XCTFail("got \(e)") }
            XCTAssertTrue(detail.contains("authenticated"), detail)
        }
    }

    func testNoContentAndSignOut() async throws {
        let t = MockTransport([.noContent])
        let (client, store) = makeClient(t)
        await client.signOut()
        XCTAssertNil(store.load())
        XCTAssertEqual(t.lastRequest?.httpMethod, "DELETE")
        XCTAssertEqual(t.lastRequest?.url?.path, "/api/auth/devices/current")
    }

    func testSignOutClearsEvenWhenOffline() async throws {
        let t = MockTransport([.noContent])
        t.error = URLError(.timedOut)
        let (client, store) = makeClient(t)
        await client.signOut()
        XCTAssertNil(store.load())
    }

    func testQueryEncoding() throws {
        let (client, _) = makeClient(MockTransport([]))
        let r = client.makeRequest(Endpoints.search("ride + run"), token: nil)
        XCTAssertEqual(r.url?.absoluteString, "https://cadence.example.com/api/search?q=ride%20%2B%20run")
        let cal = client.makeRequest(Endpoints.calendar(from: "2026-11-16", to: "2026-11-22"), token: nil)
        XCTAssertEqual(cal.url?.query, "from=2026-11-16&to=2026-11-22")
        let acts = client.makeRequest(Endpoints.activities(ActivityQuery(sport: .run, limit: 20)), token: nil)
        XCTAssertEqual(acts.url?.query, "sport=run&limit=20")
        let streams = client.makeRequest(Endpoints.streams(activityId: "act_1"), token: nil)
        XCTAssertEqual(streams.url?.absoluteString, "https://cadence.example.com/api/activities/act_1/streams?maxPoints=1200")
    }

    func testWritesBuildTheRightRequests() throws {
        let (client, _) = makeClient(MockTransport([]))
        var patch = WorkoutPatch()
        patch.date = "2026-11-25"
        patch.preNote = .null
        let p = client.makeRequest(Endpoints.patchWorkout(id: "wk_1", patch, scope: .following), token: "t")
        XCTAssertEqual(p.httpMethod, "PATCH")
        XCTAssertEqual(p.url?.absoluteString, "https://cadence.example.com/api/workouts/wk_1?scope=following")
        XCTAssertEqual(String(decoding: p.httpBody ?? Data(), as: UTF8.self), #"{"date":"2026-11-25","preNote":null}"#)

        let a = client.makeRequest(Endpoints.patchActivity(id: "act_1", ActivityPatch(rpe: .value(6), feel: .null)), token: "t")
        XCTAssertEqual(String(decoding: a.httpBody ?? Data(), as: UTF8.self), #"{"feel":null,"rpe":6}"#)

        let skip = client.makeRequest(Endpoints.skipWorkout(id: "wk_1", reason: .travel), token: "t")
        XCTAssertEqual(skip.url?.path, "/api/workouts/wk_1/skip")
        XCTAssertEqual(skip.jsonBody?["reason"] as? String, "travel")

        let quick = client.makeRequest(Endpoints.quickAdd(date: "2026-11-25", text: "run 45m easy"), token: "t")
        XCTAssertEqual(String(decoding: quick.httpBody ?? Data(), as: UTF8.self), #"{"date":"2026-11-25","text":"run 45m easy"}"#)

        let checkIn = client.makeRequest(Endpoints.checkIn(date: "2026-11-21", WellnessCheckIn(feel: .value(4), soreness: .value(2))), token: "t")
        XCTAssertEqual(checkIn.httpMethod, "PUT")
        XCTAssertEqual(checkIn.url?.path, "/api/wellness/2026-11-21")

        let push = client.makeRequest(Endpoints.pushWorkout(id: "wk_1"), token: "t")
        XCTAssertEqual(push.httpMethod, "POST")
        XCTAssertNil(push.httpBody)
    }

    func testStructureEncodesLikeTheServer() throws {
        let structure = WorkoutStructure(steps: [
            .step(id: "s1", role: .warmup, measure: .time(600), target: Target(type: .powerPct, low: 55, high: 65)),
            .repeatBlock(id: "r1", count: 4, steps: [
                .step(id: "s2", role: .active, measure: .time(480), target: Target(type: .powerPct, low: 95, high: 100)),
                .step(id: "s3", role: .recovery, measure: .time(240)),
            ]),
        ])
        let json = String(decoding: JSONCoding.encode(structure), as: UTF8.self)
        XCTAssertTrue(json.contains(#""kind":"repeat""#))
        XCTAssertTrue(json.contains(#""measure":{"sec":600,"type":"time"}"#), json)
        XCTAssertFalse(json.contains("null"))
        XCTAssertEqual(try JSONDecoder().decode(WorkoutStructure.self, from: Data(json.utf8)), structure)
    }

    func testResponseCacheServesLastGet() async throws {
        let dir = tempDirectory()
        let cache = ResponseCache(directory: dir)
        let t = MockTransport([try .fixture("today")])
        let (client, _) = makeClient(t, cache: cache)
        XCTAssertNil(client.cached(Endpoints.today()))
        let live = try await client.today()
        let cached = try XCTUnwrap(client.cached(Endpoints.today()))
        XCTAssertEqual(cached.value, live)
        // a 401 wipes the cache together with the token
        let t2 = MockTransport([.json(401, #"{"error":{"code":"unauthorized","message":"x"}}"#)])
        let (client2, _) = makeClient(t2, cache: cache)
        _ = try? await client2.today()
        XCTAssertNil(client2.cached(Endpoints.today()))
    }

    func testServerAddressRules() throws {
        XCTAssertEqual(try ServerAddress.normalize("cadence.example.com").absoluteString, "https://cadence.example.com")
        XCTAssertEqual(try ServerAddress.normalize(" https://Cadence.Example.com/today?x=1 ").absoluteString, "https://cadence.example.com")
        XCTAssertEqual(try ServerAddress.normalize("localhost:5240").absoluteString, "http://localhost:5240")
        XCTAssertEqual(try ServerAddress.normalize("http://192.168.1.20:5240/").absoluteString, "http://192.168.1.20:5240")
        XCTAssertEqual(try ServerAddress.normalize("http://mac-mini.local:5240").absoluteString, "http://mac-mini.local:5240")
        XCTAssertThrowsError(try ServerAddress.normalize("http://cadence.example.com"))
        XCTAssertThrowsError(try ServerAddress.normalize("ftp://cadence.example.com"))
        XCTAssertThrowsError(try ServerAddress.normalize(""))
        XCTAssertTrue(ServerAddress.isDevelopmentHost("10.0.0.2"))
        XCTAssertTrue(ServerAddress.isDevelopmentHost("172.20.1.1"))
        XCTAssertFalse(ServerAddress.isDevelopmentHost("172.40.1.1"))
        XCTAssertFalse(ServerAddress.isDevelopmentHost("8.8.8.8"))
        XCTAssertFalse(ServerAddress.isDevelopmentHost("fcbarcelona.com"))
    }

    func testDeepLinks() {
        let links: [DeepLink] = [.today, .workout(id: "wk_1"), .activity(id: "act_1"), .week("2026-W47"),
                                 .calendar(date: "2026-11-21"), .calendar(date: nil), .checkIn(date: nil), .event(id: "evt_1")]
        for l in links { XCTAssertEqual(DeepLink(url: l.url), l, l.url.absoluteString) }
        XCTAssertEqual(DeepLink.workout(id: "wk_1").url.absoluteString, "cadence://workout/wk_1")
        XCTAssertEqual(DeepLink(webPath: "/workouts/wk_9"), .workout(id: "wk_9"))
        XCTAssertEqual(DeepLink(webPath: "/calendar/day/2026-11-22"), .calendar(date: "2026-11-22"))
        XCTAssertEqual(DeepLink(webPath: "/calendar/week/2026-W48"), .week("2026-W48"))
        XCTAssertNil(DeepLink(url: URL(string: "https://example.com/workout/1")!))
    }
}

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var _value = false
    var value: Bool { lock.lock(); defer { lock.unlock() }; return _value }
    func set() { lock.lock(); _value = true; lock.unlock() }
}
