// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "McpApps",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
        .tvOS(.v16),
        .watchOS(.v9)
    ],
    products: [
        .library(
            name: "McpApps",
            targets: ["McpApps"]
        ),
    ],
    dependencies: [
        // MCP Swift SDK for core types (using spec-update branch with _meta support)
        .package(url: "https://github.com/ajevans99/swift-sdk.git", branch: "spec-update"),
    ],
    targets: [
        .target(
            name: "McpApps",
            dependencies: [
                .product(name: "MCP", package: "swift-sdk"),
            ],
            path: "Sources/McpApps"
        ),
        .testTarget(
            name: "McpAppsTests",
            dependencies: ["McpApps"],
            path: "Tests/McpAppsTests"
        ),
    ]
)
