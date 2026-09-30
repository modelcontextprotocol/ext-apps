#!/bin/bash
# Build and run the app on Android emulator or device
# Usage: ./scripts/run.sh [emulator-name]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
EMULATOR_NAME="${1:-Pixel_8}"
PACKAGE_ID="com.example.mcpappshost"
ACTIVITY="$PACKAGE_ID.MainActivity"

# Set up Android SDK paths
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"

cd "$PROJECT_DIR"

# Check if adb is available
if ! command -v adb &> /dev/null; then
    echo "❌ adb not found."
    echo ""
    echo "   Install Android SDK:"
    echo "   brew install --cask android-commandlinetools"
    echo ""
    echo "   Or set ANDROID_HOME to your SDK location"
    exit 1
fi

# Start emulator if specified and no device is connected
start_emulator() {
    if [ -n "$EMULATOR_NAME" ]; then
        if ! adb devices | grep -q "device$"; then
            echo "📱 Starting emulator '$EMULATOR_NAME'..."
            if command -v emulator &> /dev/null; then
                emulator -avd "$EMULATOR_NAME" -no-snapshot-load &
                echo "   Waiting for emulator to boot..."
                adb wait-for-device
                while [ "$(adb shell getprop sys.boot_completed 2>/dev/null)" != "1" ]; do
                    sleep 1
                done
                echo "   Emulator ready!"
            else
                echo "❌ emulator command not found"
                echo "   Available AVDs:"
                avdmanager list avd 2>/dev/null | grep "Name:" || echo "   (none)"
                exit 1
            fi
        fi
    fi
}

# Check for connected devices
check_device() {
    if ! adb devices | grep -q -E "device$"; then
        echo "❌ No Android device/emulator connected."
        echo ""
        echo "   Available emulators:"
        emulator -list-avds 2>/dev/null || avdmanager list avd 2>/dev/null | grep "Name:" || echo "   (none found)"
        echo ""
        echo "   Start an emulator: ./scripts/run.sh Pixel_8"
        echo "   Or connect a device via USB"
        exit 1
    fi
}

start_emulator
check_device

echo "🔨 Building..."
./gradlew assembleDebug

echo ""
echo "📦 Installing..."
./gradlew installDebug

echo ""
echo "🚀 Launching..."
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
adb shell am start -n "$PACKAGE_ID/$ACTIVITY"

echo ""
echo "✅ App is running"
echo "   View logs: ./scripts/logs.sh"
