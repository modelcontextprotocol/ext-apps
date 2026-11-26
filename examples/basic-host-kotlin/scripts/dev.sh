#!/bin/bash
# Development script: builds, installs, runs, and watches for changes
# Usage: ./scripts/dev.sh [emulator-name]
#
# Requires: fswatch (brew install fswatch)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$PROJECT_DIR")")"
EMULATOR_NAME="${1:-}"
PACKAGE_ID="com.example.mcpappshost"
ACTIVITY="$PACKAGE_ID.MainActivity"

cd "$ROOT_DIR"

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

# Check for adb
if ! command -v adb &> /dev/null; then
    error "adb not found. Install Android SDK platform-tools."
    exit 1
fi

# Start emulator if specified
start_emulator() {
    if [ -n "$EMULATOR_NAME" ]; then
        if ! adb devices | grep -q "emulator"; then
            log "Starting emulator '$EMULATOR_NAME'..."
            emulator -avd "$EMULATOR_NAME" -no-snapshot-load &

            log "Waiting for emulator to boot..."
            adb wait-for-device

            while [ "$(adb shell getprop sys.boot_completed 2>/dev/null)" != "1" ]; do
                sleep 1
            done
            success "Emulator ready!"
        fi
    fi
}

# Check for connected device
check_device() {
    if ! adb devices | grep -q -E "device$"; then
        error "No Android device/emulator connected."
        echo ""
        echo "   Available emulators:"
        emulator -list-avds 2>/dev/null || echo "   (none found)"
        echo ""
        echo "   Start with: ./scripts/dev.sh <emulator-name>"
        exit 1
    fi
}

# Build the app
build_app() {
    log "Building..."
    if ./gradlew :examples:basic-host-kotlin:assembleDebug --quiet 2>&1; then
        return 0
    fi
    return 1
}

# Install and launch
install_and_launch() {
    log "Installing..."
    ./gradlew :examples:basic-host-kotlin:installDebug --quiet

    log "Launching..."
    adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
    adb shell am start -n "$PACKAGE_ID/$ACTIVITY"
}

# Full rebuild cycle
rebuild() {
    echo ""
    log "Rebuilding... ($(date '+%H:%M:%S'))"

    if build_app; then
        success "Build succeeded"
        install_and_launch
        success "App reloaded!"
    else
        error "Build failed"
    fi
}

# Initial setup
start_emulator
check_device
rebuild

# Watch for changes
log "Watching for changes in src/..."
log "Press Ctrl+C to stop"
echo ""

fswatch -o "$PROJECT_DIR/src" | while read -r; do
    rebuild
done
