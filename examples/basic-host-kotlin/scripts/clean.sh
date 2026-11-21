#!/bin/bash
# Clean build artifacts
# Usage: ./scripts/clean.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Set up Java
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"

cd "$PROJECT_DIR"

echo "🧹 Cleaning build artifacts..."

./gradlew clean

rm -rf "$PROJECT_DIR/build"
rm -rf "$PROJECT_DIR/.gradle"

echo "✅ Clean complete"
