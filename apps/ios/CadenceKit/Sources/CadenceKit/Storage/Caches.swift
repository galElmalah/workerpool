import Foundation

/// The last `MobileSnapshot`, as a JSON file in the App Group container, so widgets render
/// instantly (and offline) and the app has a first paint before the network answers.
/// Pass the App Group container URL (`FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)`,
/// see `AppGroupConfig.containerURL`). Writes are atomic; a corrupt file reads as nil.
public final class SnapshotCache: @unchecked Sendable {
    public struct Entry: Codable, Hashable, Sendable {
        public var snapshot: MobileSnapshot
        /// when this device received it
        public var fetchedAt: Date

        public init(snapshot: MobileSnapshot, fetchedAt: Date) {
            self.snapshot = snapshot
            self.fetchedAt = fetchedAt
        }
    }

    public let fileURL: URL
    private let lock = NSLock()

    public init(directory: URL, fileName: String = "snapshot.json") {
        self.fileURL = directory.appendingPathComponent(fileName)
    }

    public func load() -> Entry? {
        lock.lock(); defer { lock.unlock() }
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return try? d.decode(Entry.self, from: data)
    }

    public func save(_ snapshot: MobileSnapshot, fetchedAt: Date = Date()) throws {
        lock.lock(); defer { lock.unlock() }
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970
        let data = try e.encode(Entry(snapshot: snapshot, fetchedAt: fetchedAt))
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: fileURL, options: .atomic)
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: fileURL)
    }
}

/// Tiny on-disk cache of raw GET responses (keyed by path + query) for offline app launch: the app
/// shows `client.cached(endpoint)` immediately, then refreshes. Bounded by entry count; oldest
/// files are evicted first. Not shared with widgets (they use `SnapshotCache`).
public final class ResponseCache: @unchecked Sendable {
    public let directory: URL
    public let maxEntries: Int
    private let lock = NSLock()

    /// `directory`: e.g. Caches/CadenceResponses in the app sandbox.
    public init(directory: URL, maxEntries: Int = 200) {
        self.directory = directory
        self.maxEntries = maxEntries
    }

    public func data(for key: String) -> (data: Data, storedAt: Date)? {
        lock.lock(); defer { lock.unlock() }
        let url = fileURL(for: key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let date = (attrs?[.modificationDate] as? Date) ?? Date(timeIntervalSince1970: 0)
        return (data, date)
    }

    public func store(_ data: Data, for key: String) {
        lock.lock(); defer { lock.unlock() }
        let fm = FileManager.default
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: fileURL(for: key), options: .atomic)
        evictIfNeeded()
    }

    public func removeAll() {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: directory)
    }

    private func evictIfNeeded() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]),
              files.count > maxEntries else { return }
        let dated = files.map { url -> (URL, Date) in
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
            return (url, values?.contentModificationDate ?? Date(timeIntervalSince1970: 0))
        }
        for (url, _) in dated.sorted(by: { $0.1 < $1.1 }).prefix(files.count - maxEntries) {
            try? fm.removeItem(at: url)
        }
    }

    func fileURL(for key: String) -> URL {
        directory.appendingPathComponent(ResponseCache.fileName(for: key))
    }

    /// FNV-1a 64-bit of the key, hex — stable across launches and platforms (no CryptoKit needed).
    static func fileName(for key: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in key.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        let hex = String(hash, radix: 16)
        return String(repeating: "0", count: 16 - hex.count) + hex + ".json"
    }
}

/// A decoded cached response with its age.
public struct Cached<Value> {
    public var value: Value
    public var storedAt: Date

    public init(value: Value, storedAt: Date) {
        self.value = value
        self.storedAt = storedAt
    }
}

extension Cached: Sendable where Value: Sendable {}
