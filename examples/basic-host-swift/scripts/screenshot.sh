#!/bin/bash
# Take a screenshot of the simulator
# Usage: ./scripts/screenshot.sh [output-file] [simulator-name]

OUTPUT="${1:-screenshot.png}"
SIMULATOR="${2:-iPhone 17 Pro}"

echo "📸 Taking screenshot of '$SIMULATOR'..."
xcrun simctl io "$SIMULATOR" screenshot "$OUTPUT"
echo "✅ Saved to $OUTPUT"

# Open the screenshot
open "$OUTPUT"
