// Type-checking stub of BackgroundTasks (iOS 13+).
@_exported import Foundation

open class BGTaskRequest: @unchecked Sendable {
    public let identifier: String
    public var earliestBeginDate: Date?
    init(identifier: String) { self.identifier = identifier }
}
public final class BGAppRefreshTaskRequest: BGTaskRequest {
    public override init(identifier: String) { super.init(identifier: identifier) }
}
public final class BGProcessingTaskRequest: BGTaskRequest {
    public var requiresNetworkConnectivity = false
    public var requiresExternalPower = false
    public override init(identifier: String) { super.init(identifier: identifier) }
}
open class BGTask: @unchecked Sendable {
    public var identifier: String { "" }
    public var expirationHandler: (() -> Void)?
    public func setTaskCompleted(success: Bool) {}
}
public final class BGAppRefreshTask: BGTask {}
public final class BGTaskScheduler: @unchecked Sendable {
    public static let shared = BGTaskScheduler()
    public func submit(_ taskRequest: BGTaskRequest) throws {}
    public func register(forTaskWithIdentifier identifier: String, using queue: DispatchQueue?, launchHandler: @escaping @Sendable (BGTask) -> Void) -> Bool { true }
    public func cancel(taskRequestWithIdentifier identifier: String) {}
    public func cancelAllTaskRequests() {}
}
