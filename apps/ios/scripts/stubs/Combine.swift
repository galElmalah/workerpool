// Type-checking stub of the parts of Combine the Cadence app touches (ObservableObject, @Published,
// a Publisher with compactMap). Signatures follow the iOS 17 SDK; bodies are never run.
@_exported import Foundation

public protocol Publisher<Output, Failure> {
    associatedtype Output
    associatedtype Failure: Error
}

public final class ObservableObjectPublisher: Publisher {
    public typealias Output = Void
    public typealias Failure = Never
    public init() {}
    public func send() {}
}

public protocol ObservableObject: AnyObject {
    associatedtype ObjectWillChangePublisher: Publisher = ObservableObjectPublisher where ObjectWillChangePublisher.Failure == Never
    var objectWillChange: ObjectWillChangePublisher { get }
}

extension ObservableObject where ObjectWillChangePublisher == ObservableObjectPublisher {
    public var objectWillChange: ObservableObjectPublisher { ObservableObjectPublisher() }
}

@propertyWrapper
public struct Published<Value> {
    public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
    public init(initialValue: Value) { self.wrappedValue = initialValue }
    public var wrappedValue: Value
    public struct Publisher: Combine.Publisher {
        public typealias Output = Value
        public typealias Failure = Never
    }
    public var projectedValue: Publisher {
        get { Publisher() }
        set {}
    }
}

public enum Publishers {
    public struct CompactMap<Upstream: Publisher, Output>: Publisher {
        public typealias Failure = Upstream.Failure
    }
    public struct Map<Upstream: Publisher, Output>: Publisher {
        public typealias Failure = Upstream.Failure
    }
    public struct RemoveDuplicates<Upstream: Publisher>: Publisher {
        public typealias Output = Upstream.Output
        public typealias Failure = Upstream.Failure
    }
}

extension Publisher {
    public func compactMap<T>(_ transform: @escaping (Output) -> T?) -> Publishers.CompactMap<Self, T> { .init() }
    public func map<T>(_ transform: @escaping (Output) -> T) -> Publishers.Map<Self, T> { .init() }
    public func sink(receiveValue: @escaping (Output) -> Void) -> AnyCancellable where Failure == Never { AnyCancellable() }
}
extension Publisher where Output: Equatable {
    public func removeDuplicates() -> Publishers.RemoveDuplicates<Self> { .init() }
}

public final class AnyCancellable: Hashable {
    public init() {}
    public func cancel() {}
    public static func == (a: AnyCancellable, b: AnyCancellable) -> Bool { a === b }
    public func hash(into h: inout Hasher) {}
}
