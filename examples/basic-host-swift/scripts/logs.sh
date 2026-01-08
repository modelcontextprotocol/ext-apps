#!/bin/bash
# Stream logs from the app running in simulator
# Usage: ./scripts/logs.sh [simulator-name]

SIMULATOR="${1:-iPhone 17 Pro}"
BUNDLE_ID="com.example.BasicHostSwift"

echo "📋 Streaming logs from $BUNDLE_ID on '$SIMULATOR'..."
echo "   Press Ctrl+C to stop"
echo ""

# Stream logs, filtering for our app (both OSLog and print statements)
xcrun simctl spawn "$SIMULATOR" log stream \
    --predicate "subsystem == '$BUNDLE_ID' OR process == 'BasicHostSwift'" \
    --level debug \
    --style compact
