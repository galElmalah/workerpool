import Foundation

/// Normalises and validates the server URL the user types on the connect screen.
/// Rules (docs/MOBILE_API.md, client rules): HTTPS, except plain HTTP for `localhost`, loopback and
/// private-network hosts during development. Path, query and fragment are dropped (the API lives at
/// `<origin>/api`).
public enum ServerAddress {
    /// "cadence.example.com" → https://cadence.example.com · "http://192.168.1.20:5240/" → http://192.168.1.20:5240
    public static func normalize(_ input: String) throws -> URL {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw APIError.invalidBaseURL(reason: "Enter your Cadence server address.") }
        if !text.contains("://") {
            let hostGuess = text.split(separator: "/").first.map(String.init) ?? text
            text = (isDevelopmentHost(hostOnly(hostGuess)) ? "http://" : "https://") + text
        }
        guard var comps = URLComponents(string: text), let scheme = comps.scheme?.lowercased(),
              let host = comps.host, !host.isEmpty else {
            throw APIError.invalidBaseURL(reason: "That does not look like a web address.")
        }
        guard scheme == "https" || scheme == "http" else {
            throw APIError.invalidBaseURL(reason: "Use an https:// address.")
        }
        if scheme == "http" && !isDevelopmentHost(host) {
            throw APIError.invalidBaseURL(reason: "Use https:// — plain http is only allowed for local development servers.")
        }
        comps.scheme = scheme
        if !host.contains(":") { comps.host = host.lowercased() } // leave IPv6 literals untouched
        comps.path = ""
        comps.query = nil
        comps.fragment = nil
        comps.user = nil
        comps.password = nil
        guard let url = comps.url else { throw APIError.invalidBaseURL(reason: "That does not look like a web address.") }
        return url
    }

    /// localhost, *.local, loopback, RFC 1918 private ranges, link-local, unique-local IPv6.
    public static func isDevelopmentHost(_ rawHost: String) -> Bool {
        let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") { return true }
        if host == "::1" || host.hasPrefix("fe80:") { return true }
        if (host.hasPrefix("fc") || host.hasPrefix("fd")) && host.contains(":") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, host.split(separator: ".").count == 4, parts.allSatisfy({ (0...255).contains($0) }) else { return false }
        switch (parts[0], parts[1]) {
        case (127, _), (10, _), (192, 168), (169, 254): return true
        case (172, let b) where (16...31).contains(b): return true
        default: return false
        }
    }

    private static func hostOnly(_ hostPort: String) -> String {
        if hostPort.hasPrefix("[") { return String(hostPort.prefix(while: { $0 != "]" }).dropFirst()) }
        return String(hostPort.split(separator: ":").first ?? Substring(hostPort))
    }
}
