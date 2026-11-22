import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HTTPMethod: String, Sendable {
    case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE"
}

/// A typed request description. Built by `Endpoints`, sent by `APIClient.send(_:)`. Pure value:
/// tests assert method/path/query/body without any network.
public struct Endpoint<Response: Decodable> {
    public var method: HTTPMethod
    /// Percent-encoded path starting with "/api/".
    public var path: String
    public var query: [URLQueryItem]
    /// JSON body (already encoded).
    public var body: Data?
    /// false only for the open auth routes (connect, status).
    public var requiresAuth: Bool
    /// Successful responses are written to `ResponseCache` under this key (offline launch).
    public var cacheKey: String?

    public init(_ method: HTTPMethod, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
                requiresAuth: Bool = true, cacheKey: String? = nil) {
        self.method = method; self.path = path; self.query = query; self.body = body
        self.requiresAuth = requiresAuth; self.cacheKey = cacheKey
    }

    /// GET endpoints cache under "<path>?<query>" by default.
    public static func get(_ path: String, query: [URLQueryItem] = [], cache: Bool = true) -> Endpoint {
        var ep = Endpoint(.get, path, query: query.filter { $0.value != nil })
        if cache { ep.cacheKey = ep.defaultCacheKey }
        return ep
    }

    public static func send<Body: Encodable>(_ method: HTTPMethod, _ path: String, json body: Body, query: [URLQueryItem] = []) -> Endpoint {
        Endpoint(method, path, query: query, body: JSONCoding.encode(body))
    }

    var defaultCacheKey: String {
        let q = query.compactMap { item in item.value.map { "\(item.name)=\($0)" } }.joined(separator: "&")
        return q.isEmpty ? path : path + "?" + q
    }
}

/// Shared JSON configuration: camelCase keys as-is, dates as strings (models never use `Date`),
/// sorted keys so request bodies are deterministic in tests.
public enum JSONCoding {
    public static func makeDecoder() -> JSONDecoder { JSONDecoder() }

    public static func makeEncoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return e
    }

    /// Encodes request bodies. Our request types contain only strings, numbers, bools and arrays,
    /// so encoding cannot fail except for non-finite numbers; those fall back to `{}`.
    public static func encode<T: Encodable>(_ value: T) -> Data {
        (try? makeEncoder().encode(value)) ?? Data("{}".utf8)
    }
}

/// Path helpers.
enum Path {
    private static let segmentAllowed: CharacterSet = {
        var s = CharacterSet.urlPathAllowed
        s.remove(charactersIn: "/?#%;")
        return s
    }()

    /// Percent-encodes one path segment (ids, dates, ISO weeks are already safe; this is defensive).
    static func segment(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: segmentAllowed) ?? s
    }
}

extension URLQueryItem {
    static func item(_ name: String, _ value: String?) -> URLQueryItem { URLQueryItem(name: name, value: value) }
    static func item(_ name: String, _ value: Int?) -> URLQueryItem { URLQueryItem(name: name, value: value.map(String.init)) }
}
