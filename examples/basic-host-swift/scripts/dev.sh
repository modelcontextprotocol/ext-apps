#!/bin/bash
# Development script: builds, installs, runs, and watches for changes
# Usage: ./scripts/dev.sh [simulator-name]
#
# Requires: fswatch (brew install fswatch)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
SIMULATOR="${1:-iPhone 17 Pro}"
BUNDLE_ID="com.example.BasicHostSwift"
APP_NAME="BasicHostSwift"

cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[dev]${NC} $1"; }
success() { echo -e "${GREEN}[dev]${NC} $1"; }
warn() { echo -e "${YELLOW}[dev]${NC} $1"; }
error() { echo -e "${RED}[dev]${NC} $1"; }

# Check for fswatch
if ! command -v fswatch &> /dev/null; then
    error "fswatch is required. Install with: brew install fswatch"
    exit 1
fi

# Boot simulator if needed
boot_simulator() {
    log "Checking simulator '$SIMULATOR'..."
    if ! xcrun simctl list devices | grep -q "$SIMULATOR.*Booted"; then
        log "Booting simulator..."
        xcrun simctl boot "$SIMULATOR" 2>/dev/null || true
        sleep 2
    fi
    # Open Simulator.app to show the window
    open -a Simulator
}

# Build the app
build_app() {
    log "Building..."
    if xcodebuild -scheme "$APP_NAME" \
        -destination "platform=iOS Simulator,name=$SIMULATOR" \
        -derivedDataPath "$BUILD_DIR" \
        build 2>&1 | grep -E "(error:|warning:.*$APP_NAME|BUILD)"; then
        return 0
    fi
    # Check if build succeeded even if grep didn't match
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        return 0
    fi
    return 1
}

# Create app bundle and install
install_app() {
    log "Installing..."
    local PRODUCTS_DIR="$BUILD_DIR/Build/Products/Debug-iphonesimulator"

    # Create app bundle if it doesn't exist
    mkdir -p "$PRODUCTS_DIR/$APP_NAME.app"
    cp "$PRODUCTS_DIR/$APP_NAME" "$PRODUCTS_DIR/$APP_NAME.app/"

    # Copy Info.plist
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

    # Sign and install
    codesign --force --sign - "$PRODUCTS_DIR/$APP_NAME.app" 2>/dev/null
    xcrun simctl install "$SIMULATOR" "$PRODUCTS_DIR/$APP_NAME.app"
}

# Launch the app
launch_app() {
    log "Launching..."
    xcrun simctl terminate "$SIMULATOR" "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl launch "$SIMULATOR" "$BUNDLE_ID"
}

# Full rebuild cycle
rebuild() {
    echo ""
    log "Rebuilding... ($(date '+%H:%M:%S'))"

    if build_app; then
        success "Build succeeded"
        install_app
        launch_app
        success "App reloaded!"
    else
        error "Build failed"
    fi
}

# Initial build
boot_simulator
rebuild

# Watch for changes
log "Watching for changes in Sources/..."
log "Press Ctrl+C to stop"
echo ""

fswatch -o "$PROJECT_DIR/Sources" | while read -r; do
    rebuild
done
