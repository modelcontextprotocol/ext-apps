#!/bin/bash
# Build and run the app in iOS Simulator (one-shot, no watching)
# Usage: ./scripts/run.sh [simulator-name]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
SIMULATOR="${1:-iPhone 17 Pro}"
BUNDLE_ID="com.example.BasicHostSwift"
APP_NAME="BasicHostSwift"

cd "$PROJECT_DIR"

echo "🔨 Building..."
"$SCRIPT_DIR/build.sh" "$SIMULATOR"

echo ""
echo "📱 Booting simulator..."
xcrun simctl boot "$SIMULATOR" 2>/dev/null || true
open -a Simulator

echo "📦 Installing..."
PRODUCTS_DIR="$BUILD_DIR/Build/Products/Debug-iphonesimulator"

# Create app bundle
mkdir -p "$PRODUCTS_DIR/$APP_NAME.app"
cp "$PRODUCTS_DIR/$APP_NAME" "$PRODUCTS_DIR/$APP_NAME.app/"

cat > "$PRODUCTS_DIR/$APP_NAME.app/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>BasicHostSwift</string>
    <key>CFBundleIdentifier</key>
    <string>com.example.BasicHostSwift</string>
    <key>CFBundleName</key>
    <string>MCP Host</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>UILaunchScreen</key>
    <dict/>
    <key>UIApplicationSceneManifest</key>
    <dict>
        <key>UIApplicationSupportsMultipleScenes</key>
        <true/>
    </dict>
    <key>MinimumOSVersion</key>
    <string>16.0</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
</dict>
</plist>
EOF

codesign --force --sign - "$PRODUCTS_DIR/$APP_NAME.app" 2>/dev/null
xcrun simctl install "$SIMULATOR" "$PRODUCTS_DIR/$APP_NAME.app"

echo "🚀 Launching..."
xcrun simctl terminate "$SIMULATOR" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl launch "$SIMULATOR" "$BUNDLE_ID"

echo ""
echo "✅ App is running in $SIMULATOR"
