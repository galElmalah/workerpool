import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The one seam between `APIClient` and the network. Tests inject a fake; the app uses
/// `URLSessionTransport`. Implementations return the raw body and the HTTP response for any status
/// (non-2xx is not an error at this level) and throw only for transport failures.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    public let session: URLSession

    public init(session: URLSession = URLSessionTransport.defaultSession()) {
        self.session = session
    }

    /// 20 s request timeout, no cookies (bearer auth only), no URL cache (CadenceKit caches itself).
    public static func defaultSession(timeout: TimeInterval = 20) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout * 3
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        // Completion-handler API wrapped in a continuation: works on every Apple OS version and on
        // swift-corelibs-foundation (Linux), unlike `data(for:)`.
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(Data, HTTPURLResponse), Error>) in
            let task = session.dataTask(with: request) { data, response, error in
                if let error {
                    cont.resume(throwing: error)
                } else if let http = response as? HTTPURLResponse {
                    cont.resume(returning: (data ?? Data(), http))
                } else {
                    cont.resume(throwing: URLError(.badServerResponse))
                }
            }
            task.resume()
        }
    }
}
