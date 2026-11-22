// Type-checking stub of the UIKit bits used by Cadence (UIColor dynamic provider, UIDevice).
@_exported import Foundation

public enum UIUserInterfaceStyle: Int, Sendable { case unspecified, light, dark }

public final class UITraitCollection: @unchecked Sendable {
    public var userInterfaceStyle: UIUserInterfaceStyle { .unspecified }
    public static var current: UITraitCollection { UITraitCollection() }
    init() {}
}

open class UIColor: @unchecked Sendable {
    public init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {}
    public init(white: CGFloat, alpha: CGFloat) {}
    public init(dynamicProvider: @escaping @Sendable (UITraitCollection) -> UIColor) {}
    public convenience init?(named name: String) { self.init(white: 0, alpha: 0) }
    public func resolvedColor(with traitCollection: UITraitCollection) -> UIColor { self }
    public class var label: UIColor { UIColor(white: 0, alpha: 1) }
    public class var secondaryLabel: UIColor { UIColor(white: 0, alpha: 1) }
    public class var systemBackground: UIColor { UIColor(white: 0, alpha: 1) }
}

@MainActor
public final class UIDevice {
    public static var current: UIDevice { UIDevice() }
    public var name: String { "" }
    public var model: String { "" }
    public var systemVersion: String { "" }
    init() {}
}

@MainActor
public final class UIApplication {
    public static var shared: UIApplication { UIApplication() }
    public static var openSettingsURLString: String { "" }
    public func open(_ url: URL, options: [OpenExternalURLOptionsKey: Any] = [:], completionHandler: (@MainActor @Sendable (Bool) -> Void)? = nil) {}
    public struct OpenExternalURLOptionsKey: Hashable, RawRepresentable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }
    }
    init() {}
}

@MainActor
public final class UIPasteboard {
    public static var general: UIPasteboard { UIPasteboard() }
    public var string: String?
    init() {}
}

@MainActor
open class UIImpactFeedbackGenerator {
    public enum FeedbackStyle: Int { case light, medium, heavy, soft, rigid }
    public init(style: FeedbackStyle) {}
    public func impactOccurred() {}
}
