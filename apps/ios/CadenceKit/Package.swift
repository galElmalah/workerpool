// swift-tools-version:5.9
import PackageDescription

// CadenceKit: models, API client, storage, formatting and widget view-models shared by the Cadence
// iOS app and its widget extension. Pure Swift + Foundation (no UIKit/SwiftUI), no dependencies;
// builds and tests on macOS and Linux (`swift test`).
let package = Package(
    name: "CadenceKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CadenceKit", targets: ["CadenceKit"]),
    ],
    targets: [
        .target(name: "CadenceKit", path: "Sources/CadenceKit"),
        .testTarget(
            name: "CadenceKitTests",
            dependencies: ["CadenceKit"],
            path: "Tests/CadenceKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
