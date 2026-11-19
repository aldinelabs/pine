#!/bin/sh
# Builds bench/build/apple-file-bench from the helper's own pipeline sources.
# Output goes to $1 (default bench/build/, git-ignored).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "${1:-$here/build}"
xcrun swiftc -O -swift-version 5 \
  "$here/../Sources/Transcription.swift" "$here/../Sources/Output.swift" \
  "$here/apple/main.swift" -o "${1:-$here/build}/apple-file-bench" 2>&1 || exit 1
