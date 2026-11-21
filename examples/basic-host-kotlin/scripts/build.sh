#!/bin/bash
# Build the Android app
# Usage: ./scripts/build.sh [debug|release]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_TYPE="${1:-debug}"

# Set up Android SDK paths
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"

cd "$PROJECT_DIR"

echo "🔨 Building MCP Apps Host for Android ($BUILD_TYPE)..."

if [ "$BUILD_TYPE" = "release" ]; then
    ./gradlew assembleRelease
else
    ./gradlew assembleDebug
fi

APK_DIR="$PROJECT_DIR/build/outputs/apk/$BUILD_TYPE"

echo ""
echo "✅ Build succeeded"
echo "   Output: $APK_DIR/"
ls -la "$APK_DIR"/*.apk 2>/dev/null || true
