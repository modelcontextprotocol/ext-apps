#!/bin/bash
# Build the app for iOS Simulator
# Usage: ./scripts/build.sh [simulator-name]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
SIMULATOR="${1:-iPhone 17 Pro}"
APP_NAME="BasicHostSwift"

cd "$PROJECT_DIR"

echo "Building $APP_NAME for '$SIMULATOR'..."

xcodebuild -scheme "$APP_NAME" \
    -destination "platform=iOS Simulator,name=$SIMULATOR" \
    -derivedDataPath "$BUILD_DIR" \
    build 2>&1 | grep -E "(error:|warning:.*$APP_NAME|BUILD)" || true

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "✅ Build succeeded"
    echo "   Output: $BUILD_DIR/Build/Products/Debug-iphonesimulator/$APP_NAME"
else
    echo "❌ Build failed"
    exit 1
fi
