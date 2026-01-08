#!/bin/bash
# Clean build artifacts
# Usage: ./scripts/clean.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧹 Cleaning build artifacts..."

rm -rf "$PROJECT_DIR/.build"
rm -rf "$PROJECT_DIR/.swiftpm"
rm -rf "$PROJECT_DIR/build"
rm -rf "$PROJECT_DIR/Package.resolved"

echo "✅ Clean complete"
