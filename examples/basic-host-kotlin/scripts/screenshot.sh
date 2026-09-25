#!/bin/bash
# Take a screenshot from the device/emulator
# Usage: ./scripts/screenshot.sh [output-file]

OUTPUT="${1:-screenshot.png}"

echo "📸 Taking screenshot..."

# Take screenshot on device and pull it
adb shell screencap -p /sdcard/screenshot.png
adb pull /sdcard/screenshot.png "$OUTPUT"
adb shell rm /sdcard/screenshot.png

echo "✅ Saved to $OUTPUT"

# Open the screenshot (macOS)
if [ "$(uname)" = "Darwin" ]; then
    open "$OUTPUT"
fi
