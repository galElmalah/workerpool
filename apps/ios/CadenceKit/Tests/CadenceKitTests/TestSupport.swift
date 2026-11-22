import Foundation
import XCTest
@testable import CadenceKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum Fixtures {
    static func url(_ name: String) -> URL? {
        let base = name.hasSuffix(".json") ? String(name.dropLast(5)) : name
        return Bundle.module.url(forResource: base, withExtension: "json", subdirectory: "Fixtures")
    }

    static func data(_ name: String) throws -> Data {
        guard let url = url(name) else { throw XCTSkip("fixture \(name) not captured yet") }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try APIClient.decode(T.self, from: data(name))
    }

    /// "file.json" → "SwiftType" from Fixtures/index.json
    static func index() throws -> [String: String] {
        var map = try JSONDecoder().decode([String: String].self, from: data("index"))
        map.removeValue(forKey: "_comment")
        return map
    }
}

/// Records requests and replies with canned responses, in order (the last one repeats).
final class MockTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: Data
        var headers: [String: String]

        static func json(_ status: Int = 200, _ text: String, headers: [String: String] = [:]) -> Reply {
            Reply(status: status, body: Data(text.utf8), headers: headers.merging(["Content-Type": "application/json"]) { a, _ in a })
        }

        static func fixture(_ name: String, status: Int = 200) throws -> Reply {
            Reply(status: status, body: try Fixtures.data(name), headers: ["Content-Type": "application/json"])
        }

        static var noContent: Reply { Reply(status: 204, body: Data(), headers: [:]) }
    }

    private let lock = NSLock()
    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []
    var error: Error?

    init(_ replies: [Reply]) { self.replies = replies }

    var lastRequest: URLRequest? {
        lock.lock(); defer { lock.unlock() }
        return requests.last
    }

    /// Synchronous so the lock is never held across an await.
    private func record(_ request: URLRequest) -> (Reply?, Error?) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        let reply = replies.count > 1 ? replies.removeFirst() : replies.first
        return (reply, error)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (reply, error) = record(request)
        if let error { throw error }
        guard let reply else { throw URLError(.badServerResponse) }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        return (reply.body, response)
    }
}

extension URLRequest {
    /// The JSON body as a dictionary (for asserting request payloads).
    var jsonBody: [String: Any]? {
        guard let httpBody else { return nil }
        return (try? JSONSerialization.jsonObject(with: httpBody)) as? [String: Any]
    }
}

let madrid = TimeZone(identifier: "Europe/Madrid")!

/// A Date at local wall-clock time in `tz`.
func localDate(_ day: String, _ hour: Int, _ minute: Int = 0, tz: TimeZone = madrid) -> Date {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = tz
    let d = Day(day)!
    return cal.date(from: DateComponents(year: d.year, month: d.month, day: d.day, hour: hour, minute: minute))!
}

func makeClient(_ transport: MockTransport, token: String? = "cad_test",
                cache: ResponseCache? = nil, onUnauthorized: (@Sendable () -> Void)? = nil) -> (APIClient, InMemoryTokenStore) {
    let base = URL(string: "https://cadence.example.com")!
    let store = InMemoryTokenStore(token.map { DeviceCredentials(serverURL: base, token: $0, deviceId: "dev_1") })
    let client = APIClient(baseURL: base, tokenStore: store, transport: transport, responseCache: cache,
                           appVersion: "1.2.3", onUnauthorized: onUnauthorized)
    return (client, store)
}

func tempDirectory() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("cadencekit-tests-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}
