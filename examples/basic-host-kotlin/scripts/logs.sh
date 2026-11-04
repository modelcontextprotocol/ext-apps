#!/bin/bash
# Stream logs from the app running on device/emulator
# Usage: ./scripts/logs.sh [filter]

# Set up Android SDK paths
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

PACKAGE_ID="com.example.mcpappshost"
FILTER="${1:-}"

# Check for adb
if ! command -v adb &> /dev/null; then
    echo "❌ adb not found."
    echo "   Install: brew install --cask android-commandlinetools"
    exit 1
fi

echo "📋 Streaming logs from $PACKAGE_ID..."
echo "   Press Ctrl+C to stop"
echo ""

# Get the PID of our app
PID=$(adb shell pidof "$PACKAGE_ID" 2>/dev/null)

if [ -n "$PID" ]; then
    echo "   App PID: $PID"
    echo ""
    if [ -n "$FILTER" ]; then
        adb logcat --pid="$PID" | grep -i "$FILTER"
    else
        adb logcat --pid="$PID"
    fi
else
    echo "   App not running, showing McpHostViewModel logs..."
    echo ""
    adb logcat "*:S" "McpHostViewModel:V" "WebView:V" "System.out:V"
fi
