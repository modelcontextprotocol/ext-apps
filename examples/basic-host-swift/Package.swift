// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BasicHostSwift",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "BasicHostSwift",
            targets: ["BasicHostApp"]
        ),
    ],
    dependencies: [
        // Local MCP Apps Swift SDK
        .package(path: "../../swift"),
        // MCP Swift SDK for MCP client (using spec-update branch with _meta support)
        .package(url: "https://github.com/ajevans99/swift-sdk.git", branch: "spec-update"),
    ],
    targets: [
        .executableTarget(
            name: "BasicHostApp",
            dependencies: [
                .product(name: "McpApps", package: "swift"),
                .product(name: "MCP", package: "swift-sdk"),
            ],
            path: "Sources/BasicHostApp"
        ),
    ]
)
